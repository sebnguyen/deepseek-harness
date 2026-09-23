# Core prompt guidance sections

`dsh-system-prompt` now owns first-party **Core Personality** and eight **Core Rule:** sections at orders `10`–`90` per [docs/subsystems/core-prompt-guidance.md](../../../../docs/subsystems/core-prompt-guidance.md). The former `harness:tool-batching` and `harness:tool-discovery` sections are removed; their requirements live in the standard-tools, context-over-inference, and batch core rules.

`includeHarnessIdentity` defaults to `false` so cache-stable prefixes no longer repeat model or harness branding. Shipped bundle patches clear `personaPrefix` model intros; `personaSuffix` still carries `{{cwd}}` where needed.

`includeCorePersonalityGuidance` and `includeCoreRulesGuidance` default to `true`. `harness:core-rule:prove-it` registers always but renders text only when `declare_claim` and `run_claim` appear in the assembly tool-name set; `assemble()` evaluates tool providers once and passes `registeredToolNames` on `AssembleContext` before section text resolves.

Filesystem, search, shell, and LSP tool plugins prefix guidance with `Advice:` via `adviceLine()` from `dsh-system-prompt`. Session snapshot `system-prompt.expected.md` oracles must be re-recorded or refreshed after this change.

The `harness:core-rule:concise` text forbids listing or announcing upcoming reads or tool calls in the reasoning stream ("Do not list or announce upcoming reads or tool calls; issue them instead of narrating them") and shows that anti-pattern in a `Not:` example, so the model calls a tool instead of first declaring which calls it is about to make.

`harness:core-rule:prove-it`, `dsh-tool-claim` `CLAIM_DEMAND`, and the per-turn pre-step reminder scope `declare_claim` to coding turns (repo edits or shell verification of a change) and tell the model to skip claims on explanation-only turns, matching how **Answer Structurally** gates the user-visible reply.

`harness:core-rule:concise` now enforces stream format (intent line, fact line), anti-patterns (re-derivation, plan churn, repo guessing), and a word budget instead of token bans alone. `harness:core-personality` adds that the stream is not user-facing justification memory.
