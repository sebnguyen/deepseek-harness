# Agent Note: Thin the shipped tool catalog

Status: proposed

## Problem

Every tool definition the harness ships rides every model request, so dead weight in the catalog is not free text — it is prompt size, cache cost, and foreground attention on every turn. An audit of the `standard` preset (the default mounted by `packages/bundle/web-app/cordis.patch.yml:585-596`) on 2026-10-14, measured from source and from the recorded schema fixtures under `snapshots/`, found two kinds.

First, oversized and duplicated description text inside shipped definitions. The default POSIX roster carries ≈15,200 characters of top-level description text across 28 tools (≈18,200 on Windows, where `pwsh` ships beside it), and four tools account for ≈8,600 of it: `pwsh` at 3,010 characters (mostly Windows EPERM/ConstrainedLanguage prose), `workflow` at 2,500 (largely a prose restatement of the script's JSON-schema subset), `multi_bash` at 2,032 (batch semantics repeated in three places), and `lsp` at 304 (restates the six enum values its own schema enumerates).

A parameter-level pass over the same roster found exactly one obsolete field: `multi_bash`'s `commands[]` element `description` — declared with a UI-label contract, validated non-empty at dispatch, and then never read, because execution and presentation both label elements with `element.command`. Every other declared top-level parameter in the roster is consumed by its executor.

Second, packages and presets that no composition mounts. Three consumer tool packages register in no bundle patch or preset composition: `packages/terminal/tool-terminal` (`terminal_*`), `packages/session-query/tool-session-query` (`session_*`), and `packages/experimental/tool-agent-team` — the first two referenced nowhere outside `scripts/gen-tool-catalog.ts`, the third consumed only by the experimental `agent-team-profile` patch. They still occupy the workspace, hold README and subsystem-docs space, appear in the generated `docs/tool-catalog.md`, and collect maintenance on every tool-layer change, and the catalog they appear in is generated from a boot of every package regardless of what any shipped profile actually mounts — so its rows overpromise what the agent ships. The preset roster has the same disease at a coarser grain: `wind-up-wind-down` was the realization of [the phase-split proposal](../architecture/2026-10-02-wind-up-wind-down-phase-split.md), whose explorer flow now lives inside `standard` (`presets/standard/agent.cordis.yml:244-308` mounts it "so standard sessions boot into it"), leaving the standalone preset as a fifth UI-visible mode whose distinct content is prompt-prose experiments.

## Proposal

Three moves.

**Thin and flatten the shipped definitions.** Cut the description texts of `pwsh`, `workflow`, and `multi_bash` beneath ~2,000 characters each and delete the six-enum restatement in the `lsp` description. Then collapse the two batch tools to single-array shapes — `multi_bash` becomes `{commands: [{command, workdir?, timeoutMs?, run_in_background?}]}` and `multi_write` becomes `{files: [{file_path, edit atom(s), dry_run?, overwrite?}]}` — deleting their root-level mirrors (bash description/timeoutMs/workdir, both tools' sandbox-escalation fields at element and root level, and the obsolete element `description`), so the session's own sandbox policy governs every dispatch and no field duplicates what an element already has. The object↔array joint this removes is exactly where every recorded double-encoding defect manifested, and the extra fields the model currently double-encodes — root labels and escalation pairs — are gone from the confusion surface for good. `multi_read` already has the target shape and needs nothing. Tool names stay; no tool leaves the standard roster. The recorded-session corpus pins every string and shape, so `pnpm run test:snapshot:refresh` rewrites expected outputs in the same change, and the review confirms the refreshed snapshots differ only in the trimmed strings and flattened call shapes.

**Archive the three unmounted consumer packages instead of deleting them.** This change establishes a repository-root `_archive/` convention: retired packages move there intact — `_archive/packages/terminal/tool-terminal`, `_archive/packages/session-query/tool-session-query`, `_archive/packages/experimental/tool-agent-team`, and the `agent-team-profile` patch beside it — keeping source, READMEs, and reintroduction cheap. `pnpm-workspace.yaml` scopes workspaces to `packages/*/*`, so the tree is excluded by construction: no install, no build, no typecheck, no doc-sync. The packages' rows leave `scripts/gen-tool-catalog.ts` and `docs/tool-catalog.md` is regenerated (`pnpm run gen-tool-catalog`). The supporting services stay active in `packages/`: the terminal family (`dsh-terminal`, `dsh-terminal-bash`) serves `sdk-minimal`, and the session-query capability (`session-query`, `session-query-sqlite`) serves the API; only the never-mounted model-facing consumers archive. `docs/subsystems/agent-team.md` is removed and the tool-facing parts of `docs/subsystems/terminal.md` and `docs/subsystems/session-query.md` are re-scoped to the remaining services in the same change.

**Trim the preset roster from five to four.** `wind-up-wind-down` moves to `_archive/presets/wind-up-wind-down/`, leaving the product modes — `standard` (default), `minimal`, `ptc`, `cordis` — as the shipped set. The roster assertion in `packages/preset/agent-presets/tests/shipped-root.spec.ts:92` drops it, the `presets/standard/agent.cordis.yml` header comment is reworded to name the explorer flow as standard's own, and `apps/cli/tests/windows-shell.spec.ts` stops referencing it. The [phase-split proposal note](../architecture/2026-10-02-wind-up-wind-down-phase-split.md) stays active and gains no edit: this change archives the preset packaging, not the idea, whose shipped slice lives on in `standard`.

## Per-tool audit

Each inspected tool below names its measured description length (source or recorded fixture, 2026-10-14), its parameter surface, and its post-change shape. Measurements marked ≈ are config-assembled at mount time; the recorded corpus pins config variants, so ranges appear where recordings disagree.

### Shipped — trimmed

#### `multi_bash` — trim + flatten

- **Before** — `description` 2,032 chars (measured from `packages/shell/tool-bash-frames`; the vitest-lane `bash` recording pins config variants at 1,836–2,032). The batch/settlement contract is stated in the tool description, again at the `commands` array level (391 chars), and a third time in element property descriptions; the package already owns a dedicated system-prompt section for cross-call batching guidance (`src/index.ts:348-355`). The `commands[]` element also declares a `description` field (the element UI label, `src/index.ts:372`) that the executor never consumes: validation (`:115`) only checks non-empty, while execution and presentation label every element with `element.command` (`:227`, `:232`, `:524-567`). Sandbox escalation lives redundantly at root and element level. Params: `commands[]` (command, description, workdir, timeoutMs, run_in_background, sandbox_permissions, justification), `description`, `timeoutMs`, `workdir`, `sandbox_permissions`, `justification`.
- **After** — `{commands: [{command, workdir?, timeoutMs?, run_in_background?}]}` as the whole parameter surface: root description/timeoutMs/workdir fold into elements, element `description` (the audit's obsolete field) drops, and sandbox escalation fields drop everywhere — the session's sandbox policy governs dismissal, promotion, and denials through the staged-escalation machinery instead of per-call opt-ins. Description ≤ ~1,400 chars. Recorded fixtures refresh. **Why flattened:** every recorded double-encoding defect struck the object↔array joint — the shape where a batch array sits inside a top-level object beside sibling mirrors; a single-array parameter has no joint.

#### `workflow` — trim

- **Before** — `description` 2,500 chars (`packages/workflow/tool-workflow/src/index.ts:218`). Most of it re-teaches the script's JSON-schema subset and hook signatures — content the runtime enforces and the system prompt already frames. Params: `script` (req), `meta` (req), `args` (opt).
- **After** — description ≤ ~1,600 chars: what a workflow is, the `agent()` hook contract, and a pointer to the README-owned hook inventory. No parameter changes.

#### `pwsh` — trim (win32 only)

- **Before** — `description` 3,010 chars (`packages/shell/tool-pwsh/src/index.ts:250`; recording `snapshots/session/pwsh-tool-turn`). Most of it is Windows EPERM, ConstrainedLanguage, and approval-mode prose — host facts, not per-call contract. Params mirror the bash family: `command`, `description`, `timeoutMs`, `workdir`, `run_in_background`, `sandbox_permissions`, `justification`.
- **After** — description ≤ ~2,000 chars, matching the POSIX shell's contract scope; Windows sandbox facts move to the package README. No parameter changes.

#### `lsp` — trim

- **Before** — `description` 304 chars (`packages/lsp/tool-lsp/src/index.ts:153`): restates "operation is one of goToDefinition, findReferences, …" — the six values the `operation` property's own `enum` already carries. Params: `operation` (req enum×6), `file_path`, `line`, `character`.
- **After** — description ≈190 chars; the enum carries the vocabulary, the description keeps the UTF-16 coordinates and callers/callees semantics. No parameter changes.

### Shipped — unchanged

#### `exit_plan_mode` — keep

- **Before** — `description` 327 chars (recorded). Params: `plan` (req).
- **After** — unchanged; one concept per sentence already.

#### `get_goal` — keep

- **Before** — `description` 236 chars. Params: none.
- **After** — unchanged.

#### `create_goal` — keep

- **Before** — `description` 342 chars. Params: `objective` (req), `max_goal_rounds` (opt).
- **After** — unchanged.

#### `update_goal` — keep

- **Before** — `description` 396 chars. Params: `goal_id`, `revision`, `action` (req enum×5), `objective`, `max_goal_rounds`, `blocked_reason` (opt).
- **After** — unchanged.

#### `job_output` — keep

- **Before** — `description` 258–398 chars (config variant: persistent-shell retirement note). Params: `job_id` (req), `timeout_ms` (opt).
- **After** — unchanged.

#### `job_list` — keep

- **Before** — `description` 85 chars. Params: none.
- **After** — unchanged.

#### `job_kill` — keep

- **Before** — `description` 136 chars. Params: `job_id` (req), `reason` (opt).
- **After** — unchanged.

#### `skill` — keep

- **Before** — `description` 183 chars. Params: `name` (req).
- **After** — unchanged.

#### `ask_user_question` — keep

- **Before** — `description` 196 chars. Params: `questions[]` (req).
- **After** — unchanged.

#### `todo_write` — keep

- **Before** — `description` 805 chars (recorded; assembled from fragments at `packages/todo/tool-todo/src/index.ts:45-77` per the `allowParallelInProgress` config). Params: `todos[]` (req).
- **After** — unchanged.

#### `web_fetch` — keep

- **Before** — `description` 74 chars. Params: `url` (req).
- **After** — unchanged.

#### `web_search` — keep

- **Before** — `description` 152 chars. Params: `queries[]` (req).
- **After** — unchanged.

#### `present` — keep

- **Before** — `description` 464 chars (recorded). Params: `files[]` (req).
- **After** — unchanged.

#### `read_image` — keep

- **Before** — `description` 545 chars (recorded). Params: `file_path` (req).
- **After** — unchanged; the downscale/normalization notes carry real call-time guidance.

#### `multi_read` — keep

- **Before** — `description` 169 chars (measured from `packages/fs/tool-fs`). Params: `files[]` (req; path, offset, limit per entry).
- **After** — unchanged.

#### `multi_write` — flatten + strip escalation

- **Before** — `description` 233 chars (measured from `packages/fs/tool-fs`). Params: `files[]` (req; per-entry file_path, content/edits atoms, dry_run, overwrite, sandbox_permissions, justification) plus top-level `sandbox_permissions`/`justification` retry forms — escalation fields mirrored at both levels.
- **After** — `{files: [{file_path, edit atom(s), dry_run?, overwrite?}]}` as the whole parameter surface: sandbox-escalation fields drop everywhere (the session sandbox policy governs, matching the `multi_bash` flatten), root-level mirrors disappear, and each file's edit atoms stay the positional discriminated set already shipped. Description unchanged. **Why flattened:** same joint-removal as `multi_bash`; the write tool's payload is the deepest nesting in the catalog (`files[] → edits[] → atoms`) and the double-encoding defect's most common victim — every saved field here is one the model can't misplace.

#### `symbols` — keep

- **Before** — `description` 314 chars. Params: `files[]` (req), `hotspots` (opt).
- **After** — unchanged.

#### `send_message` — keep

- **Before** — `description` 395 chars. Params: `agent_id` (req), `message` (req).
- **After** — unchanged.

#### `interrupt_agent` — keep

- **Before** — `description` 504 chars. Params: `agent_id` (req).
- **After** — unchanged.

#### `list_agents` — keep

- **Before** — `description` 1,094 chars (recorded). Params: `scope` (opt).
- **After** — unchanged; under the ~2,000 ceiling and the `running`/`idle`/`ready` vocabulary is load-bearing. A later pass can compress the status definitions; not a blocker now.

#### `list_subagent_models` — keep

- **Before** — `description` 429 chars (recorded). Params: `provider` (opt), `model` (opt).
- **After** — unchanged.

#### `subagent` — keep

- **Before** — `description` ≈788–854 chars (config-assembled: spawn wording + background-by-default contract + model-selection suffix). Params: `description`, `prompt`, `provider`, `model`, `reasoning_effort` (opt), `run_in_background` (opt).
- **After** — unchanged; the wording switches on provider config rather than carrying dead text.

#### `subagent_fork` — keep

- **Before** — `description` ≈852 chars (fork wording plus continuable-background contract; no model-selection fields). Params: `description`, `prompt`, `run_in_background` (opt).
- **After** — unchanged.

#### `explore` — keep

- **Before** — `description` ≈710 chars (spawn wording + call-waits suffix + `tasks` batch suffix; config-assembled per the standard preset row). Params: `description`, `tasks[]` (req).
- **After** — unchanged.

#### `ralph` — keep

- **Before** — `description` 489 chars. Params: `objective` (req), `maxRounds` (opt).
- **After** — unchanged.

### Archived — unmounted tool packages

#### `terminal_open` / `terminal_send` / `terminal_read` / `terminal_signal` / `terminal_close` / `terminal_list` — archived

- **Before** — `packages/terminal/tool-terminal`, six tools, descriptions 61–210 chars each; params span PTY lifecycle (sessionId/type/name/cwd/text/submit/run_in_background/offset/count/signal). Mounted in no bundle patch or preset; the only in-repo consumer is `scripts/gen-tool-catalog.ts`, which boots it to grow `docs/tool-catalog.md`.
- **After** — moved to `_archive/packages/terminal/tool-terminal`, out of `scripts/gen-tool-catalog.ts`. **Why archived, not kept:** nothing shipped asks the model to drive PTYs — `sdk-minimal` rides `dsh-terminal-bash`, and every other surface runs the one-shot shell; the catalog row advertised a tool no agent has.

#### `session_search` / `session_event_search` / `session_trace` / `session_event_trace` / `session_event_read` — archived

- **Before** — `packages/session-query/tool-session-query`, five tools, descriptions 103–121 chars each but the largest parameter surface in the repo (`session_search` alone takes 13 filters); session ids, time ranges, sequence ranges, surfaces (session ids, created/event ranges, type lists, availability …). Mounted nowhere; catalog-generator-only consumer.
- **After** — moved to `_archive/packages/session-query/tool-session-query`. **Why archived:** no shipped composition wants model-driven session search; the capability service (`session-query`, `session-query-sqlite`) stays for the API, and the only consumer of the model tool is the generator that documents it.

#### `spawn_teammate` / `wait_agent` / `team_task_create` / `team_task_get` / `team_task_list` / `team_task_update` and Team-scoped control faces — archived

- **Before** — `packages/experimental/tool-agent-team`, nine Team-scoped tools, registered only inside Team-member agent scopes; consumption exists only through `packages/experimental/agent-team-profile`, which inserts it after `dsh-base`.
- **After** — both packages move to `_archive/packages/experimental/` and `docs/subsystems/agent-team.md` is removed. **Why archived:** an experiment with zero preset or bundle presence outside its own opt-in profile; keeping it costs maintenance on every registry change while shipping nothing.

### Deliberate keeps — unmounted by decision, not by decay

#### `str_replace_editor` — kept

- **Before** — `packages/fs/tool-str-replace-editor`, one tool, 1,119-char description, `command` enum plus five optional `any`-typed params. Unmounted everywhere.
- **After** — kept as-is: [the base editor decision](../../implemented/simplification/2026-09-05-base-default-file-editor.md) reserves it for explicit custom compositions. Its `any`-typed optional params are a separate typing question, out of scope here.

#### `glob` / `grep` — kept

- **Before** — `packages/fs/tool-fs-search`, descriptions 407/269 chars (config-dependent; the description hardcodes the mounted caps, 100 paths / 250 matches — a real duplication nit for the next time the tool is composed). Unmounted in `standard` by explicit decision (`presets/standard/agent.cordis.yml:88-92`).
- **After** — kept; other recordings show `glob`/`grep` live on non-standard lanes.

#### `bash` (one-shot), persistent `bash` / `pwsh`, `declare_claim` / `run_claim` / `list_claims` / `abandon_claim`, `cordis_*`, `subagent_codex` / `subagent_claude_code` — kept

- **Before** — one-shot `tool-bash` (1,836 chars) is the recorded-corpus's singular face and a PTC/test-harness import; `tool-bash-persistent` / `tool-pwsh-persistent` (153/159 chars) are `sdk-minimal`'s only interfaces; the four claim tools mount in the base bundle (`base/cordis.patch.yml:512`); `tool-cordis` mounts in the `cordis` preset; the codex/claude-code delegation rows ship disabled as documented opt-ins.
- **After** — all kept; each has a live mount or a recorded decision.

#### `checkpoint_restore`, `request_escalation` — kept

- **Before** — 145 and 163 chars, shipped via the base bundle (`dsh-checkpoint`, `dsh-staged-escalation`), outside the `tool-*` packages this note otherwise covers.
- **After** — kept; already thin, and base-owned rather than preset-owned.

### Presets

#### `standard` — keep (default)

- **Before** — 34 rows, ≈5,479 chars of prompt-bearing config text (persona prefix, the plan-mode `section` at ≈1,974 chars, the explorer persona at ≈610 chars).
- **After** — kept; the tool-side trims above apply to its rows. The plan-mode block is the largest preset-shipped prompt text but carries behavioral mounts. A dedicated prompt-text pass is a separate follow-up, not this change.

#### `minimal` — keep

- **Before** — 3 rows, ~46 chars of prompt text; the one-tool composition from [the persistent-shell decision](../../implemented/simplification/2026-09-03-minimal-profiles-persistent-shell-only.md).
- **After** — kept; already the thinnest preset and a shipped product mode.

#### `ptc` — keep

- **Before** — 33 rows, ≈2,693 chars of prompt-bearing text; the PTC (programmatic tool calling) product mode.
- **After** — kept; distinct product mode, nothing unmounted by it.

#### `cordis` — keep

- **Before** — 33 rows, ≈4,072 chars of prompt-bearing text; the preset-authoring mode with `cordis_*` tools.
- **After** — kept; mounts `tool-cordis`, the only shipped home of those tools.

#### `wind-up-wind-down` — archived

- **Before** — 10 rows, ≈1,131 chars of prompt text; a prototype phase-split composition whose explorer (output-schema + read-only child + delegation cap + explorer persona) was folded into `standard` (`presets/standard/agent.cordis.yml:244-308`), leaving plan-mode color text and a `delegate` rename as its only distinct content.
- **After** — moved to `_archive/presets/wind-up-wind-down/`; the roster assertion in `tests/shipped-root.spec.ts:92` drops it and `apps/cli/tests/windows-shell.spec.ts` stops referencing it. **Why archived:** every shipped surface it taught now composes in `standard` itself; a fifth UI mode that duplicates the default is roster weight with a maintenance tail, not a capability.

## Alternatives considered

**Trim every description to a uniform character budget.** Rejected: description length tracks real surface (delegation, workflow hooks), and a quota cuts behavior contracts alongside prose. This pass targets measured duplication and outsized outliers only.

**Hide instead of archive — `disabled` rows or a presentation filter.** Rejected, matching the reasoning of [the persistent-shell-only decision](../../implemented/simplification/2026-09-03-minimal-profiles-persistent-shell-only.md): a mounted-but-hidden capability can resurface when configuration changes, and the package keeps accruing maintenance.

**Delete instead of archive.** Rejected: moving the packages and the preset to `_archive/` keeps the code byte-identical and greppable for reintroduction at zero workspace cost — the workspace glob never enters `_archive/`, so nothing builds, installs, or typechecks it — while true deletion forces a history dig to undo.

**Strip fields centrally in `schemaOf`** (the single ship-time projection in `packages/core/tools/src/index.ts`). Rejected: `schemaOf` already whitelists `name`/`description`/`parameters`, and a central cut would bind every deployment to one deployment's idea of junk while the junk itself is source-owned per tool.

**Keep the three packages and the prototype preset as opt-in options.** Rejected: their opt-in story is documentation-only — nothing mounts them, and in two cases the catalog row that advertises them is itself generated from the same code. Reintroduction is one move away.

## Acceptance criteria

- The standard preset's roster is unchanged in tool names; `multi_bash` and `multi_write` collapse to their single-array parameter surfaces per the audit, and every other tool's parameter shapes and description strings match the audit. A grep over the recorded corpus confirms no recorded call ever passed the removed `multi_bash` element fields.
- No description in the standard set exceeds 2,000 characters, and the `lsp` description contains no `operation` value list; every behavior rule in the trimmed texts still has a test or a delivering link.
- ≈1,600 description characters leave the POSIX standard payload (≈2,700 on Windows); the record of that change is the refreshed snapshot corpus, whose diff touches only the trimmed strings.
- The three tool packages, `agent-team-profile`, and the `wind-up-wind-down` preset live under `_archive/` byte-identical to their previous locations; the installed workspace unchanged (`pnpm install` and `pnpm run typecheck` pass from a clean checkout; archived trees are outside every workspace glob).
- The shipped-preset roster test asserts exactly `['cordis', 'minimal', 'ptc', 'standard']`; `pnpm run verify-tool-catalog` passes with no `terminal_*`, `session_*`-query, or `team_*` rows; `pnpm run test:snapshot` passes after refresh; `pnpm run test:docs` stays green.

## Risks

- **Session introspection leaves the model surface.** `tool-session-query` is the only model-facing session-search capability. Reintroduction condition: move the consumer package back and mount it; the capability service remains in the repository, so only the consumer is restored.
- **The PTY control surface goes away.** Compositions that wanted named PTYs from the model lose `terminal_*`; the `sdk-minimal` PTY path rides `terminal-bash` and is unaffected.
- **The agent-team experiment leaves the catalog.** Archiving retires the model-facing Team tools and their profile on-ramp while the `dsh-experimental-agent-team` service stays in `packages/` with no consumer but its tests; if review judges the experiment live, scope this third archival out and amend the note rather than shipping a partial one.
- **Corpus churn.** Snapshot refresh rewrites recordings that pin the old description texts and batched call shapes; a sloppy refresh could also re-record unrelated drift, so the refreshed diff is limited to the trimmed strings and flattened shapes.
- **Per-call escalation leaves the model surface.** With `sandbox_permissions`/`justification` gone from both batch tools, writes and commands that would widen the sandbox fail denied until the session promotes via the staged-escalation machinery; user-authored integrations that emitted the old root retry shape must be updated in the same change or fail closed.
- **Flat-call integrations break.** Compositions or SDK fixtures invoking `multi_write`/`multi_bash` with the removed root fields must adopt the element-level shapes in the same change; the harness's own recorded fixtures are refreshed under the acceptance criteria, and pre-stable API surfaces absorb the break.
