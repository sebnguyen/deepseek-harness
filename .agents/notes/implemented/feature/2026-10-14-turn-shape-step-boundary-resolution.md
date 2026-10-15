# Agent Note: Turn-shape resolution applies at the next step boundary

Status: implemented

## Problem

The conversation-mode plugin snapshotted the shape per `(agent, turn)`: a pick made mid-turn parked until the turn ended, and the affected turn continued under the previous contract to its last request. Two measured costs pushed on that granularity. First, flip latency made picks look broken — the pill commits immediately, the reminder says "turn shape: quiet", yet requests for the whole open turn look unchanged; on 2026-10-14 a user filed precisely this class as "the switch does nothing" (the [ephemeral-grammar defect](../bug-fix/2026-10-14-ephemeral-request-grammar-header.md) dominated that session, but a correct system still exhibited next-turn-only latency). Second, the [strict `required` proposal](../../proposed/feature/2026-10-14-turn-shape-strict-required-and-finish-tool.md) raises the stakes: under `toolChoice: 'required'` a stuck quiet turn cannot be rescued mid-turn at all — the user would wait for a long tool-loop turn to drain before narrate takes. A turn is not the coarsest granularity anyone can tolerate; it is merely the granularity the first implementation happened to snapshot at.

## Decision

Shape resolution mints per `(agent, turn, step)` — at each step admission, the loop's atomic commit point — instead of per `(agent, turn)`:

- `resolveShape(agent, turn, step)` in `packages/client/conversation-mode/src/index.ts` caches per step; a mid-turn pick applies from the next step boundary exactly. The step key also preserves the one hard contract: **one step = one contract**, so a same-step retry cascade never changes shape between its attempts.
- Reminders are shape-epoch keyed — one `[turn-shape]` reminder per (agent, turn, shape) epoch, delivered at the first step admission that resolves under it (step 1 for a shape armed beforehand, any later step for a mid-turn pick). Narrate erases the epoch, so re-entering a shaped epoch re-notifies exactly once and re-entrant narrate stays silent.
- The quiet wrap-up's *evaluation* reads the projection at the stop moment: a quiet turn flipped to narrate mid-turn closes unsteered — the rescue path. Its *bookkeeping* (one cue per turn) stays turn-scoped, because turn-stopping is turn lifecycle, not step lifecycle.
- The grammar contribution binds through the same step-keyed snapshot, so its abstain/attach decision shares exactly the step's resolution.

This supersedes the per-turn snapshot paragraphs in [the plugin turn-shape note](2026-10-11-conversation-mode-plugin-turn-shape.md), [the session-scope architecture note](../architecture/2026-10-12-turn-shape-session-scope.md), and [the grammar-hints note](2026-10-13-conversation-mode-grammar-hints.md); session-scoped logged state (`turn-shape/mode`, last event wins, per-session projection) is untouched.

### Testing

`conversation-mode.host.spec.ts`: the mid-turn regression now drives quiet → narrate → quiet within one turn across steps 1-3 and asserts the reminder epoch count and the grammar fold outcome at each step, plus a same-step re-admission injects nothing twice; and a quiet turn flipped to narrate mid-turn closes with zero wrap-up steers. All within-turn reminders keep the one-reminder-per-epoch promise.

## Alternatives considered

- **Per-request resolution (no step key).** The waterfall fires per attempt; a flip mid-retry-cascade would give one step two different shaped attempts — the same response contract negotiated on attempt 1 would drop out under attempt 2. The step is the floor.
- **Keep per-turn semantics.** The rescue argument (strict `required` turns) is directly opposite; and "flip looks dead for the whole turn" was the UX class already filed. Rejected.
- **Narrate arrival notice / "shape lifted" reminder.** Every pick should leave a model-visible trace; injecting on narrate would make narrate performative (its absence of noise is its meaning). The silent reset plus the next shaped epoch's own notice covers both directions.

## Consequences

- A UI pick is observable from the next step's request and reminder within the running turn — the flip latency the user can perceive shrinks from turn-length to step-length.
- The quiet wrap-up rescue is real: a long quiet turn can be stopped mid-turn by picking narrate, and the natural stop after that flips nothing back.
- Rapid toggling can mint one reminder per shaped epoch; worst case is one reminder line per step (the loop's step budget bounds it), so the channel never floods.
- `shapeForTurn` is gone; `reminders`, `snapshots`, `wrapUps` eviction are bounded together at 64 entries per host composition, unchanged from the previous ceiling.

## Risks

- An already-steered wrap-up message sits in the inbox; a flip after the steer cannot retract it — it completes as a normal continuation, consistent with inbox semantics (flips decide future resolutions, never in-flight messages).
- A same-turn re-entry into the previous shape mints a *new* epoch and re-notes the reminder; that is intentional because the model genuinely re-enters the contract, but integrations measuring "turns with exactly one shape line per turn" must count epochs instead.
