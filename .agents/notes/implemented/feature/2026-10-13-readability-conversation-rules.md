# Agent Note: Readability conversation rules, shipped as one prompt section

Status: implemented

## Problem

Model replies are grammatically fluent but drift toward readability failures that the linguistics literature predicts exactly. Coh-Metrix research (Graesser, McNamara, Louwerse & Cai 2004) shows lexical cohesion — using the same term for the same thing — predicts comprehension better than classic readability formulas, and agent replies routinely swap synonyms turn over turn («session projection», «projection store», «the folded state»). Gibson's Dependency Locality Theory (Gibson 2000, *Cortex*) shows comprehension cost scales with the distance between dependent words, and agent answers routinely interpose long clauses between subject and verb and embed several clauses deep. Clark & Haviland's given–new contract predicts the cost of answers that open with new detail and arrive at the conclusion last. Plain-language and usability research (active agent-first voice, concrete verbs over nominalizations; Morkes & Nielsen's concise-scannable-objective usability study) adds the register rules, and O'Reilly & McNamara (2007) adds the calibration caveat: high-knowledge readers can lose comprehension when text is over-simplified, so one fixed style level is wrong for every audience.

The harness already governs how agents act; nothing governs the register and term stability of the prose the agent emits. A vocabulary the conversation settled in turn three — the user's project codename, a session key definition, a coined workspace term — is re-invented every turn because the model holds no instruction list for register and no memory of its own naming across requests.

## Decision

`packages/context/readability-rules` (`@deepseek-ai/dsh-readability-rules`) contributes exactly one `ctx.systemPrompt.section(...)` — `readability:plain-answers` at external order 143 — carrying four core rules selected at review (Answer First, Readable Sentences, One Name Per Concept, Active, Concrete Language), rationale-forward and free of numeric checkpoints, with the section text pinned verbatim in `PLAIN_ANSWERS_RULES`. The package ships enabled in `packages/bundle/base/cordis.patch.yml` (row `readability-rules`) with a matching `dependencies` entry, disables per-deployment by row `id`, and carries no consumer-facing `Config` — no tools, no session events, no projections, no model artifacts, so model-visible ⟺ logged needed nothing new. The rules inside the section derive one-to-one from the findings in the Problem section: conclusion-first and given→new ordering from Clark & Haviland; dependents-close from Gibson's Dependency Locality Theory; reuse-the-exact-term from the Coh-Metrix cohesion result (term stability delivered behaviorally instead of through a registry); active, concrete language from the plain-language empirical line.

The prompt is the whole enforcement surface, deliberately. During scoping, observational machinery (a `term_define` registry, a harvesting detector, an embedding-backed vocabulary reminder) was built out on paper and then shelved, on the owner's cut: its detector would read model-generated chat, and whether a model writes definitional prose on any given day is unknowable before telemetry — an unverifiable premise at the input of the entire chain. The four rules need no such premise.

Two further drafted rules (Scannable Layout, Read the Reader) were cut from the launch set at selection: layout belongs to client presenters more than prompt text, and reader calibration asks for a per-request audience hint a static section cannot carry.

## Alternatives considered

**Ship opt-in (experimental or preset-only) instead of base-enabled.** Rejected: the team's direction was to move fast with the plugin architecture as the lever — a bad default is fixed by a `disabled` row override — and base shipping gives every recorded session a uniform baseline.

**Fold the rules into the first-party core-rule sections.** Rejected: readability register is product style guidance, not loop-hygiene orders, and its own section keeps one owner per rule list and a per-deployment disable point the `includeCoreRulesGuidance` layering deliberately does not cover.

**Constrain output grammar via structured outputs.** Rejected: provider-specific, latency-priced, and harmful on unconstrained prose; *shouldn't*, not *couldn't* — structured output stays reserved for tool-call surfaces.

**Rewrite answers post-hoc with a second model pass.** Rejected: doubles reply latency, and any rewritten text reaching the user must re-enter the session log to preserve model-visible ⟺ logged, effectively logging two replies per answer.

**Inject the full rubric as a per-turn `agent/pre-step` reminder.** Rejected: a static section already reaches every request at a fixed cost; per-turn injection is for genuinely varying content.

**Layout and reader-calibration rules (`Scannable Layout`, `Read the Reader`).** Cut at selection: the Nielsen Norman scanning evidence is real but its product belongs to client presenters; O'Reilly & McNamara's expert-degradation caution asks for a per-request audience hint a static section cannot carry. Both stay follow-ups, the dynamic form a `ctx.systemPrompt.context(...)` contribution.

**A durable term registry (`term_define` + `terms` projection + per-request context listing, in the `tool-todo` shape).** Shelved: its value scaled with definitional text a harvester could extract, and the extractor's input is model-generated chat — definitional density could not be confirmed ahead of telemetry. The name-once prompt rule buys the same cohesion win at text cost; the design stays reconstructible from this note's proposed-era revision.

**The embedding seam — zero-shot definition detector, term harvester, vocabulary reminder.** Shelved with it: the chain shared the unverifiable detector-input premise, plus an ONNX-runtime and model-artifact dependency a minimal-effort scope prohibited, plus an unresolved artifact-delivery decision (vendored npm asset vs first-use `$DSH_HOME` download). The vetted candidate set stays on record for the reopen: Qwen3-Embedding-0.6B and EmbeddingGemma 2 (both Apache 2.0; the latter released 2026-10-06 and ships a first-party zero-shot Decision Task), mDenseOn (2026-07, 307M, Apache 2.0), potion-multilingual-128M as the static-embedding floor, jina-embeddings-v5-text excluded on non-commercial terms. The supervised definition-extraction line (Fahmi & Bouma 2006 → WCL → Kang et al. 2018 → DeftEval 2020) remains the offline reference if a detector ever returns.

**Build the registry on the [knowledge-attachment](../../proposed/feature/2026-09-19-file-anchored-knowledge-attachment.md) store.** Rejected: `~/.dsh` file state is out of the session log, so replay could not fold definitions and compaction would lose them.

**Do nothing and rely on the core personality rules.** Rejected: the problem is measurable and the core rules do not own register guidance.

## Consequences

Every request through a base-backed profile now carries the section — a fixed ~90-word prompt cost per request per session, accepted as the price of four durable rules. The default system prompt of all shipped profiles changed; every recorded-session replay that pins a system prompt now carries the new section, so the recorded fixture tree needs a refresh run. `pnpm run test:snapshot:refresh` was attempted with this implementation and did not settle under the suite's fence in that environment, and its partial writes were reverted rather than trusted, so the fixture refresh ships as its own change on a stable tree — the snapshot lane is optional evidence, never a merge requirement. A deployment disables the section with `- id: readability-rules` + `disabled: true` in its own cordis patch. Compliance with the rules is verified behaviorally only — the enforcement net is prompt compliance — so a future model that fails the rules regresses silently; recorded-session snapshots are the leading indicator, and the shelved machinery above is the escalation path if the indicator turns red.

Testing landed in the package: a verbatim-text pin (four markers present, the two cut rules absent), a REAL-composition boot test asserting exactly one section with the exact text, and an HMR-safety disposal test (the section disappears when the plugin fiber disposes). The base bundle's id/disabled/dependency contract test covers the new row's resolution, and the package carries no `./invariant` companion — its only observable is one static section registration, verifiable from a single observation.
