# Agent Note: Core prompt guidance sections

Status: implemented

## Problem

The model's standing operating rules arrived through bundle persona intros and ad-hoc `harness:tool-batching` / `harness:tool-discovery` sections: deployment-varying text that repeats branding in the cache-stable prefix, with batching and discovery requirements living apart from the general rules they refine. First-party personality and rule guidance needs one owner that places every section in a stable, repository-owned order so the prompt prefix stays cache-stable and the requirements stop drifting between two homes.

## Decision

`dsh-system-prompt` owns first-party **Core Personality** and eight **Core Rule:** sections at orders `10`–`90` per [docs/subsystems/core-prompt-guidance.md](../../../../docs/subsystems/core-prompt-guidance.md); the former `harness:tool-batching` and `harness:tool-discovery` sections are retired with their requirements folded into the standard-tools, context-over-inference, and batch core rules. `includeHarnessIdentity` defaults to `false` so cache-stable prefixes carry no model or harness branding; shipped bundle patches clear `personaPrefix` model intros while `personaSuffix` still carries `{{cwd}}` where needed. `includeCorePersonalityGuidance` and `includeCoreRulesGuidance` default to `true`.

`harness:core-rule:prove-it` registers and renders its tool-free text unconditionally, while `dsh-tool-claim`'s `CLAIM_DEMAND` and the per-turn pre-step reminder scope `declare_claim` to coding turns (repo edits or shell verification of a change) and tell the model to skip claims on explanation-only turns, matching how **Answer Structurally** gates the user-visible reply. `assemble()` evaluates tool providers once and passes `registeredToolNames` on `AssembleContext` before section text resolves; of the built-in rules only explore-through-explorers uses that gate, so a composition without a named tool is never steered toward it.

`harness:core-rule:concise` forbids listing or announcing upcoming reads or tool calls in the reasoning stream and shows that anti-pattern in a `Not:` example, and carries the reason the stream is worth spending plus the anti-patterns that follow from it (re-derivation, plan churn) instead of a stream format and a word budget. `harness:core-personality` states that nobody reads the stream and the reply is the deliverable. Filesystem, search, shell, and LSP tool plugins prefix guidance with `Advice:` via `adviceLine()` from `dsh-system-prompt`.

The section layout, order names, labels, and registration described here stay in force; [Rationale-led core prompt guidance](2026-09-24-rationale-led-prompt-guidance.md) owns every section's body text, restated around its reason, while keeping the section names, order, and labels described here.

## Alternatives considered

**Keep rule text in bundle persona intros.** Lost: persona text is deployment-varying, repeats branding inside the cache prefix, and lets a deployment silently drop operating rules the repository considers standing.

**Keep `harness:tool-batching` and `harness:tool-discovery` as separate sections.** Lost: their requirements are refinements of the standard-tools, context-over-inference, and batch core rules; two homes for one set of requirements drift, and the duplicate ordering slots spend prefix bytes.

## Consequences

Session snapshot `system-prompt.expected.md` oracles refresh whenever the owned text changes. The core-rule bodies live in the [rationale-led rewrite](2026-09-24-rationale-led-prompt-guidance.md); this note remains the authority for layout, order, labels, registration, and the config flags that gate them.
