# Agent Note: Conversation modes no longer suppress thoughts — the grammar shield is retired

Status: implemented

## Problem

Under `quiet` and `tools` shapes, the transcript lost the model's thoughts
entirely: no `assistant-step-reason` sections, no thought counts on the step
span folds — while `narrate` kept them. The user-facing observation:
"conversation mode deleted the showing of thoughts, period."

Two plugin mechanisms were generation-side suspects; the renderer never had
shape-dependent code (`ui-chat` has zero turn-shape references):

1. **The strict empty-object `structuredOutput` shield** — attached to every
   quiet/tools working step on grammar-capable routes (`llm-deepseek`
   declares `structuredOutputOnRequest = true` adapter-wide, so the DeepSeek
   route always received it). The serializer puts
   `response_format: { type: 'json_schema', strict: true, schema: {} }` on the
   wire *next to* `thinking: { type: enabled }`
   (`packages/llm/llm-deepseek/src/serialize.ts:373,381`), and that
   combination suppresses the provider's reasoning stream — the thoughts
   simply never arrive.
2. **The reminder copy** promised "tool rows only", and the shape in general
   was designed (design/conversation-modes-redesign.md §3) to fold thoughts
   away as "working chatter".

Product call: thoughts belong in the transcript **regardless of the armed
shape**. The quiet/tools contract shrinks to working-step *prose* economy —
the reasoning channel always renders.

## Decision

Partly superseded: the grammar hints returned capability-gated — see [conversation-mode grammar hints](../feature/2026-10-13-conversation-mode-grammar-hints.md). The thoughts-in-every-shape product call and the incident record below still hold.

- **The plugin attaches no request-grammar fields in any form.** The
  `ctx.request-grammar` contribution (strict empty-object shield at the
  `turnShape` priority band) is deleted outright, and with it every
  capability query the shield needed (`llm.grammarCapability`).
  `EMPTY_OBJECT_SCHEMA` is removed from `turn-shape.ts`.
- **The reminder is the shape's only model-facing mechanism**, and its lines
  now state the promise honestly: `thoughts and tool rows` for both quiet
  ("close the turn with one plain answer") and tools ("the turn ends without
  a summary").
- **The composer tooltips follow** (`turn-shape-toggle.tsx`), and the
  package description no longer advertises a shield.
- The retired pieces stay retired with it: no `toolChoice`, no stop tool, no
  module-global finish flag — termination stays the loop's natural
  zero-tool-call rule, idempotent `concludeTurn` untouched.
- **`GRAMMAR_PRIORITY.turnShape` stays in `dsh-agent`** as a declared band —
  removing a public registry constant buys nothing, and the arbitration seam
  itself is unaffected (`subagent-in-process-driver` remains the sole
  conversation-adjacent consumer of `ctx.request-grammar`; docs regenerated).

## Consequences

- Thoughts (reasoning sections, span-fold thought counts) render in every
  shape; only working-step *answer prose* and the closing summary differ
  across shapes, enforced by reminder + the ui-chat render contract.
- Every quiet/tools request is wire-identical to a narrate request bar the
  one reminder line: no `response_format`, no `tool_choice`, verified by the
  updated host spec (`conversation-mode/tests/conversation-mode.host.spec.ts`,
  7 tests) across grammar-capable and capability-negative routes.
- Unshielded stray working-step prose (`{}` markers, leaked `<tool_call>`
  text) stays absorbed by the existing sanitizer
  (`ui-chat` `contract/assistant-content.ts`) — the render contract's job
  precisely, and the trade the redesign already accepts for
  capability-negative routes, now uniform across routes.
- Docs: `docs/capability-seams.md` regenerated (conversation-mode dropped
  from `ctx.request-grammar` consumers); `scripts/gen-doc-graphs.ts`
  `SERVICE_ROLES` updated accordingly.

## Risks

- **Stray-prose token cost returns** on routes that once shielded: accepted —
  the render contract absorbs the artifact class, and "thoughts in every
  mode" is the stated product requirement.
- Historical docs keep describing the shield: the redesign brief
  (`design/conversation-modes-redesign.md` §3.4) and the original turn-shape
  note remain as decision records; this note supersedes the shield section
  of the latter.

## Result

Request grammar mutation deleted from the conversation-mode plugin; reminder
and selector copy state thoughts-inclusive promises; 7/7 package specs pass;
`tsc -b` clean on the package; doc graphs regenerated with the expected
two-line diff.
