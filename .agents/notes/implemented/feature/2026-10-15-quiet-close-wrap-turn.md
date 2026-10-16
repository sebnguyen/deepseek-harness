# Agent Note: Quiet closes converge at turn/end into one tagged none-pinned wrap-up turn

Status: implemented

## Problem

The quiet turn shape promised a transcript whose closing row is one plain
answer, but the shipped mechanism was underspecified twice over. The stop
listener's steer closed inside the same turn as a retrofitted extra step,
and the model had no say over when the turn ends: a long quiet turn could
not volunteer its close without writing a zero-tool-call message by
accident. Meanwhile the [strict-required and finish proposal](../../proposed/feature/2026-10-14-turn-shape-strict-required-and-finish-tool.md) carried a `finish` tool that resolves the second half, without committing to where the closing summary comes from: an out-of-band one-shot the harness performs after turn/end would fabricate a tool-free request against a fresh cache prefix, and a `wrap-up-armed` event family plus projection would buy bookkeeping the log already has.

## Decision

All close paths converge at the ordinary turn boundary, and the closing
summary is one ordinary turn of its own:

- `finish` lives in the standard catalog (`tool-turn-finish`, registered on
  every composed agent). Under quiet it calls the durable `concludeTurn`
  seam at its tool result — the `structured_output` precedent at
  [tools/src/index.ts](../../../packages/core/tools/src/index.ts). Everywhere
  else — the narrate/tools shapes, or a composition without
  conversation-mode — the call records nothing and the turn passes through
  untouched. The natural zero-tool-call ending closes the turn exactly as
  today.
- conversation-mode latches at `agent/turn-stopping`: the projection read at
  that moment says quiet (a narrate-flip rescue fires nothing), and the
  plugin queues exactly one tagged wrap-up drive as the next turn
  (`agent.inbox.append('next-turn', { kind: 'turn-shape', wrapUp: true })`).
  No second latch — the wrap turn itself holds fire.
- The wrap turn's admission re-marks the turn from the claimed drive's
  `wrapUp` source tag: restart between queue and claim still mints its
  grammar. Its requests attach `toolChoice: 'none'` on capability-positive
  routes and never the empty-object shield, so the closing answer goes out
  with no tool surface; on incapable routes it rides reminder-only like any
  quiet request.
- The wrap turn is an ordinary logged turn: the drive row and the closing
  assistant row are durable, replay-faithful, and renderable by the
  existing turn-shape render contract. The reminder line now names the
  tool: "call finish when done, then give one plain answer" — a soft
  instruction; the same closing lands of its own at the zero-tool-call
  stop either way.

This supersedes the wrap-up bookkeeping paragraph of the [step-boundary note](2026-10-14-turn-shape-step-boundary-resolution.md), which steered the cue inside the closing turn itself; the stop-moment projection read (the narrate-flip rescue) is preserved. The empty-object shield grammar of the [grammar-hints note](2026-10-13-conversation-mode-grammar-hints.md) gains the wrap-turn abstention clause, and the per-shape epoch reminders act untouched for ordinary quiet turns.

### Testing

`packages/client/tool-turn-finish/tests/turn-finish.host.spec.ts` covers the tool
side: registered under empty params on inject-order services, a quiet call
concludes the turn and records, narrate and tools close nothing, a
composition without the projection records nothing, a non-agent caller is
rejected, and a repeated call stays recorded. `conversation-mode.host.spec.ts`
covers the plugin side: the quiet close latches exactly one tagged wrap-up
drive, the wrap turn's fold carries `toolChoice: 'none'` without the shield
on capable routes, the incapable route keeps the pin absent, the wrap turn
never re-latches, a later quiet turn latches again after the 64-entry sweep
of the bounded bookkeeping, and narrate/tools turns close with nothing
queued.

## Alternatives considered

- **Scoped dynamic tool registration.** Registering `finish` per-agent
  through a conversation-mode child context would make the tool list vary
  by scope — churning the request-series cache and breaking the [thin-shipped catalog convention](../simplification/2026-10-14-thin-shipped-tool-catalog.md). The catalog stays constant; execute-time existence and the quiet guard carry the conditional.
- **Out-of-band one-shot call after turn/end.** A fabricated tool-free
  request from the host would pay a fresh cache prefix on every quiet
  close and re-open the v2 `quiet_finish` recap lineage the [session-scope note](../architecture/2026-10-12-turn-shape-session-scope.md) retired. Rejected per cache-stability and durability.
- **In-turn steered closure step.** The predecessor shipped design; it
  merged the ceremony rows into the closing turn itself and required the
  model to continue inside a turn it had already ended. The latch-plus-turn
  split is what remains after the cache argument removed the exemption.
- **Fused answer-with-call close.** The model calls `finish` carrying the
  closing text in the same message, no wrap turn at all. On capable routes
  the working-step shield would sanitize that answer to `{}` at the render
  contract; an unshielded close requires the arm to precede the request.
  Keeping the close request in its own unshielded turn is the simple fix.

## Consequences

- Both exits — `finish` and the natural zero-tool-call stop — converge at
  the same `turn/end` seam, so every later observer (render, trails,
  lifecycle projections) sees one conventional close shape.
- Every quiet turn costs one extra (session-local, none-pinned) topup turn;
  the ledger belongs to quiet's summary promise and stays bounded by
  one turn per close.
- `turn-stopping` fires for `completed` generated exits too — max-tokens
  closes latch a topup as well; quiet users see a summary even after a
  capped turn; a later observation can opt out by tracking the end kind.
- The number `turn + 1` pre-marks the wrap turn against the driver's
  monotonic turn step; inbox splice semantics settle that addition is
  the only landing slot.

## Risks

- The `wrapTurns` bookkeeping is in-memory and bounded at the 64-entry
  ceiling with the sibling maps; a swept mark lets one turn's close latch a
  second wrap turn. Log-noise worst case, single turn sized, and it travels
  with the tested sweep semantics.
- A model that calls `finish` on every quiet drift (over-eager closing)
  will wedge its own summaries early; the call is model's judgment and the
  mis-grasp lands in ordinary supervision.
