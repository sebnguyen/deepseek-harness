# Agent Note: Turn shape collapses to two modes, quiet is a render filter

Status: proposed

## Problem

The three turn shapes (`narrate`, `quiet`, `tools`) plus their generation machinery do not deliver the promise they advertise, and they manufacture the defects they then have to clean up:

- **The machinery manufactures the leaks it sanitizes.** Working `quiet`/`tools` steps attach `toolChoice: 'required'` together with the strict empty-object `EMPTY_OBJECT_SCHEMA` shield ([conversation-mode grammar hints](../../implemented/feature/2026-10-13-conversation-mode-grammar-hints.md)). The repo's own note on the plugin records this exact combination as the cause of provider-fidelity degradation — "the model answers JSON instead of calling tools, or emits the tool call as free text" — and the observed transcript showed exactly that: `{"kind":"server-listening-question"}`, `{"kind":"fn-c","content":"ss"}`, `{"status":"diagnosed"}` and stray `{}` nodes, all model-emitted and rendered verbatim because the sanitizer only inspects `text` blocks and never touches reasoning.
- **The close is over-engineered.** `quiet` queues a separate wrap-up turn with `toolChoice: 'none'` to produce the final answer, and `finish` concludes the turn. That is a second LLM call and a latch to accomplish what a natural zero-tool-call completion already does.
- **`tools` is not a real mode.** It differs from `quiet` only in reminder wording and in skipping the wrap-up latch; no code branches on `=== 'tools'` beyond those two spots. Keeping it as a taxonomy entry buys a third menu item and nothing else.
- **The render contract is the missing half.** The design brief ([conversation-modes-redesign.md](../../../../design/conversation-modes-redesign.md) §3.3) already states the intended order: render contract first, generation hint second, with `toolChoice: 'required'` kept only as a cost optimization and the shield dropped by default. The shipped code inverts that order, and no ui-chat code reads the `turnShape` projection at all, so the UI paints every intermediate thought and narration regardless of shape.

The consequence: the harness asks the model to be silent, then pays to clean up the JSON it emits under that pressure, then pays again for a wrap-up call to produce the answer the model could have given on its own.

## Proposal

Collapse the taxonomy to two modes — `narrate` and `quiet` — and make `quiet` a **render filter**, not a generation constraint:

1. **`narrate` (unchanged).** Show thoughts, tool rows, and answers as today. No hints, no filter.
2. **`quiet`.** The model works normally — it may think and narrate freely; those tokens stay in context and help it reason. Reasoning (thinking) stays visible; only intermediate assistant messages (prose answers) that are neither the closing answer nor still streaming are suppressed at render time, in `AssistantNodeView`. Tool rows, errors, max-tokens notices, and the tail render as today. The final answer is the model's last message in the same turn — no wrap-up call, no latch.
3. **Drop the generation machinery.** Remove `EMPTY_OBJECT_SCHEMA` attachment, `toolChoice: 'required'` on working steps, and the quiet wrap-up latch and its tagged follow-up turn. The only hint that survives is a soft per-turn reminder: "work through thoughts and tool calls; narrate nothing now; answer only when the work is done." Keep `finish` registered and let it conclude the turn when called, but do not require it — a turn also ends naturally on a zero-tool-call assistant message, which is already the loop's completion condition ([agent.ts](../../../packages/core/agent-loop/src/agent.ts) `toolCalls.length === 0 → completed`).
4. **Fold `tools` into `quiet`.** A quiet turn where the model produces no final message renders no answer, which is the `tools` outcome ("no answer owed"). The renderer-generated status line the design brief sketches for `tools` ("ended after <tool> ✓") is deferred; if wanted later it is a quiet-tail variant, not a third mode.
5. **Implement the quiet tail fallback** the design brief already specifies but the code lacks: when a quiet turn's closing message sanitizes to empty, fall back to the last non-empty assistant answer so a quiet turn never closes on silence or `{}`. This is the safety net that replaces the wrap-up call's guarantee.
6. **Keep the reasoning sanitizer** (whole-body JSON reasoning dropped, shield `{}` dropped) as defense-in-depth for `narrate` and for any capability-negative route where the reminder is the only enforcement.

### Where the change lands

- `packages/client/ui-chat/src/client/chat/AssistantNodeView.tsx` — add the shape-aware quiet gate (read `useProjection('turnShape')`, which the slot already provides; return null for reasoning and non-final message nodes under `quiet`).
- `packages/client/ui-chat/src/client/contract/assistant-content.ts` — reasoning sanitizer (see the reasoning-sanitizer proposal).
- `packages/client/conversation-mode/src/index.ts` — remove the `EMPTY_OBJECT_SCHEMA`/`toolChoice: 'required'` attach and the wrap-up latch; keep the per-epoch reminder, now soft.
- `packages/client/conversation-mode/src/turn-shape.ts` — drop `EMPTY_OBJECT_SCHEMA` and `turnShapeWrapUpText`; trim `REMINDER_LINES` to the two-mode wording; `TURN_SHAPES` becomes `['narrate','quiet']`.
- `packages/client/conversation-mode/src/types.ts` — `TurnShape` union shrinks to two values; the `turn-shape/mode` event and projection are unchanged.
- `packages/client/conversation-mode/src/client/turn-shape-toggle.tsx`, the `/turn-shape` command, and `commands.setTurnShape` — validate against the two-value set.
- `packages/client/tool-turn-finish/src/index.ts` — `finish` keeps concluding the turn when called; the shape guard simplifies to `shape === 'quiet'` (narrate inert as before).

### Reconciliation with in-flight work

The working tree currently carries uncommitted strict-required and finish-tool upgrades (the proposed note [2026-10-14-turn-shape-strict-required-and-finish-tool.md](./2026-10-14-turn-shape-strict-required-and-finish-tool.md)) and a sticky-grammar-header bug fix. This proposal supersedes the strict-required direction: it removes rather than upgrades the grammar hints, so the strict-required note should be rejected (or consolidated into this one) rather than shipped, and the ephemeral-grammar fix becomes unnecessary because no ephemeral grammar fields are attached at all. The sanitizer and render-contract work already shipped stays.

## Alternatives considered

- **Keep the strict required + finish machinery (the in-flight proposed note).** Rejected: it is the mechanism that produces the leaks, and the design brief already says the shield should be dropped by default and the hint kept soft. Strictness buys a forced tool call at the cost of provider fidelity; the render filter achieves the same visual outcome without touching the model.
- **Keep three modes but strip grammar only.** Rejected: `tools` has no distinct behavior beyond reminder wording and the latch, so a third menu entry is surface area with no capability. Folding it into `quiet` loses nothing observable.
- **Render filter alone, no reminder at all.** Rejected: without a soft nudge, capable-but-obedient models still emit narration mid-task more often, and the filter would hide it but waste tokens. The reminder is cheap and keeps the model oriented; it is the one hint worth keeping.
- **Keep the wrap-up one-shot call.** Rejected: it exists to guarantee a clean final answer after a forced-silent working phase. Once working steps are unconstrained and the tail fallback covers the empty case, the guarantee is redundant and the extra call is pure cost and latency.
- **API-level silence (`tool_choice: 'required'` on every working step, no text possible).** Rejected for the same reason as the strict note: it is the documented degradation path, and the render filter makes it unnecessary. Reserve API forcing for the close step only if a future mode needs it.

## Acceptance criteria

- `TURN_SHAPES` is `['narrate','quiet']`; the toggle, command, and Remote validation accept only those two.
- Under `quiet`, reasoning nodes still paint; no non-final, non-streaming `assistant-step-message` node paints; tool rows, errors, max-tokens notices, and the closing answer paint as today.
- Under `quiet`, a working-step request carries neither `structuredOutput` nor a non-default `toolChoice`; narrate requests are unchanged.
- No wrap-up follow-up turn is queued; `quiet` turns close on the model's natural zero-tool-call completion or on `finish`.
- A quiet turn whose closing message sanitizes to empty falls back to the last non-empty assistant answer (no empty close, no `{}` close).
- `narrate` behavior is byte-identical to today.
- Capability-negative routes and llm-less compositions are unchanged (reminder-only, runtime strip verified).
- The sanitizer's existing fixture classes (bare `{}`, fenced `{}`, `<tool_call>` tail) still pass for `narrate`.

## Risks

- **Models that narrate mid-task waste tokens.** The filter hides the text but it is still generated and billed. Mitigation: the soft reminder reduces it; providers that support `tool_choice: required` at close only are unaffected. Acceptable trade-off — tokens are cheaper than provider degradation and leaked JSON.
- **A model that never stops calling tools loops indefinitely.** The loop has no built-in step cap (budgets live in the subagent driver). The reminder names `finish` as the exit; a forced steer at `agent/turn-stopping` or repeat-detection is the fallback, to be settled in implementation.
- **Loss of the "no answer owed" guarantee.** `tools` users who relied on silent completion with no final answer get a quiet turn that may still produce one. Mitigation: if the model produces none, nothing renders (already the filter behavior). If a hard no-answer mode is wanted later, it is a quiet-tail variant, not a third top-level mode.
- **Uncommitted strict-required work must be reconciled.** Shipping this note's direction means rejecting or consolidating the in-flight strict-required proposal rather than merging it; doing both would reintroduce the machinery this note removes.
- **What this gives up.** The forced-silence guarantee and the wrap-up call's clean-answer guarantee. The render filter and tail fallback are the replacement, and they are cheaper and provider-independent.
