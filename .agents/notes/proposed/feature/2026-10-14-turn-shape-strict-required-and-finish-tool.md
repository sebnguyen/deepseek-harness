# Agent Note: Strict tool-required hints and a finish() tool for Quiet and Tools only

Status: proposed

## Problem

The Quiet and Tools only turn shapes promise strict working-step output — thoughts and tool rows, nothing else — but that promise currently fails in two stacked ways: the enforcement that exists is soft, and the selection path beneath it does not work end-to-end.

- **The enforcement is soft, not strict.** The shipped mechanism ([conversation-mode grammar hints](../../implemented/feature/2026-10-13-conversation-mode-grammar-hints.md)) attaches `toolChoice: 'auto'` plus the strict empty-object `EMPTY_OBJECT_SCHEMA` shield and a one-line per-turn reminder. `auto` leaves every working step free to emit plain prose, so the shape's promise rests on model obedience, with the ui-chat sanitizer sweeping up leaked `{}` bodies after the fact. Headless and API surfaces, which have no sanitizer, inherit the leaks directly.
- **The sync path works; nothing enforces the shape.** Verified 2026-10-14 against the live web deployment's session logs (digitalocean `openai-completions` route via pi-ai): a composer pick appends `turn-shape/mode` into the running agent's own log (UI and Host cannot drift — one process, synchronous fold, control-frame push back to the pill), and the very next turn's wire payload carries the injected `[turn-shape] Turn shape: ...` reminder, persisted as a `user/message` with `source.kind: 'turn-shape'`. What no request on that route ever contains is a grammar field: across every request in a real tools-only session, zero `tool_choice` and zero `response_format` entries appear on the wire — somewhere among the `grammarHints` switch, the `grammarCapability` resolution, and the adapter's runtime strip, the turn-shape hints die before dispatch. On the deployed stack the shapes therefore run reminder-only, and a reminder is all the enforcement there is — the mechanism looks enabled and observably does nothing.
- **Strict enforcement requires an explicit exit.** The agent loop ends a turn on a zero-tool-call assistant message (`packages/core/agent-loop/src/agent.ts`: `toolCalls.length === 0 → completed`). Under `toolChoice: 'required'` that message is wire-inexpressible — every step must call a tool — so a strictly-required quiet/tools turn could never close on its own. The retired ui-quiet v2 proved both halves of this: `quiet_finish` as the honest exit alongside `toolChoice: 'required'` ([design/quiet-mode-plugin.md](../../../../design/quiet-mode-plugin.md) §2-4), and the module-global `pendingFinish` race that got the pairing deleted ([plugin turn-shape note](../../implemented/feature/2026-10-11-conversation-mode-plugin-turn-shape.md); the [grammar-hints note](../../implemented/feature/2026-10-13-conversation-mode-grammar-hints.md) recorded reviving the tool as a rejected alternative).

## Proposal

Make Quiet and Tools only strict end-to-end, in dependency order:

1. **Close the route capability gap, and surface inert grammar.** The measured seam is not the selection path (verified below) but the wire path: on the deployed route no grammar field ever ships, so every hint — soft or strict — is inert there. Diagnose which of the three drops it (the config switch, `grammarCapability`, or the adapter strip on `toolChoiceOnRequest`/`structuredOutputOnRequest`), extend the deployed route's capability until the fields ship, and when a route still cannot carry them, make the UI say so — the pill shows the mode as reminder-only instead of implying wire force. Also surface a failed `setTurnShape` Remote in the UI instead of `console.error`. Until the fields visibly ship on the deployed route, nothing below is observable.
2. **Upgrade the working-step hint from `auto` to `required`, keeping the strict shield.** In the existing `GRAMMAR_PRIORITY.turnShape` contribution (`packages/client/conversation-mode/src/index.ts:196-217`), quiet/tools working steps carry `toolChoice: 'required'` plus the strict `EMPTY_OBJECT_SCHEMA`, capability-gated exactly as today (`llm.grammarCapability`). This is the pairing the retired v2 proved safe: `required` plus a strict `json_schema` shield, never `auto` + `response_format` together (the recorded [vllm#39929](https://github.com/vllm-project/vllm/issues/39929) caveat). `narrate` contributes nothing, as today.
3. **Introduce a `finish` tool as the turn's explicit exit.** A strict zero-argument tool — same schema discipline as `EMPTY_OBJECT_SCHEMA` — registered per (agent, turn) while a quiet/tools turn is open, so narrate turns never see it and the tool list stays shape-scoped:
   - **Tools only:** `finish` calls `exec.concludesTurn()` (`packages/core/agent-loop/src/tool-calls.ts:154-158`); the finish tool row is the turn's tail. The no-summary promise holds.
   - **Quiet:** `finish` marks the turn's finish state on the turn context — keyed per session, existing turn-context machinery ([turn-shape session scope](../../implemented/architecture/2026-10-12-turn-shape-session-scope.md)), never the retired module-global `pendingFinish`. The next request runs the shipped hint-free wrap-up step (`turnShapeWrapUpText`, with `toolChoice: 'none'` attached where capable to pin "no tool calls"), the model emits one plain closing answer as a real assistant message, and the loop settles on the natural zero-tool-call completion.
4. **Keep everything else as shipped.** The render contract (sanitizer) stays as defense-in-depth for capability-negative routes, which remain reminder-only; the `/turn-shape` command and projection semantics are untouched.

### Where the change lands

- `packages/client/conversation-mode/src/index.ts` — the grammar attach moves `auto` → `required` on working steps; the existing wrap-up abstention gains the `toolChoice: 'none'` pin; the finish tool registers and disposes per turn.
- `packages/client/conversation-mode/src/turn-shape.ts` — the finish tool's strict empty-args schema lives next to `EMPTY_OBJECT_SCHEMA`.
- `packages/client/conversation-mode/src/client/turn-shape-toggle.tsx` — the fire-and-forget pick reports surfaced failures.
- Arbitration order is already declared: `GRAMMAR_PRIORITY.turnShape` (200) below structured-output drivers (300) and staging (400); a capture driver still wins the `structuredOutput` slot, and `finish` must compose with `structured_output`'s own `concludesTurn` use.
- Adapter safety is unchanged: `toolChoiceOnRequest` gates the field and the runtime strips it for incapable routes.

## Alternatives considered

- **Keep the soft `auto` hint and reminder (status quo).** Loses on its own terms: the promise resolves to model obedience plus a client-side sanitizer, sessions surface prose leaks, token waste stays, and headless/API surfaces have no sanitizer at all. The [grammar-hints note](../../implemented/feature/2026-10-13-conversation-mode-grammar-hints.md) records why `auto` was chosen over the deleted strict machinery; this proposal repairs the sync path and the flag placement that made strict unacceptable then.
- **`required` without a finish tool.** Incoherent: the loop's completion condition is a zero-tool-call message, which `required` makes wire-inexpressible; a turn could only end via budget or error — a hard failure, not a close.
- **`finish(answer: string)` as a capture-style argument tool.** Loses: the closing answer must be a real assistant message for the render contract and the quiet wrap-up promise; burying it in a tool argument breaks renderers, sanitizers, and the grammar bands' own "cost hints, never capture" rule.
- **`concludesTurn` for both shapes, dropping the quiet wrap-up step.** Loses: quiet's promise is one closing plain answer; concluding at the finish call would close quiet turns on a bare tool row — i.e., quietly deleting the quiet/tools distinction.
- **Loop-level per-shape stop rules instead of a tool.** Loses: the agent loop stays shape-agnostic; the `concludesTurn` seam and `agent/turn-stopping` hooks already exist for exactly this, and shape policy belongs in the conversation-mode contribution.
- **Module-global `pendingFinish` (the retired v2 mechanics).** Loses for the reason recorded in the [plugin turn-shape note](../../implemented/feature/2026-10-11-conversation-mode-plugin-turn-shape.md): process-wide state races across sessions and agents. This proposal exists only with the finish state keyed on the turn context.

## Acceptance criteria

- A quiet/tools pick is visible in the next turn's wire request on the deployed route: the `[turn-shape]` reminder present today, `tool_choice: 'required'` and the strict empty-object `response_format` new; a route that cannot carry the grammar fields is flagged to the user as degraded instead of silently pretending enforcement. A failed `setTurnShape` surfaces in the UI rather than `console.error`.
- Quiet/tools working-step requests on grammar-capable routes serialize with `tool_choice: 'required'` plus the strict empty-object `response_format`; narrate requests carry neither.
- `finish` appears in the tool list only while a quiet/tools turn is open; narrate turns see no tool-set or grammar change.
- A tools turn that calls `finish` ends on the finish tool row with no trailing assistant text.
- A quiet turn that calls `finish` takes exactly one further hint-free (`toolChoice: 'none'` where capable) step and closes with one plain assistant answer; no second wrap-up fires.
- Capability-negative routes and llm-less compositions are unchanged: reminder-only, with the runtime strip verified.
- Two concurrent sessions/agents exercising `finish` interleave with no cross-talk (turn-scoped state; no module globals).

## Risks

- **Wire-fidelity regression.** The [plugin turn-shape note](../../implemented/feature/2026-10-11-conversation-mode-plugin-turn-shape.md) retired `required` partly because half-supporting stacks answered JSON text or free-text `<tool_call>` spans instead of calling tools. The sanitizer and capability gates bound that, and `grammarHints: false` remains the deployment-wide rollback, but `required` re-exposes the class.
- **A model that never calls `finish` loops indefinitely.** The loop has no built-in step cap (budgets live in the subagent driver). Mitigation details to settle in implementation: the reminder names `finish` as the exit, and a forced steer at `agent/turn-stopping` or a repeat-detection notice is the fallback.
- **Capability-negative routes are the silent blocker.** Measured on the shipped stack today: every grammar field is dropped pre-dispatch, and nothing in the UI or logs flags it — 'not working' reports from soft enforcement to strict will keep arriving until the route carries the fields or the UI admits it cannot. The strict proposal's true first dependency is a capability-positive deployed route, then surface-when-degraded behavior.
- **Turn-scope regressions.** The finish state must live on the turn context keyed per session; reintroducing module-global state reopens the retired v2 race.
- **Exit-trigger composition.** Between `finish` and a capture driver's `structured_output` conclude, one turn must still produce one ending; confirm conclude-idempotence per turn (the [redesign](../../../../design/conversation-modes-redesign.md) §3.4 records this requirement).
- **What this gives up.** `auto`'s occasional useful mid-turn prose (clarifications, status lines) gets forced into tool calls or shielded `{}` — the strictness is the feature, but the honest-prose escape hatch disappears.
