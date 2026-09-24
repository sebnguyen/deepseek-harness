# Core prompt guidance sections

`dsh-system-prompt` now owns first-party **Core Personality** and eight **Core Rule:** sections at orders `10`–`90` per [docs/subsystems/core-prompt-guidance.md](../../../../docs/subsystems/core-prompt-guidance.md). The former `harness:tool-batching` and `harness:tool-discovery` sections are removed; their requirements live in the standard-tools, context-over-inference, and batch core rules.

`includeHarnessIdentity` defaults to `false` so cache-stable prefixes no longer repeat model or harness branding. Shipped bundle patches clear `personaPrefix` model intros; `personaSuffix` still carries `{{cwd}}` where needed.

`includeCorePersonalityGuidance` and `includeCoreRulesGuidance` default to `true`. `harness:core-rule:prove-it` registers always but renders text only when `declare_claim` and `run_claim` appear in the assembly tool-name set; `assemble()` evaluates tool providers once and passes `registeredToolNames` on `AssembleContext` before section text resolves.

Filesystem, search, shell, and LSP tool plugins prefix guidance with `Advice:` via `adviceLine()` from `dsh-system-prompt`. Session snapshot `system-prompt.expected.md` oracles must be re-recorded or refreshed after this change.

The `harness:core-rule:concise` text forbids listing or announcing upcoming reads or tool calls in the reasoning stream ("Do not list or announce upcoming reads or tool calls; issue them instead of narrating them") and shows that anti-pattern in a `Not:` example, so the model calls a tool instead of first declaring which calls it is about to make. The [rationale-led rewrite](2026-09-24-rationale-led-prompt-guidance.md) replaces that rule's body with the reason narration is waste, so the prohibition rests on the private stream rather than on a stream format.

`harness:core-rule:prove-it`, `dsh-tool-claim` `CLAIM_DEMAND`, and the per-turn pre-step reminder scope `declare_claim` to coding turns (repo edits or shell verification of a change) and tell the model to skip claims on explanation-only turns, matching how **Answer Structurally** gates the user-visible reply.

`harness:core-rule:concise` now carries the reason the stream is worth spending and the anti-patterns that follow from it (re-derivation, plan churn) instead of a stream format and a word budget, per the [rationale-led rewrite](2026-09-24-rationale-led-prompt-guidance.md). `harness:core-personality` states that nobody reads the stream and the reply is the deliverable.

The section layout, order names, labels, and registration described here stay in force. [Rationale-led core prompt guidance](2026-09-24-rationale-led-prompt-guidance.md) restates every section's text around its reason, the ten Core Rule bodies included, while keeping the section names, order, and labels described here. It drops the stream format this note introduced for `harness:core-rule:concise`, on the ground that an intent line and a fact line narrate work to a reader who reads only the reply.
