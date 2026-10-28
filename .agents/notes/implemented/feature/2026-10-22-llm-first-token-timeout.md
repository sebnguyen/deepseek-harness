# Agent Note: First-token deadline for LLM streams

Status: implemented

## Problem

`streamIdleTimeoutMs` was the only transport stall bound on both remote LLM adapters, and its five-minute default arms only while an iterator read is outstanding. A provider or gateway that accepts a request and then withholds the first chunk kept a turn waiting for minutes with no output, and transport activity without a value legitimately counted as progress. The first token is the most visible latency in a turn, so that silent wait was the wrong failure mode.

## Decision

`idleWatchdog` accepts an optional `FirstDemandTimeout`: a shorter interval and code for the first iterator demand. The first `next()` is armed with that interval, the first value switches later demands to the ordinary idle interval, and `pulse()` does not extend a pending first demand because transport activity without a value is not progress toward the first token.

Both remote adapters expose `firstTokenTimeoutMs`: `llm-deepseek` defaults it to five seconds on its connection config, and `llm-pi-ai` defaults it to 20 seconds on each provider profile so a gateway route that needs longer than five seconds for its first chunk is not cut off. Each adapter passes `LLM_FIRST_TOKEN_TIMEOUT` to the watchdog and translates that expiry to `LlmError` code `TIMEOUT` with a message naming the configured interval. The provider retry policy decides whether the attempt retries. The field accepts the same positive finite bounds as `streamIdleTimeoutMs`, and the `sdk-minimal` bundle mirrors its two-day idle interval so its unbounded posture is unchanged.

## Alternatives considered

**Reuse `streamIdleTimeoutMs` for the first read.** Rejected: a healthy provider may take longer to produce the first chunk than to produce later ones, and one interval cannot be both the first-token bound and the five-minute mid-stream stall bound.

**Wrap each adapter read in `AbortSignal.timeout`.** Rejected: two independent timers would race for the same abort reason and duplicate the watchdog's disposal and classification logic.

**Make the first-token deadline non-retryable.** Rejected: `TIMEOUT` is already the retry policy's recovery signal, and a fresh attempt is exactly what can recover a stalled one. Deployments that do not want retries configure their policy.

## Consequences

A request that produces no chunk within the adapter's first-token interval now fails with `TIMEOUT` and may retry, so a provider that is merely slow can spend more total wall time than one unbounded wait. Deployments with legitimately slow first tokens raise `firstTokenTimeoutMs`; the timeout stays an operator-owned configuration field rather than a hardcoded constant.

`packages/util/timeout/tests/timeout.spec.ts` pins the first-demand interval, its code, the switch to the idle interval, and that pulses do not extend it. Both adapter specs pin the timeout message, the adapter's first-token default, and the rejected configuration bounds.
