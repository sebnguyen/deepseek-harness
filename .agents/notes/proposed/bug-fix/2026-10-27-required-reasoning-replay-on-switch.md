# Agent Note: a switch to a reasoning-required model replays turns whose reasoning was flattened

Status: proposed

## Problem

`digitalocean/reflection-beam` rejects any request whose history carries an
assistant turn without non-empty `reasoning_content`:

```
400 {"message":"The assistant turn at messages[241] is missing its reasoning.
Dropping reasoning from earlier turns degrades this model's output. Send it
back in 'reasoning_content', or set allow_missing_thinking=true to skip this
check.","type":"invalid_request_error"}
```

The endpoint ignores the waiver the adapter sends. Probed live against
`https://inference.do-ai.run/v1/chat/completions` with `reflection-beam`, one
prior assistant turn, and `reasoning_effort: max`:

| assistant turn shape | waiver placement | result |
|---|---|---|
| `reasoning_content: ""` | none | 400 |
| `reasoning_content: ""` | `chat_template_kwargs.allow_missing_thinking` | 400 |
| `reasoning_content: ""` | top-level `allow_missing_thinking` | 400 |
| `reasoning_content: ""` | both | 400 |
| `reasoning_content` absent | `chat_template_kwargs` | 400 |
| `reasoning_content: null` | none | 400 |
| tool-call turn, no `reasoning_content` | none | 400 |
| `reasoning_content: "some text"`, content `""` | none | **200** |
| `reasoning_content: "some text"`, content present | none | **200** |

The same empty field is accepted by `deepseek-v4.1-flash-1017`, so the rule is
per model, not per route: only the strict model needs non-empty reasoning on
every replayed assistant turn. `reasoning_effort: off` does not relax it.

## Why the harness sends the rejected shape

1. pi-ai re-emits a turn's thinking only when the assistant message matches the
   request's provider, api, and model (`transform-messages.js:68-70`); otherwise
   it converts the thinking block to plain `text` (`transform-messages.js:72-91`).
2. `foreignAssistant` stamps `api: 'dsh-foreign'` on every message with no pi-ai
   replay state, deliberately, so that same-provider/same-model history still
   reads as foreign (`packages/llm/llm-pi-ai/src/replay.ts:173-184`).
3. An interrupted attempt persists exactly such a message: `agent.ts:421-437`
   writes `assistant/message` with `interrupted: true` and only adds
   `replayState` when the provider's finish frame arrived — which it never does
   mid-stream.
4. The completions serializer then sees no thinking block and, because the
   DigitalOcean route sets `requiresReasoningContentOnAssistantMessages`
   (`packages/llm/llm-pi-ai/src/catalog.ts:205`), writes `reasoning_content: ""`
   (`openai-completions.js:1045-1049`).
5. The adapter's waiver adds `chat_template_kwargs.allow_missing_thinking`
   (`packages/llm/llm-pi-ai/src/adapter.ts:273-305`) and the endpoint ignores it.

The turn is durable, so the 400 repeats on every later request: restarting,
re-selecting the model, and continuing on the same model all reproduce it.

Evidence from the sessions that produced the reported errors:

- `~/.dsh/sessions/--home-snguyen-dev-digitalocean-PR_review_playground--/session-23462d49`
  — 239 assistant turns; 196 carry reasoning, 43 do not (`minimax-m3.1-flash`
  42, `deepseek-v4.1-flash-1017` 1). Wire `messages[241]` is the flattened
  reasoning text with `reasoning_content: ""`, immediately after the
  `[model changed: ...]` user notice, and still carries `tool_calls`.
- `.../idk--/session-b142ee93` — models `reflection-beam`; one assistant turn
  (seq 410, `interrupted: true`) carries a single `reasoning` block and no
  replay state, so it is stamped foreign and flattened on every replay.

## Proposal

Two parts, both inside the pi-ai adapter; neither touches pi-ai.

1. **Replay reasoning as reasoning.** When the target model requires
   `reasoning_content` (its compat says so) and the target api is
   `openai-completions`, emit historical assistant messages with the target's
   `provider`/`api`/`model` identity and `thinkingSignature: 'reasoning_content'`
   so pi-ai's same-model rule keeps the thinking and the serializer writes
   `reasoning_content` instead of `content`. Scope it to
   `openai-completions` + unsigned reasoning: a provider-native signature
   (Anthropic `thinking`, OpenAI `reasoning_details`) must not be replayed
   under another model. The durable assistant source keeps the producing
   model; only the wire replay identity changes.
2. **Decide what a turn with no reasoning at all becomes.** 43 of the turns in
   the failing session contain no reasoning block in the durable log, so part 1
   cannot repair them. Options are: drop such turns (and their paired tool
   results) when the target requires reasoning, fold their text into a
   neighbouring user/system note, or refuse the switch with a diagnostic
   instead of a 400 loop.

## Alternatives considered

**Fix the waiver placement.** Probed both placements; the endpoint rejects all
of them. There is no placement to fix.

**Drop `requiresReasoningContentOnAssistantMessages` from the route compat.**
pi-ai would then omit the field instead of sending `""`, which is also a 400
(probed). It would additionally hide the requirement from every non-strict
model on the route.

**Treat interrupted turns as same-model only.** Fixes the interrupted case but
not a real model switch, where the producing model genuinely differs.

**Fabricate reasoning for turns that have none.** Rejected: it invents content
the model never produced and would be indistinguishable from real reasoning.

## Risks

Part 1 makes the wire history honest about which text is reasoning and removes
the empty-string shape for every turn whose reasoning survives in the log. Part
2 is the product decision: a conversation that mixes reasoning-capable and
non-reasoning models cannot be replayed to a strict model without either losing
those turns or summarizing them.

## Acceptance criteria

`packages/llm/llm-pi-ai/tests/wire-capture.spec.ts` already captures the payload;
a case should assert that a foreign assistant turn carrying a reasoning block
reaches the wire as non-empty `reasoning_content` (not as `content` with
`reasoning_content: ""`) when the target model's compat requires reasoning. A
second case should pin that an Anthropic-signature turn is still downgraded.
The live probe above is the acceptance check for the strict model.

## Related

- [pi-ai missing reasoning waiver](implemented/bug-fix/2026-10-22-pi-ai-missing-reasoning-waiver.md)
  — the waiver this supersedes for endpoints that ignore it.
