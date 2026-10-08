# Agent Note: Base owns the host plane; presets own the agent plane

Status: proposed

## Problem

The base bundle (`packages/bundle/base/cordis.patch.yml`, 93 rows) mixes two planes although its own rule already forbids mode-varying rows (`packages/bundle/base/cordis.patch.yml:6-13`, `packages/bundle/base/README.md:158`): beside process-wide registries it mounts roughly 24 per-agent rows — `tool-bash`, `tool-pwsh`, `tool-fs`, `tool-lsp`, `tool-lsp-map`, `tool-jobs`, `skill-filesystem`, `tool-skill`, `command-goal`, `tool-goal`, `plan-mode`, `compaction-basic`, `command-compact`, `tool-result-pruner`, the subagent/workflow/ralph tool rows, `agent-instructions`, `tool-todo`, `tool-web` — for the single-session surfaces, and the host-plane criterion stated in `packages/bundle/web-app/cordis.patch.yml:445-472` and `.agents/notes/implemented/architecture/2026-08-10-host-plane-ownership-after-presets.md` classifies exactly those rows as per-agent.

The mix costs every delivered feature twice. The Web surface inserts those base rows only to disable them again (`packages/bundle/web-app/cordis.patch.yml:463-572`) and mounts its per-session agent plane from the preset roster instead, while the headless, sdk, and acp surfaces keep the base agent rows and therefore never receive agent-plane features that shipped after the base snapshot — `explore`, `tool-ask-user`, `tool-present`, and `delegation-cap` exist only in `packages/preset/agent-presets/presets/standard/agent.cordis.yml` — so the same product behaves differently per surface. Every agent-facing change must be hand-applied to the base patch and to each preset file; `6caadd6abc` / `ff86c93e07` (batch bash in every preset, LSP and snapshot capture in base) is the recurring shape of that fan-out.

The agent plane simultaneously has no single authoring site: presets are complete standalone compositions with copy-only authoring (`packages/preset/agent-presets/README.md`, "a copy is a snapshot that drifts"), `cordis` and `ptc` duplicate `standard`'s full assembly, and nothing stops a sixth authoring site (the base patch, example overlays) from growing its own agent plane.

## Proposal

Classify every composition row by its subject into exactly three planes, and give each plane one owner:

| Plane | Test | Owner today |
|---|---|---|
| Host | The row's service or effect is process-wide, or resolves before any session exists (registries, providers, persistence, sandbox and approval stack, model route, loop hygiene) | `dsh-base` |
| Agent | The row is model-facing per agent: tools, persona and prompt sections, per-agent policy | Presets under `packages/preset/agent-presets/presets/`; `standard` is the canonical full assembly |
| Surface | The row is transport, host/client UI, or app startup | The mode bundles `web-app`, `headless`, `acp-app`, `sdk-app` (and example overlays) |

The roster mount itself is host plane — the standing mounts are process-wide and the default preset resolves before any session — so `dsh-base` gains one `agent-presets` row (`default: standard`) and loses its agent-plane rows; every base-backed surface then receives the agent plane from the preset roster, and `web-app` deletes its now-unneeded disable block. `sdk-minimal` stays the documented standalone exception (`packages/bundle/sdk-minimal/README.md`): an automation composition that deliberately owns its whole tree. Presets keep copy-only authoring; the drift cost that remains is bounded to `packages/preset/` because no agent-plane row may live anywhere else.

### Classification of the current base rows

Host plane — stays in `dsh-base`:

| Group | Rows |
|---|---|
| Spine and model route | `timer`, `hmr` (disabled), `llm`, `llm-deepseek`, `llm-pi-ai`, `llm-retry`, `deepseek-llm-api-extensions`, `agent-default-model`, `agent`, `agent-loop`, `tools`, `system-prompt`, `typert`, `typert-loader`, `typert-gateway`, `plugin-package-inventory-deepseek` |
| Session data plane | `session`, `session-log-deepseek`, `session-title`, `session-title-llm`, `session-persistence-jsonl`, `session-query-sqlite`, `session-projection`, `session-projection-cache`, `session-telemetry-otel`, `session-checkpoint-policy`, `checkpoint` |
| Storage and identity | `storage`, `storage-json`, `storage-domain`, `attachment-local`, `settings`, `credentials` |
| Execution substrate | `subprocess`, `sandbox`, `sandbox-policy`, `bash-sandbox`, `pwsh-sandbox`, `shell-env`, `shell-search`, `lsp`, `lsp-stdio` (disabled), `jobs`, `spill-local`, `spill-policy` |
| Registries and cross-session services | `skill`, `goal`, `goal-round-driver`, `subagent`, `subagent-spawn-in-process`, `subagent-fork-in-process`, `token-meter`, `web`, `web-search-searxng`, `web-fetch-http` |
| Collaboration and hygiene | `approval`, `permission`, `user-questions`, `commands`, `command-feedback`, `timeout-policy`, `repeat-tool-reminder`, `staged-escalation` |

Agent plane — deleted from `dsh-base`; every row already exists in `standard`, which becomes the only copy: `tool-bash`, `tool-pwsh`, `tool-fs`, `tool-lsp`, `tool-lsp-map`, `tool-jobs`, `skill-filesystem`, `tool-skill`, `command-goal`, `tool-goal`, `plan-mode`, `compaction-basic`, `command-compact`, `tool-result-pruner`, `tool-subagent-control`, `tool-subagent-list-agents`, `tool-subagent`, `tool-subagent-fork`, `workflow-worker-thread`, `tool-workflow`, `tool-ralph`, `agent-instructions`, `tool-todo`, `tool-web`, plus the preset-only rows that thereby reach every surface: `persona`, `tool-subagent-explore`, `delegation-cap`, `tool-ask-user`, `tool-present`.

**Shelved for now.** `knowledge-notes` (the `read_note`/`upsert_note` file-anchored notes plus their prompt section) goes to neither plane this round: the row and the `dsh-base` dependency were removed on landing this note, so no surface composes the tools until a later PR places them; `packages/knowledge/knowledge-notes` stays the placement point, and the spec pins the row's absence. Workspace snapshotting is the opposite case and stays host plane either way: `checkpoint` capture and `session-checkpoint-policy` are services with per-process reach (the base patch states this at its `checkpoint` row), no preset names them, and the Web timeline view is only the `ui-file-history` client row in `web-app` — the same split as `code-runtime` (engine in the surface bundle, engine seam in the host).

Surface plane — unchanged in the mode bundles: web host routes and the `client-ui-*` roster, `sdk-jsonrpc-server` + `sdk-app-startup`, `acp` + `acp-app-startup`, `headless-startup` + `headless-runner` + `code-runtime`, per-surface `system-prompt` overrides and `session-title-llm` disables.

### Enforcement

Add `scripts/verify-plane-ownership.ts` to `doc-sync`: an allowlist of host-plane row ids asserted against `packages/bundle/base/cordis.patch.yml`, and an allowlist of agent-plane row ids asserted against every `agent.cordis.yml` under `packages/preset/agent-presets/presets/`; a row appearing in both trees fails the gate. The allowlists are the mechanical full form of the tables above; adding a delivered feature requires choosing its plane in the same PR.

## Migration plan

1. Land this note and the gate in audit mode (report violations, exit 0) so the two allowlists start reviewed.
2. `dsh-base` inserts the `agent-presets` row with `default: standard`; verify the non-web session paths (headless runner, `sdk-jsonrpc-server`, `acp`) join the standing mount by scope parentage without naming a preset, and flip the gate for the base side.
3. `dsh-base` deletes the agent-plane rows; `web-app` deletes its disable block and its own `agent-presets` insert; refresh `apps/cli/composition.md`, the base and web-app READMEs, and the affected snapshots as deliberate replays.
4. Flip the gate to enforcing; move this note to `implemented/` with the tables kept current.

## Alternatives considered

**A shared `dsh-agent-standard` bundle plus preset inheritance.** Extracting the agent rows into their own bundle and giving presets an `include` mechanism also removes the fan-out, but it adds loader-level composition semantics that copy-only authoring deliberately declined (`packages/preset/agent-presets/README.md`, "there is no patch semantics at this layer"), and it leaves a second agent-plane authoring site that presets must diff against; mounting the existing roster reuses a shipped, tested mechanism instead.

**Keep the topology; document the planes and add the gate only.** Cheapest, but the base keeps rows the host-plane note already classifies as per-agent, the Web surface keeps inserting rows to disable them, and non-web surfaces keep missing delivered agent features — the two symptoms this note exists to remove.

**Retire the roster and move presets into the base.** Reverses the split: one composition for all surfaces, but the Web product runs several differently composed agents per process (`standard`, `ptc`, `cordis`, `minimal`, `wind-up-wind-down`), which a single base cannot express; the per-session composition note (`.agents/notes/implemented/architecture/2026-08-03-per-session-agent-presets.md`) owns that requirement.

## Acceptance criteria

`verify-plane-ownership` runs in `doc-sync` and passes with the base agency list empty; `dsh --profile headless|sdk|acp|web` each advertise the `standard` catalog including `explore`, `ask_user_question`, `present`, and the delegation cap; `packages/bundle/web-app/cordis.patch.yml` contains no disable rows targeting former base agent ids; headless/sdk/acp snapshot replays pass with refreshed expected output where the catalog change is visible.

## Risks

Automation surfaces change shape: SDK and ACP agents gain the full `standard` tool catalog (delegation, workflow, ralph, ask-user), altering prompts and token costs for consumers that chose those surfaces for a smaller agent; `minimal` and custom presets remain the opt-out, and the release notes must name the change.

User layers that patch former base agent rows by id (`$DSH_HOME/cordis.patch.yml`, per-profile patches) stop resolving once the rows move: a patch targeting a missing id is either a load failure or a silent no-op depending on patch semantics, so the migration must document the rewrite path (the same configuration now belongs in a copied preset).

The roster default makes `standard` the agent plane of bare and custom profiles whose bundle list is only `dsh-base`; deployments that relied on the base agent rows as a fixed single-tool surface must pin `minimal` instead.

Non-web session creation paths have never named a preset; if ACP or SDK session initiation cannot join a standing mount by parentage (authority or scope-key differences), phase 2 surfaces it and the row moves from `dsh-base` into each app bundle instead.
