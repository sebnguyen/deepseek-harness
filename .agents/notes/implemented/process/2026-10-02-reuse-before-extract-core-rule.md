# Agent Note: Reuse Before Extract is a core rule in the assembled system prompt

Status: implemented

## Problem

Models editing this codebase repeatedly extract a single call site into a private, module-level helper instead of reusing an existing function, and they ignore prompt rules that ask them not to. The failure surface is the harness's own prompt pipeline: every behavior rule that reaches a model, on this repository or on any deployment of it, is carried either as assembled system-prompt text or as documentation outside the model's context at generation time. Repository prose (root `AGENTS.md`, `dsh-code-review`, review skills) shapes only the agents that load that prose, and past prompt wording against over-abstraction has not reliably changed model behavior anywhere. The harness therefore needed the rule inside the core guidance every assembly ships, stated as a decision procedure a model can follow mid-turn, not as a style preference.

## Decision

Core Rule `Reuse Before Extract` is a built-in section of `dsh-system-prompt`: `harness:core-rule:reuse-before-extract`, order `130` in `SECTION_ORDERS`, appended after Close The Idle Turn in `CORE_RULE_SECTIONS` so every existing deployment picks it up through the shared allocation. It tells the model to name the behavior the code needs and search package exports and the workspace for that behavior before writing a helper, that adopting a maintained function or a dependency that deletes the code beats authoring a twin, and that when nothing existing fits, a helper with one lone small call site folds into its caller until a second call site, an export, or a body too large to read inline earns the name. The text follows the oracle formatting rules of [core-prompt-guidance.md](../../../../docs/subsystems/core-prompt-guidance.md): plain ASCII prose, one paragraph, closing `Example:` line, no markdown or glob metacharacters.

The rule rides the existing core-rule mechanics unchanged: `includeCoreRulesGuidance` governs it, `coreGuidanceParagraphs` renders it, `system-prompt.spec.ts` pins its character ceiling (676) beside the per-section ceilings and the aggregate, and the oracle page carries the order-allocation row and the verbatim paragraph.

## Alternatives considered

**A repository lint or ratcheting gate over helper declarations.** Detection by syntax alone cannot tell useful extraction from waste: it would flag recursive helpers, callbacks, and intentional local naming, and any baseline ratchet over a historical corpus adds a maintained manifest plus false-positive triage for every contributor. Repo doctrine already covers this codebase with review (`dsh-code-review` names the evidence a helper needs) and `jscpd` for duplication; the gap this note closes is the models the repository's prose never reaches.

**Prompt injection at the skill or preset layer.** A preset or skill can recommend reuse, but presets are opt-in compositions and skills load conditionally; the rule would then miss the default, headless, SDK, and ACP assemblies exactly where unattended models do the most extraction. Core rules exist precisely because they are the one guidance every assembly carries.

**Merging the rule into Context Over Inference or a tool `Advice:` line.** Context Over Inference governs gathering facts for arguments, not choosing between reuse and new code, and `Advice:` lines scope to one tool while the rule spans search tools, exports, and dependencies; folding it would make it the first sentence of someone else's rule and the budget ratchet would own it awkwardly.

## Consequences

Every composed prompt grows by one section (~676 characters), charged against the prompt budget's aggregate ceiling in the same change that adds it, so the cost is visible and ratcheted. Snapshots and e2e goldens that pin rendered core guidance refresh through their existing `DSH_SNAPSHOT=refresh` and Web refresh flows; replay tiers that scrub or exclude guidance are untouched. The rule raises no new mechanics — no config field, no new section machinery — so deployments that suppress core rules suppress this one with them. Judgment the text cannot make (when a named helper genuinely aids debugging, when a callback needs a stable reference) stays with review; the rule states the default and the evidence bar, not a veto.
