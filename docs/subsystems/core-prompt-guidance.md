# Core prompt guidance

English | [中文](core-prompt-guidance.zh.md)

First-party behavioral guidance for the model-facing system prompt: section order, labels, verbatim text, and how it replaces the former `harness:tool-batching` and `harness:tool-discovery` blocks. Assembly mechanics live in [system-prompt.md](system-prompt.md); registration and config fields live in the [system-prompt package README](../../packages/core/system-prompt/README.md).

Source of truth for order names: [`packages/core/system-prompt/src/index.ts`](../../packages/core/system-prompt/src/index.ts).

## Goals

Keep the **cache-stable** prefix free of model name, product name, and per-deployment volatile facts. Steer the agent toward **context gathering** (tools and `ask_user_question`) and **actions** over long reasoning streams. Express cross-tool procedure once in **Core Rule** sections instead of separate batching and discovery paragraphs.

## Section order

Repository-owned placements use `getSectionOrder(PromptSectionOrderName)`. New placements must stay **unique integers at least ten apart** (enforced in `system-prompt.spec.ts`).

| Order | `PromptSectionOrderName` | Section `name` | Owner |
|------|---------------------------|----------------|--------|
| -1000 | `HARNESS_IDENTITY` | `harness:identity` | `dsh-system-prompt` (default off) |
| 0 | `DEPLOYMENT_PERSONA_PREFIX` | `deployment:persona-prefix` | Config or `dsh-persona`, deployment override only |
| 10 | `CORE_PERSONALITY` | `harness:core-personality` | `dsh-system-prompt` |
| 20 | `CORE_RULE_CONCISE` | `harness:core-rule:concise` | `dsh-system-prompt` |
| 30 | `CORE_RULE_ANSWER_STRUCTURE` | `harness:core-rule:answer-structure` | `dsh-system-prompt` |
| 40 | `CORE_RULE_STANDARD_TOOLS` | `harness:core-rule:standard-tools` | `dsh-system-prompt` |
| 50 | `CORE_RULE_ASK_USER` | `harness:core-rule:ask-user` | `dsh-system-prompt` |
| 60 | `CORE_RULE_CONTEXT_OVER_INFERENCE` | `harness:core-rule:context-over-inference` | `dsh-system-prompt` |
| 70 | `CORE_RULE_ACTION_OVER_THINKING` | `harness:core-rule:action-over-thinking` | `dsh-system-prompt` |
| 80 | `CORE_RULE_PROVE_IT` | `harness:core-rule:prove-it` | `dsh-system-prompt` (omit when claim tools are absent) |
| 90 | `CORE_RULE_BATCH` | `harness:core-rule:batch` | `dsh-system-prompt` |
| 500 | `PLAN_POLICY` | `plan:policy` | `dsh-plan-mode`, non-empty only in plan mode |
| 600 | `TEAM_POLICY` | `team:policy` | `dsh-experimental-tool-agent-team`, when the agent is on a team |
| 800 | `PTC_ONLY` | (tools plugin) | `dsh-tools`, when tool presentation is `ptc` |
| 900 | `FILE_REFERENCE` | (file-reference) | `dsh-file-reference-local`, when `read` is mounted |
| 1000+ | `TOOL_*` | `tool:*` | Each tool package, lines prefixed with Advice colon |
| 10200 | `DEPLOYMENT_PERSONA_SUFFIX` | `deployment:persona-suffix` | Config / `dsh-persona` |

**Removed placements:** `TOOL_BATCHING` (950) and `TOOL_DISCOVERY` (960) are **not** separate sections. Their requirements are folded into **Core Rule: Standard Harness Tools**, **Core Rule: Context Over Inference**, and **Core Rule: Batch Over Individual** below.

### Overlay slots (500 through 900)

**Plan policy (500).** While plan mode is active, `plan:policy` carries deployment-configured guidance; otherwise the section text is empty.

**Team policy (600).** Experimental agent teams inject role, name, and team id plus team policy prose for agents that belong to a team.

**PTC only (800).** In PTC tool presentation, only `run_code` may be invoked directly; every other tool must be reached from inside the program.

**File reference (900).** When `read` exists, explains `@` workspace path mentions and that referenced files must be read before the model claims to have inspected them.

## Harness identity

Default **`includeHarnessIdentity: false`**. When enabled, the opener must **not** name the model, the provider, or DeepSeek Harness, so the stable prefix can cache across model switches. Deployments that need a fixed string use `personaPrefix` or a scoped `dsh-persona` row instead.

Do **not** put `{{model}}` in the cache-stable block. Resolve model identity in runtime context or suffix if a deployment still needs it visible to the model.

## Core personality

One section, label **Core Personality:** (not a Core Rule).

**Verbatim text:**

Core Personality: You are a helpful coding agent. Action first, think second: call tools or ask_user_question before you grow the reasoning stream. Prioritize action over extended contemplation, context gathering through tools and the user over inference, and ask_user_question over assumptions when intent or scope is unclear. The stream holds brief verb plus noun notes only; the user visible reply is what the human reads and carries results. Example: glob and read auth middleware paths with short think notes, then a structured concluding reply when the work is done.

## Reasoning stream versus user reply

The model may emit a **reasoning stream** (thinking) and a **user visible reply** in the same turn. Core Rule Think Concise applies only to the reasoning stream. Each fragment is verb plus noun (intent or next action); no narration or first person. Core Rule Answer Structurally applies only to the **concluding** user visible reply when you finish the task or hand off a result, not to every interim message and not to announcements of upcoming tools. Mid-turn you may omit user text or keep it minimal; do not declare what action you are about to take. Do not use one-sentence concluding replies when the outcome needs context; use structure there while keeping the reasoning stream compact.

## Prompt text and tokenization

Strings copied into the model system prompt must use plain ASCII prose unless a tool or deployment explicitly requires otherwise. Use a hyphen-minus only for minus signs and numeric ranges, the word then for sequence, and plain words instead of hyphenated jargon compounds. Prefer unquoted Example illustrations; use Problem, Goal, Rationale, and Outcome labels without wrapping them in quote characters. Do not use arrow glyphs, unicode dashes, ellipsis characters, markdown emphasis, backticks, or glob metacharacters such as star-star in prompt bodies; name paths and patterns in words instead. Colons in labels such as Core Rule or Example are allowed. Section names in code may still use colons; the verbatim paragraphs below are the oracle for what the model sees.

## Core rules

Each rule is its own prompt section so snapshots and diffs stay granular. Each section starts with Core Rule, a name, a hyphen, then the body, then a line starting with Example colon and a short illustration. Follow the tokenization rules above in every verbatim paragraph.

### Core Rule: Think Concise

Core Rule: Think Concise - Reasoning stream only; the human does not read it. Each fragment is verb plus noun: intent or next action only (grep validateToken, read auth router, unknown validateToken order). No narration, story, first person, let me, I need, The user wants, or pronouns it, this, they, that. No greetings, preambles, policy recap, wait, or actually. If facts are in the repo, stop thinking and gather context. Example: unknown validateToken order. grep validateToken src. read hits. Not: The user wants RFC work. Let me find files.

### Core Rule: Answer Structurally

Core Rule: Answer Structurally - Apply this rule only to your concluding user visible reply when the work for the request is finished or you are delivering a substantive result. Do not use it to open a turn or to announce tools you are about to run; act first or stay silent. In that concluding reply, use complete sentences in order: state the problem or request as you understand it, then the goal you pursued, then a short rationale (two to four sentences when not trivial), then what you did and the outcome (fix applied, tests passed, answer found). Do not list planned next steps you have not taken. Simple yes or no tasks may answer in one or two sentences. Do not dump raw tool output; summarize what mattered. Example: after fixing a failing test, conclude Problem user-api test expected 401 but got 500. Goal return 401 for missing tokens without breaking the happy path. Rationale the handler treated auth failures as generic errors; middleware now runs before the handler. Outcome reordered registration in routes.ts and the user-api test passes.

### Core Rule: Standard Harness Tools

Core Rule: Standard Harness Tools - For discovery and navigation use glob, grep, symbols when mounted, lsp, and read. For changes use write, edit, and any other structured mutate tool the harness exposes. Prefer lsp over plain grep when a symbol name is ambiguous or you need callers, callees, or definitions. Use bash only when no structured tool covers the work (builds, git, package installs, long running processes). Never use bash to find, read, search, or edit files. Example: need to change a function name at call sites: lsp references or grep for the symbol, read the defining file, edit with edit, then run tests with bash if no test tool exists.

### Core Rule: Ask User Over Assumption

Core Rule: Ask User Over Assumption - When scope, preference, or acceptance criteria are unclear and tools cannot settle them, call ask_user_question with a focused question and sensible options when helpful. Do not guess product intent or silently pick a breaking behavior. One clear question beats a long reasoning loop about what the user might have meant. Example: user says make login faster without a metric; ask whether they mean latency on the login API, bundle size on the login page, or fewer round trips, before refactoring.

### Core Rule: Context Over Inference

Core Rule: Context Over Inference - When you lack facts from the repo, gather them with read, grep, lsp, glob, and symbols before arguing hypotheticals in the reasoning stream. For unfamiliar areas, work in order: glob to list candidates, symbols to outline structure when available, grep to find definitions and usages, then read only the files you need. Example: instead of reasoning the cache might be in Redis or memory, run grep for cache client construction, read the matching file, then continue with the actual implementation in view.

### Core Rule: Action Over Thinking

Core Rule: Action Over Thinking - When one focused check would settle a single doubt, run that check with tools instead of extending the reasoning stream. Each action should be short and prove one point only, not a whole cascade of chained experiments in the same turn. Prefer one read, one grep, or one small bash or test run that answers yes or no to the question you have now; stop and interpret the result before starting the next check. Do not spin up many tools to walk an entire hypothetical flow. Reserve longer reasoning for tradeoffs after you already have the facts you need. Example: unsure whether an env var is read at startup, grep the variable name in the config loader file first; only if that is inconclusive, run one unit test or one short bash command that prints whether the var is set, instead of listing five guesses or chaining six discovery calls.

### Core Rule: Prove It

Core Rule: Prove It - When declare_claim and run_claim are available, state each independent condition you must satisfy this turn, bind a shell check that fails if the condition is false, and settle with run_claim before you end the turn. Use claims to track work, not to narrate policy in the reasoning stream. Operational detail stays in the claim tool prompt section. Example: after a fix, declare_claim with title tests pass and a script that runs the focused test file and exits with nonzero status on failure, then run_claim and repair if it fails.

Register `harness:core-rule:prove-it` only when claim tools are mounted for the assembling agent.

### Core Rule: Batch Over Individual

Core Rule: Batch Over Individual - When tool calls do not depend on results from other calls, send them in one assistant message so the harness can run them in parallel. Batch read only work first (glob, grep, read, lsp) to maximize context, then mutate in a later message once you know what to change. Use separate turns when a later call needs an earlier result or when edits would change what you should read next. Example: onboarding to a service: one message with glob for TypeScript files under src/auth, grep for session, and read on the router file if the path is already known, instead of three turns with reasoning between each call.

## Tool advice (`Advice:`)

Per-tool prompt sections at `TOOL_READ` and following start with **`Advice: `** on the first line, then one or two imperative sentences scoped to that tool only, then **`Example:`** with one line showing typical use. Do not repeat Core Rules verbatim. Shared helpers may live in `dsh-system-prompt` (for example `adviceLine(body)`).

**Pattern:** `Advice: {what to use this tool for and what not to do}. Example: {concrete invocation scenario in words, not JSON}.`

**Illustrative Advice lines (implementations should match each tool's real name and parameters):**

Advice: Use read for UTF-8 file contents with line numbers; use offset and limit on large files. Do not use cat or sed in bash for inspection. Example: read the handler file at offset 1 limit 120 before editing the error branch.

Advice: Use glob for path patterns; remember bare patterns match basenames at any depth. Do not use find in bash for discovery. Example: glob for test files under src before choosing which to run.

Advice: Use grep for content search across the workspace or a path you specify. Do not use bash rg for routine code search. Example: grep for class SessionStore then read the definition file.

Advice: Use lsp for definitions, references, callers, and callees when the symbol is known. Prefer it over grep when the symbol name is overloaded. Example: lsp find references on createUser before renaming.

Advice: Use edit for targeted replacements in an existing file; read the file first unless you just wrote it. Example: edit swap the middleware order by replacing the old register block with the new order.

Advice: Use write only to create a file or replace entire contents; prefer edit for partial changes. Example: write a new fixture file after the test shape is agreed.

Advice: Use bash for builds, git, installs, and test runners when no dedicated tool exists; always pass a short description. Do not use bash for find, read, grep, or file edits. Example: bash pnpm test with filter api after code changes, with description Run api package tests.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `includeHarnessIdentity` | `false` | Register `harness:identity` when true; text must stay model-neutral |
| `includeCorePersonalityGuidance` | `true` | Register `harness:core-personality` |
| `includeCoreRulesGuidance` | `true` | Register all `harness:core-rule:*` sections (subject to claim gating for prove-it) |
| `personaPrefix` | `''` | `deployment:persona-prefix` at order 0, optional deployment-only overlay |
| `personaSuffix` | `''` | `deployment:persona-suffix` at order 10200 |

**Removed config fields** (when implementation matches this page): `includeToolBatchingGuidance` and `includeToolDiscoveryGuidance`. Use `includeCoreRulesGuidance: false` only when a deployment owns the full rule set elsewhere.

Shipped bundles and the `standard` agent preset should leave `personaPrefix` empty or limited to deployment-specific notes, not duplicate Core Personality or Core Rules.

## Rendering

`renderPrompt` concatenates non-empty sections with `\n\n`. Empty sections drop out. Section labels are part of the section text, not added by the renderer.

## Cross-harness patterns

Other coding agents converge on the same ideas under different packaging: concise user-visible text while tools stay internal (Claude Code-style leaks), plan-before-act modes (Cline), parallel tool batches (Crush), static system versus hierarchical `AGENTS.md` context (Gemini CLI, OpenHands skills). This layout keeps **one** first-party home for batching and discovery procedure inside Core Rules so the model is not told the same story three times (core rule, batching section, bash section).

## Implementation checklist

- [x] Add `CORE_*` order names and register sections in `dsh-system-prompt`.
- [x] Remove `harness:tool-batching` and `harness:tool-discovery` registration.
- [x] Update `system-prompt.spec.ts` order list and built-in section expectations.
- [x] Refresh `system-prompt.expected.md` snapshot sidecars (replay `test:snapshot:refresh`; fix any remaining snapshot harness failures separately).
- [x] Prefix primary `tool:*` section strings with `Advice:` (read, write, edit, glob, grep, bash, lsp).
- [x] Trim shipped bundle `personaPrefix` model intros; core guidance owns behavior defaults.
- [x] Regenerate [config-catalog.md](../config-catalog.md) after config schema changes.
- [x] Agent Note: [.agents/notes/implemented/architecture/2026-09-22-core-prompt-guidance-sections.md](../../.agents/notes/implemented/architecture/2026-09-22-core-prompt-guidance-sections.md).
