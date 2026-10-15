# Agent Note: Broadcast the wire-request record to plugins (`llm/request-wire`)

Status: proposed

## Problem

The exact serialized request body an adapter dispatches is today observable by exactly one consumer: the durable `request/wire` append inside each LLM plugin shell (`packages/llm/llm-pi-ai/src/index.ts:242-249`, `packages/llm/llm-deepseek/src/index.ts:498`). Any other plugin that needs "what actually went out" — audit tooling, request tracers, a UI that renders the real payload, grammar forensics like the debugging behind [the ephemeral-grammar fix](../../implemented/bug-fix/2026-10-14-ephemeral-request-grammar-header.md) — has no seam: the loop-level `agent/request` waterfall sees the pre-serialization config, and the adapter owns everything downstream of it. The gap is observability, not transformation: nothing should be able to rewrite the wire body, everyone should be able to see it.

## Proposal

Emit a broadcast cordis event from the same seam that writes the durable record: one `request/wire` append per request, one `llm/request-wire` emit per request, same frozen record object, append first (the durable log is authoritative), emit second (the event signals the record now exists). emit, not waterfall: notification semantics — observers must not transform, and must not be able to veto a dispatch already logged.

### Who declares the event

The emitting side declares it, once, in the shared LLM types package both plugin shells depend on — `packages/llm/llm/src/types.ts`, beside `'llm/adapters-updated'`:

```ts
declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The exact serialized request an adapter dispatched, notified after the
     * durable `request/wire` append of the same record. Notification only —
     * observers must not mutate the frozen record and cannot veto or rewrite
     * the dispatch. Absent for requests without a session id.
     * @mode emit
     */
    'llm/request-wire'(event: RequestWireBroadcast): void
  }
}

/** `llm/request-wire` payload: the session's own wire record plus its id. */
export interface RequestWireBroadcast extends RequestWireRecord {
  readonly sessionId: SessionId
}
```

Consumers declare nothing — the cordis `Events` augmentation makes the name and payload type visible to every listener: `ctx.on('llm/request-wire', (event) => { ... })` from any plugin context (trajectory UI, audit plugin, debugger).

### Emitter change (both plugin shells)

```ts
onWireRequest: (request) => {
  if (request.sessionId === undefined) return
  const record: RequestWireRecord = Object.freeze({
    provider: request.provider,
    model: request.model,
    ...request.purpose === undefined ? {} : { purpose: request.purpose },
    payload: request.payload,
  })
  ctx.get('sessions')?.get(request.sessionId)?.append('request/wire', record)
  // Broadcast after the durable append; observer failure must not contaminate
  // the request path (containment precedent: llm runtime's emitAdaptersUpdated).
  emitContained(ctx, 'llm/request-wire', { sessionId: request.sessionId, ...record })
}
```

`emitContained` follows the existing containment pattern in `packages/llm/llm/src/index.ts:405-414` (per-listener isolation so one throwing observer starves nobody and cannot reach the request loop); extracted as one shared helper in the llm package rather than three copies across shells. The record is frozen once at construction; the append and the emit share it, so the event payload and the durable record cannot drift — the append detaches its own snapshot, listeners receive the frozen original.

### Why not a waterfall

A waterfall exists to let N writers transform a value in chain order. The wire body is the adapter's rendered output of the transform chain that already exists (`agent/request`); a second transform point over the *serialized* body would smear representation (`sampling_params.response_format`, `request_stream` layout) up into plugins whose protection is that they never see it. Transform stays at `agent/request` (config level), observation lands here (emit level), durability stays at `request/wire` (record level) — three single-purpose seams instead of one overloaded one.

## Alternatives considered

- **Loop-side emit near `buildRequest`/`markAgentLoopRequest`.** Sees the resolved *config*, not the serialized body — it would record pre-capability-strip grammar and pre-adapter mapping, i.e. exactly not the wire truth. Rejected for the same reason the append lives adapter-side.
- **A `request/pre-call` waterfall** as discussed in-thread. Lets plugins rewrite the serialized body; duplicates `agent/request`'s responsibility at a worse layer and invites vetoing live dispatches. Rejected.
- **Emit from the session layer by subscribing to `request/wire` appends.** Session events appended are observable through control frames, but UI-facing "the wire record exists" push is session-log mechanics, while plugins inside the host need a typed local event with the whole record — the emit must ride the emitting code path, not a projection poll.

## Acceptance criteria

- For every dispatched request with a session id, exactly one `llm/request-wire` emit fires with a payload deep-equal to the corresponding `request/wire` log record — one shell-level spec per LLM plugin (llm-pi-ai, llm-deepseek) asserting the 1:1 correspondence against the session log.
- The emitted payload is frozen; a listener attempting mutation of it affects neither the log record nor subsequent listeners.
- A throwing observer is contained: dispatch and durable append complete, other listeners still run.
- Requests without a session id emit nothing, and llm-without-SessionStore compositions behave as today (the `ctx.get('sessions')?.get(...)` gate covers both).
- Listeners subscribe with plain `ctx.on('llm/request-wire', ...)` from any plugin context, with full payload typing from the `Events` augmentation.

## Risks

- Two emitter sites today (deepseek, pi-ai); every future adapter shell must remember the emit — mitigated by the shared `emitContained` helper and the 1:1 spec template, but a third shell is the honest regression window.
- The event exposes complete request payloads to any subscriber — intended (that is the observability), but note that plugin code with this access level also sees tool arguments and message content; deployment policy for plugins is unchanged.
