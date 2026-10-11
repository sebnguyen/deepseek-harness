# Conversation modes — investigation & redesign brief

Companion: `quiet-mode-plugin.md` (shipped v2 blueprint), `quiet-mode-mockup.html`,
`conversation-report-view-mockup.html`. Supersedes the mode taxonomy in
`packages/client/ui-quiet` (Normal / Quiet / Silence) with one mental model,
because the current one fails in practice in two distinct, reproduced ways.

## 1 · What users actually see (evidence)

From a real session (2025-10-09/10), same turn shape each time:

1. **Silence ends the turn on raw wire grammar.** The transcript shows
   `1 thought · 1 tool call` followed by a literal `<tool_call>` tag
   rendered as the assistant's entire visible output, then the turn closes.
   The model's stop signal arrived as *text-channel tokens* (tool_choice
   grammar pressure made it emit the call as free text instead of, or beside,
   a structured call). The loop saw no structured tool call and no conclude,
   so the turn ended on whatever leaked, and the renderer printed the wire
   artifact verbatim.
2. **Quiet prints `{}` as the whole answer.** The empty-object leak shield
   (`structuredOutput` with `strict: true`) bound the leaked answer channel to
   the two-token string `{}`. The `AssistantNodeView` guard
   (`packages/client/ui-chat/src/client/chat/AssistantNodeView.tsx:31`,
   `replyText === '' || replyText === '{}'`) exists for exactly this, but the
   observed row still rendered — either the value carried surrounding
   whitespace/markdown so the exact-match guard missed it, or the node owned
   the turn tail (`owner !== undefined` disables the guard entirely, and a
   quiet turn's finish one-shot *is* the tail owner). Either way the user's
   closing impression of "Quiet" is a bare `{}`.
3. **Mode switching does not take effect where it matters.** The selector
   (`packages/client/ui-quiet/src/client/index.tsx:117`) writes the shared
   `ui-quiet` settings namespace; the node half
   (`packages/client/ui-quiet/src/index.ts:96-104`) re-arms per change. The
   grammar fields, however, are read once per request at the `agent/request`
   waterfall (`index.ts:116-128`) — switching mid-turn never changes the turn
   in flight, and switching right before a turn races the settings round-trip
   (browser → Host document → node watch), so a fresh turn can start on the
   stale mode. Users experience this as "switching between modes does not
   work", because they switch *while looking at a broken turn* and the next
   visible step still obeys the old grammar.
4. **Modes compose badly with other grammar writers.** The same session
   shows `[staging]` escalation injecting its own constraints and tool
   gating. ui-quiet's `toolChoice`/`structuredOutput` attach happens in a
   waterfall with no arbitration against staging, subagent drivers
   (`packages/subagent/subagent-in-process-driver/src/structured.ts` uses its
   own structured output), or presolved schemas — last-writer-wins with no
   declared priority. With Silence + Explore-stage active, the stop tool and
   the stage gate fight over who concludes the turn; the observed outcome
   was a failed tool frame *and* a raw-text tool call in one turn.

## 2 · Root causes (the four design sins)

1. **Enforcement by optional wire fields is a suggestion, not a mode.**
   `tool_choice: required` + `json_schema strict` are per-request provider
   hints of varying fidelity (the shipped blueprint already documents the
   vllm#39929 class of failure: stacks that answer JSON instead of calling
   tools). A product *mode* built on them inherits every provider quirk,
   including "the model prints `<tool_call>` as text".
2. **The mode's name promises a transcript property the renderer only
   half-enforces.** "Quiet/Silence" promises *what you see*; the mechanism
   controls *what the model may emit*. The gap between those is filled by
   exact-string guards (`'{}'`) that any whitespace defeats, and by the
   turn-tail exception that re-exposes the artifact on the one row users
   read first.
3. **Arming is global, live, and racy against consumption.** One persisted
   field decides the grammar for every request of every turn, read at
   request time. There is no per-turn snapshot, so the UI state, the node
   state, and the in-flight request can disagree three ways at once, and
   `pendingFinish` (module scope, `index.ts:43`) adds a fourth.
4. **Three modes encode two independent choices.** (a) suppress working-step
   chatter, (b) add or omit a closing answer. Encoding a×b minus one cell as
   named modes (Normal/Quiet/Silence) forces users to learn implementation
   outcomes ("does Silence still talk at the end?") instead of stating
   preference, and gives QA three grammars to break instead of two toggles.

## 3 · Target design — "Turn shape", not "modes"

Replace the mode menu with one **Turn shape** control expressed as output
preference, enforced as a *render contract* first and a *generation hint*
second — invert the current priority.

### 3.1 The user-facing contract (what we promise)

| Shape | Working steps | Turn close | Provider dependence |
|---|---|---|---|
| **Narrate** (default, = Normal) | thoughts/tools/answers as today | final answer as today | none |
| **Work quietly** (= Quiet) | tool rows only; thoughts folded | one closing answer | soft hint only |
| **Tools only** (= Silence) | tool rows only; thoughts folded | last tool row closes; a one-line status line is generated *by the renderer*, not the model | none |

The promise is about the *transcript*, and the transcript is ours: every
property in the table holds even if the model ignores every hint, because
the renderer owns it (3.3). Generation hints (3.4) then merely reduce token
waste; they are no longer load-bearing.

### 3.2 One persisted, per-turn-snapshotted setting

- Single field `conversation.turnShape: 'narrate' | 'quiet' | 'tools'`
  (kept in the same `ui-quiet` namespace as a migration alias; legacy
  booleans and `silence` map through an extended `normalizeQuietMode`).
- The turn snapshots the value **when the turn's first request is built**
  (a turn context stamped by the agent loop, not a module-global). Switching
  mid-turn applies from the next turn, and the composer shows
  "applies to next turn" while a turn is open. This deletes race #3 and the
  `pendingFinish` module state (the flag moves onto the turn context, keyed
  by exec session, fixing multi-session hosts — open call #2 in the shipped
  blueprint).
- Presets (`ui-agent-preset`) may set the shape among other seats; the
  preset seat shows the resulting shape chip so the composed outcome is
  visible. Presets fill the default; an explicit user choice wins (pending
  user confirmation, see §5).

### 3.3 The render contract (renderer owns the promise)

In `ui-chat`, replace the exact-string guard with a normalization pipeline
on the text channel before `hasAssistantReplyContent` ever runs
(`contract/assistant-content.ts`):

1. Strip wire-grammar artifacts: trailing/unparseable `<tool_call>…`
   spans, lone `{}` / whitespace-only JSON of the shield schema (including
   ```json-fenced variants), and empty text. This is also the fix for the
   known message-tail bug recorded in `design/MOCKUP_NOTES.md` — one
   sanitizer shared by normal and quiet turns instead of a mode-scoped
   special case.
2. If the sanitized channel is empty and the node is not the turn tail →
   render no row (current behavior, now robust).
3. If the shape is `tools` and the node is the tail → render the renderer-
   generated status line ("ended after <tool> ✓") instead of model text.
4. If the shape is `quiet` and the tail node's sanitized text is empty →
   fall back to rendering the last non-empty answer of the turn, so a quiet
   turn can never close on silence or on `{}`.

The sanitizer is unit-testable against the exact artifacts observed — the
`<tool_call>` text tail, `{}`, and fenced variants from the user's
transcript become fixture rows.

### 3.4 Generation hints (soft, arbitrated)

- Working steps under `quiet`/`tools`: keep `toolChoice: 'required'` as a
  *cost optimization* only, and drop the empty-object `structuredOutput`
  shield by default — it is the component that converts model confusion
  into visible `{}`. Ship it behind a per-deployment capability flag
  (`llm-deepseek` serialize already gates such fields) for stacks proven to
  honor it; default off.
- `quiet_finish` stays (honest exit for `required`), relabeled "wrap up" in
  copy; under `tools` it still concludes; under `quiet` the one-shot stays
  but its output now goes through 3.3, so a failed one-shot degrades to the
  fallback answer row instead of `{}`.
- New: a **grammar arbitration** seam — one ordered registry of request
  mutators (staging escalation > structured-output drivers > turn shape >
  presets) replacing today's unordered waterfall last-write-wins, so
  Silence+Explore can never double-conclude a turn again. Concretely: move
  `toolChoice`/`structuredOutput` attaches from free-form `agent/request`
  listeners into a declared `request-grammar` contribution with priorities,
  and make `concludeTurn` idempotent per turn (second conclude in one turn
  logs and no-ops).

### 3.5 Selector UX

- Replace the three-mode `Menu` with a segmented pill on the composer:
  `Narrate · Quiet · Tools only`, each with a one-line tooltip stated in
  transcript terms ("hide working chatter", "end without a summary").
- While a turn is streaming, the pill shows the shape *in effect* for that
  turn and marks a pending change with a dot ("next turn"). This is the
  visible fix for "switching doesn't work": the control now tells the truth
  about when it applies.

## 4 · Migration & rollout

1. Renderer sanitizer + tail fallback (3.3) — pure `ui-chat`, no grammar
   change; instantly fixes observed `{}` and `<tool_call>` rows in
   all modes. Ship first.
2. Turn-context snapshot + `pendingFinish` relocation (3.2) — node half of
   `ui-quiet`, settings field aliased; e2e: switch mode mid-turn, assert
   turn N keeps old shape and turn N+1 uses the new one.
3. Grammar arbitration + shield-default-off (3.4) — cross-package
   (`core/agent-loop`, `llm`, staging package), gated by capability flag.
4. Segmented selector + copy (3.5); rename Silence→"Tools only" with the
   old ids accepted by the normalizer.

Test matrix: each shape × {model honors `required`, model leaks text, model
leaks `{}`, switch mid-turn, staging active}, with the transcript rows as
snapshots.

## 5 · Open questions for the user

- Is the renderer-generated closing status line under `tools` acceptable,
  or must the turn end with literally zero assistant text (today's Silence
  promise)?
- Should presets be allowed to override an explicit user shape choice, or
  only fill the default (brief assumes: only fill)?
