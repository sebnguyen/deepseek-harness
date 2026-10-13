# Agent Note: Conversation-mode grammar hints — strict shield, toolChoice auto, quiet wrap-up

Status: implemented

## Problem

The conversation-mode turn shapes shipped reminder-only: the [thoughts fix](../bug-fix/2026-10-11-conversation-mode-thoughts-every-shape.md) deleted every request-grammar field from the plugin, so a quiet/tools turn differed from a narrate turn by exactly one instruction line. The shield's original purpose — collapsing stray working-step prose to ~2 tokens — stayed unclaimed, and its removal dodged rather than answered the incident's question: whether `response_format` next to the reasoning fields suppresses the reasoning stream. That coupling was diagnosed live on the `llm-deepseek` wire and never captured; on the deployed route (pi-ai, `openai-completions` format onto the DigitalOcean stack) pi-ai provably emits reasoning fields and `samplingParams.response_format` side by side with no client-side coupling, so any suppression would be server-side and stack-specific. The owner elected to settle it by observation on the live stack, so the grammar layer returns — per the recorded product call, with the reasoning question explicitly open.

## Decision

Four mechanisms, all scoped to one (session, turn):

1. **Shape stays session-scoped logged state**, last `turn-shape/mode` event wins, snapshotted per (session, turn) at the step-1 pre-step — unchanged from [turn-shape-session-scope](../architecture/2026-10-12-turn-shape-session-scope.md).
2. **Capability-gated grammar hints.** Under `quiet` and `tools` the plugin contributes at `GRAMMAR_PRIORITY.turnShape` through `ctx.request-grammar`: an explicit `toolChoice: 'auto'` plus the strict empty-object `EMPTY_OBJECT_SCHEMA` shield (its two-token `{}` output is the body the ui-chat render contract refuses to draw). Each field attaches only where `llm.grammarCapability(provider, model)` resolves true for it; capability-negative routes and llm-less compositions run reminder-only, and `narrate` contributes nothing anywhere. A capture driver at a higher band still wins the `structuredOutput` slot. A validated Config field `grammarHints` (cordis.yml, default true, resolved at composition) turns the hints off deployment-wide — the rollback lever.
3. **Quiet closes with one unshielded wrap-up step.** A quiet turn's natural zero-tool-call stop fires the `agent/turn-stopping` dispatch, which steers exactly one "close now" continuation; the contribution abstains for the rest of that turn, so the closing answer is emitted with no restriction. One wrap-up per turn, keyed off the same bounded snapshot map; a second stop in the same turn closes for real. `tools` steers nothing — the turn ends when the agent ends it.
4. **The `{}` channel is refused, not rendered.** `sanitizeAssistantReplyText` and `hasAssistantReplyContent` in ui-chat pin bare and fenced shield bodies as invisible (conversation-node-definition fixtures), unchanged.

The plugin lives in `packages/client/conversation-mode`; the capability-seams catalog lists it as a `ctx.request-grammar` consumer again.

## Alternatives considered

- **Condition the shield on unarmed reasoning** (attach only when no reasoning effort is in force). Deferred, not rejected: the coupling it guards against was never wire-proven, and the deployed adapter has no client-side coupling, so the owner chose to observe the stack's behavior before carrying a conditional that doubles the shape matrix. If live runs show thoughts vanishing, `grammarHints: false` is the rollback and this conditional is the follow-up shape.
- **Out-of-loop one-shot for the closing answer.** A separate `llm` call outside the agent would rebuild the turn's message history at the call site; a steered continuation reuses the agent's own assembly and the existing `agent/turn-stopping` seam the subagent step budget already rides.
- **Revive `quiet_finish` as a tool.** A stop tool plus a module-global finish flag was the race-prone mechanics retired with ui-quiet; steering carries the cue without cross-session state.
- **Shield `quiet` but not `tools`.** Exempting either non-narrate shape would re-expose stray prose on the shape whose whole promise is a quiet transcript — the shield binds the channel the render contract sanitizes.

## Consequences

- Every request of a quiet/tools turn on a grammar-capable route now carries `tool_choice: 'auto'` and a strict empty-object `response_format`; the quiet closing step intentionally carries neither.
- If the deployed stack suppresses the reasoning stream under `response_format`, quiet/tools working steps lose their thoughts exactly as the 2026-10-11 incident recorded — bounded by the per-route capability gate, the config rollback, and the incident note as the diagnostic. The 17-test host spec pins the injection mechanics, the wrap-up lifecycle, and the arbitration order; the live-stack reasoning question resolves by observation.
- This note partially supersedes the [thoughts fix](../bug-fix/2026-10-11-conversation-mode-thoughts-every-shape.md) (whose thoughts-in-every-shape product call survives as the validation constraint) and the grammar-shield section of the [original turn-shape note](2026-10-11-conversation-mode-plugin-turn-shape.md).
