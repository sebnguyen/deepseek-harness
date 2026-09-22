# Core prompt guidance sections

`dsh-system-prompt` now owns first-party **Core Personality** and eight **Core Rule:** sections at orders `10`–`90` per [docs/subsystems/core-prompt-guidance.md](../../../docs/subsystems/core-prompt-guidance.md). The former `harness:tool-batching` and `harness:tool-discovery` sections are removed; their requirements live in the standard-tools, context-over-inference, and batch core rules.

`includeHarnessIdentity` defaults to `false` so cache-stable prefixes no longer repeat model or harness branding. Shipped bundle patches clear `personaPrefix` model intros; `personaSuffix` still carries `{{cwd}}` where needed.

`includeCorePersonalityGuidance` and `includeCoreRulesGuidance` default to `true`. `harness:core-rule:prove-it` registers always but renders text only when `declare_claim` and `run_claim` appear in the assembly tool-name set; `assemble()` evaluates tool providers once and passes `registeredToolNames` on `AssembleContext` before section text resolves.

Filesystem, search, shell, and LSP tool plugins prefix guidance with `Advice:` via `adviceLine()` from `dsh-system-prompt`. Session snapshot `system-prompt.expected.md` oracles must be re-recorded or refreshed after this change.
