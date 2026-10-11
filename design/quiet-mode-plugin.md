# Quiet Mode — shipped blueprint (v2)

Companion: `quiet-mode-mockup.html` (v2). Quiet mode keeps the transcript
*honest instead of hidden*: nothing is suppressed, the wire grammar enforces
the shape. There is **no summary node anywhere** — the turn's closing answer is
a real assistant message produced by a tool-free one-shot step.

The package is `@deepseek-ai/dsh-client-ui-quiet` (`packages/client/ui-quiet`).
One loader row, `ui-quiet`, rides the **base** bundle
(`packages/bundle/base/cordis.patch.yml`) so every profile carries the node
half. The web client discovers the browser half from that same row (`dsh.client`
on the package). A second insert in `web-app` collides: `duplicate loader entry
id: ui-quiet`. Manifest, tsconfig
references, web-app dep, and hand-written `tsconfig.base.json` paths entries
follow the repo checklist; `scripts/verify-client-packages.ts` and
`scripts/verify-cordis-config.ts` pass with the package included.

## 1 · The toggle — `conversation.input.right`

The composer renders `conversation.input.right` immediately before
`conversation.input.model` (`ui-conversation/.../skeleton/InputBar.tsx:522-523`),
so the Quiet button sits next to model selection. It is the primitives
`Button` (`variant: 'primary' | 'toolbar'`, `size: 'sm'`,
`IconThinkOutline16`, `aria-pressed`), same control family as the model seat.
State is the one-field quiet store (`enabled`, persisted `transcript.quiet`);
components read `useStore`, write `actions` — no component state.

```
ctx.slots.inject('conversation.input.right', () => ctx.slots.register(
  { name: 'conversation.input.right', id: 'quiet-toggle', order: 5, store: quietStore },
  QuietToggle,
))
```

## 2 · Working steps — grammar-forced tool-only

The node half registers a root `agent/request` waterfall listener (the loop
dispatches it per step at `core/agent-loop/src/agent.ts:530`) and attaches
`toolChoice: 'required'` plus `structuredOutput: EMPTY_OBJECT_SCHEMA` (empty
strict object). The model goes straight from reasoning into tool-call
arguments; any leaked answer text is grammar-bound to `{}` (~2 tokens), and
the skip in §5 drops that row. The contract field lives in `llm/src/types.ts`
(`ToolChoice`), DeepSeek maps it on the wire (`llm-deepseek/src/serialize.ts`),
and adapters without `toolChoiceOnRequest` never see it (runtime strip in
`llm/src/index.ts` mirrors the `structuredOutputOnRequest` gate). Gotcha: never
ship `tool_choice: "auto"` + `response_format` together
([vllm#39929](https://github.com/vllm-project/vllm/issues/39929)) — the explicit
`required` is what preserves the tool call. And the shield only binds with
`strict: true` on the schema: `llm-deepseek/src/serialize.ts` maps that hint
onto `json_schema.strict` (stripping it from the schema it gates), because a
non-strict `json_schema` envelope is best-effort matching and leaked answer
text sails through it.

## 3 · The stop — `quiet_finish`

`required` must always have an honest exit. The node half registers the
synthetic tool through `ctx.tools.register()`; its `execute` only flips a
finish flag and returns `{ stopped: true }` — deliberately **not**
`exec.concludesTurn()`, because the turn continues on into the one-shot
(stock generic tool card renders the call; no custom view).

## 4 · The finish — a one-shot, no schema, no summary

The next `agent/request` after the stop consumes the flag and attaches
`toolChoice: 'none'` with **no** `structuredOutput`: only thinking and answer
tokens are generated, and that answer **is** the closing message. The loop
settles the turn on the tool-free assistant message
(`core/agent-loop/src/agent.ts:487`). No auxiliary recap call, no capture, no
summary structured-output node, no `RECAP_SCHEMA` — all removed from earlier
drafts. The prepended model-visible reminder (`additionalContext`, the hook
protocol seam at `packages/hooks/hook-protocol/src/types.ts:127`) remains
optional: the grammar is the mechanism, the reminder is a backstop.

## 5 · Transcript behavior — nothing hidden

- **Answers:** the stock keyed renderer gains one guard in `ui-chat`
  (`chat/AssistantNodeView.tsx`): if the node's text channel is empty (or the
  grammar's `{}`) and the node does not own the turn tail, it renders no row.
  Non-empty content — including the finish one-shot's closing message —
  renders exactly as before, markdown/streaming/turn-tail untouched. The
  check mirrors the product's own `hasAssistantReplyContent` idiom
  (`conversation-nodes/turn-tail.ts`, span folds).
- **Thoughts:** render through the stock span folds; no custom rows.
- **Tools (incl. quiet_finish):** stock generic cards.

## Boundaries & open calls

1. Cross-half arming ships through the settings namespace: the toggle's
   `scope.set` lands on the Host document, and the node half's
   `installSection` watch flips the waterfall arm flag and the
   `quiet_finish` registration in the same commit. Without a settings
   provider (headless profiles) the composition entry keeps the node
   half armed — the stock behavior.
2. `pendingFinish` is module-scope: fine for one interactive session per host
   process (the web case); key it off the exec session for multi-session hosts.
3. `scripts/verify-tsconfig-paths.ts` crashes in this sandbox (tsx IPC
   `EROFS` on /tmp) — pre-existing environment quirk, unrelated to the
   hand-written paths entry the package adds.

Build/verify state: `pnpm run build` green (host + client + web), ui-quiet
unit spec for the removed recap template deleted with it; roster validators
pass with 56 client packages.
