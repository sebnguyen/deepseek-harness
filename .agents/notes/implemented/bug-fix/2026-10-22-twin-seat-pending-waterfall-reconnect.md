# Agent Note: the twin seat survives a pending waterfall answer

Status: implemented

## Problem

The client Gateway makes its forwarded-event pump (the `$events` logical stream) the twin's Connection generation source. The Host replays every still-pending approval or user-question waterfall into each new event stream, and a cookie-less bearer client must return its `next` outcome over the gateway's `$events/result` unary endpoint. The ideBridge bearer rule scoped the twin token to the bridge wire and the plane remotes only, so the twin's result call answered 401. The rejected result aborted the generation (`ClientRemoteEvents` treats a lost result as a generation failure), Connection retried, the still-pending waterfall replayed, and the seat reconnected forever. A live run showed the loop begin 437ms after an `ask_user_question` tool call on the same Host (21:42:27.284 -> first seat failure 21:42:27.721) and continue at roughly 800ms per cycle until the question was answered. Two smaller defects amplified the report: the seat reset its backoff after every successful `report`, so a healthy hello followed by an instantly lost downlink never backed off, and the extension's output-channel wrapper always forwarded a second argument, printing `established undefined` on every line.

## Decision

The ideBridge bearer rule admits `$events/result` (the authority is `REMOTE_EVENT_RESULT_ENDPOINT` in `packages/api/gateway/src/stream-protocol.ts`). The endpoint is safe to widen to the twin because its payload settles only an event stream whose random `clientId` the caller learned from that same stream's opening frame; it grants no typert dispatch and no browser-cookie authority. `runSeatLoop` now resets its backoff only after a cycle stayed up for `stableAfterMs` (default `maxBackoffMs`), so a host that accepts `hello` and then drops the downlink backs off instead of hammering; a long-lived seat that later drops still recovers at the initial tier. The logger wrapper forwards the error argument only when it is present.

## Alternatives considered

**Keep the generation alive after a rejected result.** Rejected: the Gateway's contract already treats a lost result RPC as a generation failure (pinned by `gateway.client.spec.ts`), because a pending waterfall delivery whose outcome cannot be delivered must not silently strand the Host. Fixing the authorization keeps that contract intact.

**Answer only for events with a local listener.** Rejected: the Host cannot know which events a Client subscribed to (subscription is local to `ctx.remote.$on`), so it always delivers every pending waterfall; suppressing the result would leave that client's delivery pending on the Host and still require a generation-level recovery path.

**Reset the seat backoff on any successful `report`.** Rejected: a successful hello proves HTTP authorization, not downlink viability. The reported loop had a valid token and a dead downlink, which is exactly the case the reset turned into a 500ms hammer.

## Consequences

The twin token now reaches one gateway-internal endpoint in addition to its bridge wire and plane remotes. Every other endpoint keeps browser-cookie-only admission. A pending approval or user question no longer costs the twin its event generation, and a persistently failing downlink now escalates its retry delay instead of running at the floor indefinitely.

## Testing

`packages/api/ide/tests/bridge.host.spec.ts` pins the bearer endpoint list including `$events/result`; `packages/client/connection/tests/bearer-rules.host.spec.ts` pins that a slash-bearing endpoint of that shape admits a matching token and refuses a wrong one; `packages/extensions/vscode-cordis/tests/seat.vscode.spec.ts` pins that repeated instantly lost downlinks grow the sleep to 500/1000/2000ms and that a cycle marked stable resets to 500ms.

## Related

- [The vscode twin extension's cordis seat](../../proposed/architecture/2026-10-13-vscode-twin-extension-cordis-seat.md) — the seat's one-gateway-conversation design and its reconnect contract.
- [Gateway](../../../../packages/api/gateway/README.md) — the forwarded-event replay and result-RPC rules the fix preserves.
