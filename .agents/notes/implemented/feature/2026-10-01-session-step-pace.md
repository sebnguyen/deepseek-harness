# Agent Note: Session step pace trades latency for provider prefix-cache persistence

Status: implemented

## Problem

The DeepSeek disk prefix cache persists each request's boundary units only after "cache construction takes seconds," so a fast tool loop can dispatch the next step before the previous request's prefix is matchable; those steps pay full `prompt_cache_miss_tokens` even though every byte is stable. The harness had no deployment- or user-facing knob to leave the provider that window: agent-loop settings are boot-time composition, and any automatic sleep would tax every turn of every session regardless of whether the operator values hit-rate over latency.

## Decision

A per-session, user-owned **step pace**: a durable minimum interval between one Session's model request dispatches, selected from the Web composer through a slider in the model-selection plugin, stored as log-only `step-pace` events, and enforced by the session-controller's `agent/pre-step` pacer.

- **Vocabulary and fold.** `session-controller` merges `'step-pace': StepPace` (`ms`, whole, `0..MAX_STEP_PACE_MS` = 10 000) into `SessionEventMap` and registers a `stepPace` projection folding `step-pace` (selection, latest wins) and `step/start` (`lastStepStartAt = event.time`). Both facts ride the existing projections transport, so the browser face updates live and after reload.
- **Pacer semantics.** The pre-step waterfall listener sleeps `max(0, ms - (now - lastStepStartAt))` — it prices only the *unspent* remainder since the previous dispatch, so naturally slow turns pay nothing, the first step of a Session never waits (no previous dispatch to persist), and a pace change takes effect at the next step boundary. The sleep races the live turn `AbortSignal`: cancellation and Host shutdown cut it short. Pacing sleeps before any inbox claim or log append, so it cannot reorder claims, split prompt batches, or alter request bytes — it moves *when* dispatch happens, never *what*.
- **Selection verb.** `session.setStepPace` validates the whole-millisecond bound (`RemoteError gateway/bad-request` otherwise), resolves the ordinary Session, and appends `step-pace`. Selections are therefore reconstructable, fork-inherited, and visible to every reader of the log, matching the "model-visible ⟺ logged" discipline's log-only sibling (like `model/selection`): the pacer is a runtime policy, not model input.
- **Browser face.** `ModelDirectory` folds the `stepPace` projection next to `modelSelection` and exposes `setPace(ms)`; the composer seat `conversation.input.stepPace` renders `StepPaceSlider` (0–10 s, 0.5 s steps, `0.0s` reads as disabled) over the same per-session directory as the model and temperature seats; addressed subagent sessions expose nothing. The draggable-until-acknowledged pattern mirrors the temperature slider's commit coalescing.

## Alternatives considered

- **Boot-time agent-loop `stepPaceMs` config** — rejected for this turn's requirement: it would apply per deployment at plugin boot, ride `request/header` negotiation only if it became config, and could never be adjusted per session without a restart; sessions, not deployments, own their latency/hit-rate trade.
- **Padding inside the adapter or provider layer** — rejected: pacing is a conversation-policy fact that must survive resume and fork and be visible in the GUI; a transport-local sleep is invisible, unlogged, and per-process.
- **Appending a model-visible "pace" notice** — rejected: the interval never changes what the model reads; logging it as derived history would violate the log-only/model-visible split for zero reconstructability gain.
- **Timer-free provider hint (e.g. `cache_control`)** — DeepSeek's OpenAI-compatible surface documents no cache-control request field; the disk cache is automatic and un-hintable, so only wall-clock spacing can feed it.

## Consequences

- A Session with a non-zero pace pays at most `ms` of extra wall time on steps that would otherwise dispatch back-to-back; the provider sees the same bytes later, raising the odds the prior prefix is already persisted. Nothing changes on the wire, so `request/header`, `EpochHeader`, snapshots, and keyless replays are untouched (default 0).
- Cancellation and rejected pre-steps are unaffected: the pacer delegates through `next()` after the wait and only when the signal is live.
- The fold's `step/start` timestamp uses event time, so replay over an imported log reconstructs exactly the waits the original session would have paid, keeping fixture and Host projections identical.
- Keyless replay stays deterministic because the pacer lives in `dsh-api-session-controller`, which shipped snapshot profiles do not compose.

## Testing

`packages/api/session-controller/tests/step-pace.host.spec.ts` covers the fold, remainder pricing (exact, zero before first step, zero after slow turns), abort cut-short, and command bounds. `packages/client/ui-model-selection/tests/step-pace-slider.client.spec.tsx` and the browser-plugin spec cover the seat, commit coalescing, wire verb, and subagent denial. The connection fixture folds `step-pace`/`step/start` so keyless GUI replays can drive the slider.
