# Agent Note: turn usage keeps the reported subtotal when an attempt reports no usage

Status: implemented

## Problem

A Turn whose model request failed after retries showed no token count at all,
even when every completed request inside it reported exact usage. Two sessions
recorded that shape: `ebb09a26-dce6-4937-b912-31f2d7d336e8` and
`828fc989-01c1-40c1-a958-b02533b34efe` each ended turn 1 with reason `error`
after six `assistant/attempt` events and five `llm/retry` cycles, while 26 of 26
and 35 of 35 `assistant/message` events carried valid usage.

The loop emits `assistant/attempt` rather than `assistant/message` when a
stream aborts without content, throws, or finishes with `error` or `aborted`.
Such an attempt carries a `finish` chunk and no `usage` chunk.
`deriveTurnTokenUsage` closed every attempt through one guard that refused an
absent sample, marked the whole turn invalid, and stopped folding, so the
footer dropped its usage pill. The turn's operators saw a metered turn priced at
nothing.

## Decision

Closing an attempt now reports one of three outcomes: a usage sample that
normalizes, an absent sample, or a sample that is present but unsafe. Only the
third still invalidates the turn. Absent usage contributes nothing to the
totals and increments `unreportedAttempts`, an optional field that appears on
`TurnTokenUsage` only when at least one attempt stayed unreported. The usage
dialog renders it as an `Unreported attempts` row beside the reported buckets.

A turn with no reporting attempt still hides its pill: an empty attempt set
cannot produce a total. Corrupt counts, contradictory exact totals, unsafe
integers, missing lifecycle boundaries, and optional buckets or routes absent
from any reporting attempt keep their existing fail-closed behavior.

## Alternatives considered

- **Keep hiding the whole turn.** That was the shipped behavior; it discarded
exact accounting for every reporting attempt because one failed request
returned no sample.
- **Treat an absent sample as zero and present the total as complete.** A
request that reached the provider and streamed before failing did consume
tokens, so a silent zero would understate the turn with no signal. The explicit
count keeps the subtotal honest.
- **Infer tokens from the streamed text.** The package makes no model calls and
its estimator is a heuristic; a turn total must stay provider-reported.
- **Accept absent usage only for an `error` finish.** The finish reason says how
the stream ended, not whether the request was billed; an `aborted` finish
carries the same uncertainty.
- **Carry the last pre-retry sample into the retried attempt.**
`llm/retry-started` opens a new billed attempt and deliberately drops the prior
sample; reusing it would count one request twice.

## Consequences

A completed turn with at least one reporting attempt now shows its pill after a
failed request, and the dialog states how many attempts reported no usage. A
turn whose every attempt stayed unreported keeps hiding, as does a turn with no
model attempt at all. Optional buckets and routes still require every reporting
attempt, so a skipped attempt cannot fabricate attribution.

The cost is that the pill can understate a turn whose attempt streamed part of
an answer before failing; `unreportedAttempts` is the visible signal for that
uncertainty rather than a silent zero or a hidden total.

## Testing

- `packages/llm/token-meter/tests/turn-usage.spec.ts` pins the reported subtotal
  with one and with two unreported attempts, and pins `undefined` when no
  attempt reports usage.
- `packages/client/ui-chat/tests/turn-usage-panel.client.spec.tsx` pins the
  `Unreported attempts` row and its absence when every attempt reported.
- The two recorded sessions above replay to a derived total with
  `unreportedAttempts: 1` under the same fold the browser consumes.
