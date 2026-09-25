# Agent Note: Durable request-wire capture

Status: implemented

English | [中文](2026-09-25-durable-request-wire-capture.zh.md)

## Problem

Nothing durable recorded what an adapter actually put on the wire. The log already carries the request envelope (`request/header`: call config, adapter defaults, assembled tool schemas) and every message as a surface event, and the "model-visible means logged" invariant is satisfied by that. But the serialized body is a function of more than the log: provider extension fields merged after serialization, Files API `file_id`s minted per call, and the image representation an attempt settled on after a fallback are all resolved at dispatch and recorded nowhere.

Diagnosing a provider request therefore required either re-deriving it and hoping the reconstruction matched, or attaching a debugger. Backend rejections that only the exact bytes explain — a rejected field, a stale file id, an unexpected representation — were not diagnosable after the fact at all.

## Decision

`SessionEventMap` gains one log-only member, `request/wire`, carrying a `RequestWireRecord`: the provider route, the model, the optional provider-neutral purpose, the image representation, and the exact body text.

The adapter reports the body, not the agent loop. `DeepSeekAdapterOptions` gains `onWireRequest`, called at the one point where the completed body exists — after `JSON.stringify({ ...body, ...extensions.fields })` and immediately before `fetch`. The hook fires once per attempt that reaches the transport, so an attempt that fails during file resolution is never reported.

`llm-deepseek` wires the hook and appends the event itself, resolving the addressed Session through the optional `ctx.get('sessions')` service with the `sessionId` the loop already stamps on every request. A request with no stamped id, or one naming a Session the store does not hold, streams unchanged and records nothing. The adapter keeps no Session knowledge; only the plugin's `apply` closure touches the log.

The trajectory tab folds each captured body into its own request inspector tab, keyed by the step the event falls in, in dispatch order. The tab renders only when a body was captured, so a historical log written before this change shows no empty tab.

The event is marked for the same reader set as its siblings by declaration: it is a known core member, so every build of this repository reads it. A build that predates it refuses the log rather than skipping it, which is the intended failure — the alternative, an `ignorable` envelope, would let an older build reconstruct a session while silently dropping the record a reader came for.

## Alternatives considered

**Store the parsed body as a structured object.** It would render and query better and avoid escaping the body inside the log's own JSON. It loses the property the capture exists for: the recorded value would be a re-serialization, not the bytes. Key order and whitespace differences matter exactly when a provider rejects a body for a reason only the raw text shows.

**Reconstruct the body in the browser from logged events.** This is what the composition view already does for tokens and KV-cache classes, and it was the original proposal. It cannot be exact, because the extension fields, file ids, and settled representation are host runtime state. A reconstruction that is right most of the time is worse than none for diagnosis, because it fails silently.

**Log the body from the agent loop.** The loop freezes the request and logs `request/header`, so it is the natural owner of request records. It does not hold the completed body: serialization happens inside the adapter after the loop's request is frozen.

**Emit the record on the existing live `agent/assistant-stream`-style channel.** That would keep the body out of the log entirely and avoid the growth cost. It was rejected as the sole mechanism: the requirement is post-hoc diagnosis, and a live-only frame does not survive a reload or a replay.

**Attach the body to `request/header`.** Rejected: `EpochHeader` is the reconstruction contract compared field-wise by `headerEquals`, and the body is not part of request-envelope identity. Folding it in would make every request look like an envelope change.

## Consequences

The log grows by one body per dispatched attempt, and a body restates the whole prompt. Stored growth is quadratic in request count: request *N* carries everything requests 1..*N-1* carried. The JSONL backend compresses with zstd by default and each request restates the previous prefix, so the on-disk cost is far below the raw arithmetic, but it is real and grows with session length.

`payload` is exact text, so the captured value is authoritative about bytes and poor for structured queries. Consumers that want fields parse it.

Capture covers routes that dispatch through the DeepSeek adapter. The replay adapter used by recorded-session tests substitutes its own streaming path, so replayed fixtures carry no `request/wire` events and existing recorded snapshots are unchanged.

The event participates in the durable vocabulary: `docs/persistence-catalog.md` and `packages/core/session/src/known-event-types.ts` are generated from the declaration and must stay fresh under `pnpm run verify-persistence-catalog`.

This narrows no existing invariant. [Every LLM request is reconstructable from the session log](2026-07-05-reconstructable-requests.md) governs the loop's `GenerateOptions` and `EpochHeader`, which remain reconstructable; the dispatched body adds adapter-resolved fields, and this record captures them rather than deriving them.
