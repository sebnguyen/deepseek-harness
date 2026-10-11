# Agent Note: Conversation-mode plugin — turn shape with per-route capability-gated grammar

Status: implemented

## Problem

The shipped conversation-mode mechanism (`ui-quiet`: Normal / Quiet / Silence)
enforces a transcript property by rewriting the LLM request grammar, and it
breaks in practice — reproduced in-session and documented in
[`design/conversation-modes-redesign.md`](../../../design/conversation-modes-redesign.md):

- **Enforcement rides optional wire fields.** Every armed request gets
  `toolChoice: 'required'` plus the strict empty-object `structuredOutput`
  shield from an `agent/request` waterfall listener
  (`packages/client/ui-quiet/src/index.ts:116-128`, seeded at
  `packages/core/agent-loop/src/agent.ts:530`). Both fields are
  OpenAI-convention provider hints whose fidelity varies by stack: the model
  answers JSON instead of calling tools, or emits the tool call as free text
  (`<tool_call>…`), which is precisely how the recorded sessions corrupted.
- **The turn-ending path it destroys is the natural one.** The agent loop ends
  a turn when the assistant message carries **zero tool calls**
  (`packages/core/agent-loop/src/agent.ts:486-487`: `toolCalls.length === 0 →
  { kind: 'completed' }`), plus the explicit `concludeTurn` seam
  (`agent.ts:488-492`). `toolChoice: 'required'` makes the zero-tool-call
  response wire-inexpressible, so the plugin must inject a synthetic stop tool
  (`quiet_finish`) plus a module-global `pendingFinish` flag
  (`ui-quiet/src/index.ts:43`) — process-wide state that races across sessions,
  agents, and a settings change.
- **No arbitration between grammar writers.** Four `agent/request` listeners
  exist (ui-quiet, subagent step-budget
  `packages/subagent/subagent-in-process-driver/src/step-budget.ts:67`,
  model-selection, webhook). Ordered-waterfall last-write-wins means armed
  quiet mode *overwrites the step-budget's child `outputSchema` with the
  empty-object shield* — a live conflict, not a hypothetical one.
- **Capability truth does not reach plugins.** The LLM runtime already
  protects non-supporting adapters: `LlmAdapter.structuredOutputOnRequest` /
  `toolChoiceOnRequest`
  (`packages/llm/llm/src/index.ts:208`, `:217`) gate a strip in `forAdapter`
  (`llm/src/index.ts:1014-1021`) that deletes the fields before dispatch. But
  both shipped adapters declare the flags `true` **adapter-wide,
  unconditionally** (`llm-deepseek/src/adapter.ts:384,386`;
  `llm-pi-ai/src/adapter.ts:288,289`), and pi-ai's own docs admit
  non-OpenAI-compatible routes silently degrade the grammar to "soft hints".
  No query surface exists for plugins — the adapter registry is private — and
  no per-route capability exists at all.
- **The visible guardrail is exact-match.**
  `packages/client/ui-chat/src/client/chat/AssistantNodeView.tsx:27` suppresses
  only `''`/`'{}'` rows and not the turn-tail owner, so the one row users read
  first can render a raw `{}`.

`ui-quiet` is currently unmounted from the base patch
(`packages/bundle/base/cordis.patch.yml`) while this rework is designed.

## Decision

Rebuild the feature as a **conversation-mode plugin** with three shapes —
`narrate` (default), `quiet`, `tools` — whose promise is a **render contract**
first and a **provider-compatible generation hint** second. Grammar stops
being load-bearing and shrinks to exactly one field: the strict empty-object
`structuredOutput` shield on working steps, attached only where the route is
proven to honor it. Every shape behaves correctly on a provider that ignores
even that, degraded only by unshielded token waste.

### Support is detectable, per route

Capability becomes a first-class, queryable engine fact instead of a static
adapter-wide claim:

1. **Per-route adapter declaration.** Extend the existing
   `structuredOutputOnRequest` / `toolChoiceOnRequest` adapter surface into a
   per-route capability resolution (adapter-supplied function of the resolved
   call: provider + model + protocol). DeepSeek's route stays `true`;
   pi-ai resolves `true` for its OpenAI-compatible protocol and `false`
   otherwise. The existing `forAdapter` strip (`llm/src/index.ts:1014-1021`)
   keeps its contract and now enforces the per-route verdict.
2. **Plugin-queryable exposure.** Surface the resolved capability beside
   `prepareCall` (the runtime already computes resolution info internally;
   the conversation-mode plugin needs `resolveCallWithInfo`-level access or
   an equivalent) so a request-mutating plugin can ask *before* attaching
   grammar fields, rather than attaching optimistically and trusting the
   strip.
3. **Mode availability vs. fidelity.** With the render contract owning the
   promise, every shape is *available* on every route; capability decides
   *fidelity* — strict-shielded working steps where supported, unshielded
   prompt-section-only operation where not. No conversation mode is ever
   refused because a provider lacks grammar support.

### One plugin, two entry halves — not two packages

Follow the existing client-package pattern (as `ui-quiet` already does):

- **Host half** (`apply(ctx)`): the turn-shape setting, its per-turn
  snapshot, the per-turn reminder injection, and the capability-gated shield
  attach.
- **Browser half** (`src/client`, shipped through the `dsh.client`
  declaration): the composer selector (`Narrate · Quiet · Tools only`) showing
  "applies to next turn" while a turn streams.

The two halves share one settings namespace (`conversation.turnShape`,
migrating the `ui-quiet` field) and must version together; splitting into two
packages buys nothing. The render-contract sanitizer itself lives in
`ui-chat`
(where every renderer owns its response), which the plugin's client half
depends on declaratively.

### Enabling with the LLM: injection through one seam, capability-gated and
arbitrated

Yes — straight injection, but exactly through the existing seam and with
three new constraints:

1. **The seam stays `agent/request`.** The waterfall at
   `packages/core/agent-loop/src/agent.ts:530` is the only entry point a
   plugin needs: the returned config extras ride `LlmCallConfig` through
   `prepareCall`, land on the frozen `GenerateOptions`
   (`agent.ts:610-617`), pass `llm/stream`, then meet the `forAdapter`
   capability strip before adapter serialization
   (`llm-deepseek/src/serialize.ts:381-403` maps them to `response_format` /
   `tool_choice`). No new engine request path is introduced.
2. **Gate before attaching.** The plugin resolves the per-route capability
   for the turn's route and attaches a hint only when supported — never
   optimistically. Where unsupported, the equivalent instruction goes through
   the system-prompt section instead.
3. **Arbitrate the seam.** The free-form waterfall fold becomes a declared,
   ordered contribution registry of request-grammar mutators with priorities
   (staging escalation > structured-output drivers > turn shape > presets),
   replacing ordered last-write-wins. The mode plugin's write is lowest-
   priority below structural writers, so it can never again clobber the
   step-budget's `outputSchema`. `concludeTurn` becomes idempotent per turn.
4. **Shield-only grammar, and never `toolChoice`.** The plugin attaches no
   `toolChoice` in any form — not `required`, not `none`, not `auto`;
   termination grammar stays the provider default. Its sole grammar mutation
   is the strict empty-object `structuredOutput` shield (`strict: true`) on
   working steps, attached only when the route's per-route structured-output
   capability resolves true. The shield keeps the cost guard
   `toolChoice: 'required'` was bought with — stray working-step prose
   collapses to ~2 tokens of `{}` — without removing the model's legal
   turn-ending path. The leaked-artifact class the shield can re-expose (a
   bare `{}` row) is absorbed by the render contract, not by more grammar.

### Every turn carries a shape reminder

Like every other turn-context injection in the product (the staging section,
the repeat-tool reminder, plan mode), the plugin injects one short line into
each turn's context naming the shape in effect for that turn — read from the
turn's snapshot, never the live setting: *"Turn shape: quiet — tool rows
only; close with one plain answer."* The reminder is the mode's only
load-bearing model-facing instruction: it travels through the same per-turn
injection seam the sibling plugins already ride, costs one line, speaks in
transcript terms, and is what keeps behavior honest on routes where the
shield is withheld. `narrate` injects nothing (the default needs no
reminder).

### Turn termination stays the natural rule

The plugin must not redefine how a turn ends. The agent ends its turn the
way it naturally does: it emits an assistant message containing **zero tool
calls** (`agent.ts:486-487`). That is the provider-independent termination
signal — no stop tool, no `required`, no one-shot. Under `quiet` the
zero-tool-call message is the closing answer; under `tools` the renderer
supplements the closing status line when the transcript contract says the
turn ended silently. The `quiet_finish` escape hatch and the `pendingFinish`
module state are deleted outright, because both existed only to repair the
damage `toolChoice: 'required'` caused in the first place.

Each turn snapshots the shape on its first request (turn-context stamped by
the agent loop, keyed by exec session), which deletes the mid-turn settings
race and the multi-session flag leak at once.

## Alternatives considered

- **Keep wire-field enforcement (status quo).** `tool_choice: required` plus
  strict `json_schema` is a provider-fidelity lottery: the corruption
  reproduced three ways in one session (raw `<tool_call>` text, `{}` answer,
  staging conflict). The modes promise a transcript property; making the
  provider carry that promise was the original sin.
- **Plugin-side capability allowlist.** Let the conversation-mode plugin keep
  its own per-provider/route config of "safe" routes and skip the engine
  change. Rejected: capability truth would duplicate in the plugin and drift
  from what the adapters actually declare and enforce — the strip and the
  allowlist could disagree, and the plugin's copy rots silently. The engine
  already owns the adjudication point (`forAdapter`); the declaration just
  has to become honest and per-route there.
- **Renderer-only fix.** Sanitizing `AssistantNodeView` kills the visible
  `{}`/`<tool_call>` rows but leaves the generation side corrupted: wasted
  tokens, broken quiet one-shots, the step-budget schema overwrite, and the
  races. Presentation and generation both have to change.
- **Zero-grammar mode (prompt + render contract only).** Attach nothing at
  all and let presentation own every promise. Rejected by product decision:
  the strict shield's working-step cost binding is a saving worth keeping,
  and its leaked-artifact class is fully absorbed by the render contract.
  This is a deliberate tension trade, not an oversight — see Risks.
- **Two packages (separate UI and host plugins).** The halves share one
  settings namespace, one settings round-trip, and one release cadence; the
  repo's client-package pattern already splits entry halves inside one
  package (`src/index.ts` host + `src/client` browser via `dsh.client`).
- **Delete the modes.** Conversation shaping has real value (token economy,
  scannable transcripts); the render contract delivers the promise without
  grammar enforcement, so removal is not warranted.

## Consequences

- A `dsh-client-conversation-mode` plugin row is mounted in the base patch,
  replacing the removed `ui-quiet` row, with the `ui-quiet` settings field
  migrating to `conversation.turnShape`.
- Per-route capability is resolvable from the plugin side: for a pi-ai
  non-OpenAI-compatible route the capability verdict is negative, the shield
  is not attached, and wire-level capture proves `response_format` appears
  iff the route's capability resolves true.
- No request the conversation-mode plugin assembles ever carries
  `toolChoice` in any form (wire-asserted across the shipped routes); the
  sole grammar field it adds anywhere is the strict empty-object
  `structuredOutput` shield on working steps.
- Every turn of a non-`narrate` shape carries exactly one shape-reminder
  line drawn from the turn's snapshot — switching shape mid-turn leaves turn
  N's reminder text untouched (request-log asserted).
- With the plugin armed quiet and a subagent driver loaded, the step-budget's
  child `outputSchema` survives on the cap step in every waterfall order —
  arbitration is order-independent by declaration.
- Turn termination uses only the zero-tool-call rule and idempotent
  `concludeTurn`: the `quiet_finish` tool and `pendingFinish` state are
  removed.
- Switching shape mid-turn is deterministic: turn N keeps its shape, turn
  N+1 uses the new one (per-turn snapshot e2e), and the composer shows the
  pending change truthfully.
- A quiet turn on a provider that ignores every hint still closes with a real
  answer row (ui-chat render-contract fixtures: `<tool_call>` text tail,
  bare and fenced `{}`, tail-owner row).

## Risks

- **Engine-surface growth.** Per-route capability resolution and plugin-side
  exposure enlarge the LlmRuntime contract; every adapter must answer the
  resolution honestly, and a wrong positive re-opens the silent-degradation
  window pi-ai currently hides in. Mitigation: defaults stay `false` unless a
  route is proven, matching the strip's existing conservative posture.
- **The `{}` artifact class stays alive by design.** Keeping the strict
  shield means a working step can still surface a bare `{}` — including the
  turn-tail row when the final step was schema-bound. The render contract
  (sanitizer + tail fallback) is the load-bearing mitigation for this chosen
  trade-off and must ship with the plugin, not after it. Unshielded routes
  (capability-negative) instead pay stray-prose tokens; accepted, since the
  per-turn reminder keeps it rare and the renderer absorbs the rest.
- **Ordering window.** If the render contract in `ui-chat` ships later than
  the plugin, old renders still leak artifacts. Mitigation: land the
  sanitizer in the same change or first; the plugin row must not re-mount
  without it.
- **Losing the wrap-up prompt.** Deleting `quiet_finish` removes the
  "wrap up" nudge some models needed; the prompt-section instruction must
  carry that cue, and shapes that want a closing answer need the fallback
  row in the render contract when the model declines to produce one.

## Result

Implemented on branch `wip/conversation-mode-and-grammar`: per-route capability surface (`grammarCapability`), declared-priority `request-grammar` arbitration, the conversation-mode plugin with per-turn shape snapshot and one-line reminder, composer selector, ui-quiet retired, and the render-contract `{}` unification. The render-fixture criterion lands at the content seam: the bare-object marker is now excluded by `hasAssistantReplyContent` (the same seam span folding reads) as well as by `AssistantNodeView`, pinned by the ui-chat contract suite; the fenced-code and `<tool_call>` tail fixture classes are deferred — capability-negative routes rely on the per-turn reminder plus the natural zero-tool-call ending, and the retained risk is bounded in Risks.
