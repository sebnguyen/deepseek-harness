# Agent Note: pi-ai admits missing reasoning where the chat template requires it

Status: implemented

## Problem

A request replays every historical assistant turn. pi-ai re-emits a turn's thinking only when that turn came from the exact model the request addresses; another model's thinking is downgraded to text so a provider-native signature is never replayed against the wrong model. An endpoint whose chat template requires `reasoning_content` on every assistant message — any `openai-completions` route that sets `requiresReasoningContentOnAssistantMessages` — therefore receives an assistant turn with an empty `reasoning_content` and rejects the whole request with a 400. The failure surfaced on Reflection Beam after a session switched models or crossed a compaction checkpoint, because only then does the history carry a turn produced by a different model.

## Decision

A model profile may set `allowMissingThinking: true` on an `openai-completions` model. The adapter then amends the provider payload on pi-ai's `onPayload` hook, adding `chat_template_kwargs: {allow_missing_thinking: true}` to every request to that model, which is the endpoint's own waiver for an assistant turn whose reasoning could not be replayed. The amendment merges into template kwargs a chat-template thinking format already built rather than replacing them, and the wire capture records the amended payload because that is what the endpoint receives. The switch is a model profile field rather than a compat switch: pi-ai's compat type does not declare it, so it cannot ride the compat gates, and no protocol field describes which servers accept the template argument. Resolution refuses the field on any other protocol.

The replay layer keeps pi-ai's cross-model rule unchanged: a historical turn still reports the model that produced it, and another model's thinking is still downgraded instead of being replayed under a false identity.

## Alternatives considered

**Preserve the other model's thinking as this model's reasoning.** pi-ai downgrades cross-model thinking because a provider-native signature is only valid for the model that issued it; marking the turn as same-model would fabricate provenance. It also cannot cover a turn that carried no reasoning at all, which leaves the 400 in place.

**Send the waiver whenever `requiresReasoningContentOnAssistantMessages` is set.** pi-ai's own endpoint detection sets that compat switch for the DeepSeek route, and the installed `opencode-go` catalog carries it too, yet those APIs do not take vLLM chat-template arguments; the flag states a replay rule, not that the server accepts the waiver.

**Rely on `compat.chatTemplateKwargs`.** pi-ai reads those kwargs only under the `chat-template` thinking formats, and selecting one changes how the thinking level travels; a deployment that only needs the waiver would silently lose its reasoning-effort field.

## Consequences

Every request to an opted-in model carries one extra body field. The waiver is inert when every replayed assistant turn has reasoning, and the route's named request fields are untouched. A deployment that does not set the field keeps the 400 for cross-model history on a template-enforcing endpoint, which is the pre-change behavior.

An `openai-completions` route that requires reasoning content can now serve a history that crosses models; sessions that switch models or compact no longer brick the next thinking turn.

## Testing

`packages/llm/llm-pi-ai/tests/wire-capture.spec.ts` sends a request to a shipped DigitalOcean route whose model opts in and asserts the wire body carries `chat_template_kwargs.allow_missing_thinking`; a second case pins that a chat-template thinking format's own kwargs survive the amendment, and a route without the field sends no such key. `packages/llm/llm-pi-ai/tests/catalog.spec.ts` pins that only declared models land in `configuredAllowMissingThinking` and that a non-`openai-completions` model is refused.

## Related

- [pi-ai upgrade compatibility](2026-09-05-pi-ai-upgrade-compatibility.md) — why replay restores the producing model and lets pi-ai apply cross-model signature rules.
