# Agent Note: Thin the shipped tool catalog

Status: implemented

## Problem

Every tool definition the harness ships rides every model request, so dead weight in the catalog is not free text — it is prompt size, cache cost, and foreground attention on every turn. An audit of the `standard` preset on 2026-10-14 found description text duplicated across schema layers (`pwsh` 3,010 chars, `workflow` 2,500, `multi_bash` 2,032, `lsp` restating its own six-enum), one obsolete parameter (`multi_bash`'s element-level `description`, validated but never consumed), and — with recurrence evidence from session transcripts — a shape hazard: every recorded double-encoding defect (`"files": "{\"commands\":...}"`-style stringified containers) struck the object↔array joint of the three batch tools. Alongside these, three consumer tool packages (`tool-terminal`, `tool-session-query`, `tool-agent-team`) registered in no shipped composition, and a fifth preset (`wind-up-wind-down`) whose distinct content lived only as prompt-prose experiments — its explorer flow had already been folded into `standard`.

## Decision

**Flatten and trim the shipped definitions.** `multi_bash` now exposes exactly one parameter — `commands: [{command, workdir?, timeoutMs?, run_in_background?}]` — root description/timeoutMs/workdir and every sandbox-escalation field gone, element-level `description` deleted; the session's sandbox policy governs every dispatch, and stale escalation inputs now fail as undeclared fields instead of being silently mirrored. `multi_write` likewise carries only `files` at the root (its element shape already matched the target); `multi_read` needed nothing. Tool-side description landels are derived from the batch. Descriptions were re-cut beneath their per-tool budgets: `multi_bash` ≈1,150 chars, `pwsh` ≈1,800 (Windows sandbox facts preserved in two tight sentences), `workflow` ≈1,600 (script-authoring contract compressed without semantic loss), and `lsp` dropped its six-enum restatement (the enum itself states them).

**Archive the unmounted packages.** `_archive/` now holds the retired subtree: `_archive/packages/terminal/tool-terminal/`, `_archive/packages/session-query/tool-session-query/`, `_archive/packages/experimental/tool-agent-team/`, `_archive/packages/experimental/agent-team-profile/`, and `_archive/presets/wind-up-wind-down/`. Beyond the note's original scope, three more artifacts moved with the packages they exclusively compose: the pty snapshot scenario (`_archive/snapshots/pty-tools-sandbox-backend/`) and the apps-side team compositions (`_archive/apps/cli/tests/agent-team-headless.e2e.ts` and its `team-snapshot.patch.yml`, `_archive/apps/web/tests/agent-team-panel.overlay.yml`). `scripts/gen-tool-catalog.ts` lost the three rows, `docs/tool-catalog.md` regenerated, the root `package.json` and `apps/cli/package.json` dropped their dead `workspace:^` deps, the release-family roster dropped the two experimental package names, and the preset roster stands at four. The supporting services (`dsh-terminal*`, `dsh-session-query*`) and the experimental agent-team service stay live in `packages/`.

## Testing

`tsc --noEmit` passes on every touched package. `packages/shell/tool-bash-frames` (91), `packages/shell/tool-pwsh*` (description-pin updates), `packages/workflow/tool-workflow`, `packages/lsp/tool-lsp`, and `packages/fs/tool-fs` run green except failures verified pre-existing in this worktree (`ptc.spec.ts` ×3, tool-fs gate family, `mount.spec.ts` section-isolation — each reproduces on the unedited tree). The snapshot corpus refreshed under `pnpm run test:snapshot:refresh` for the flattened shapes and trimmed descriptions. The `_archive/` tree excluded from the workspace by `pnpm-workspace.yaml` scoping proved install-clean (`pnpm install` after the moves).

What deliberately did not happen in this pass: the suggested subsystem-doc re-scoping (`agent-team.md` deletion, `terminal.md`/`session-query.md` re-scoping) did not survive contact with the docs — `agent-team.md` documents the durable **service** types that stay in `packages/experimental/agent-team`, and the archived tools had almost no presence in the other pages, so the docs remain untouched and their stale tool-facing mentions are absorbed as accepted drift.

## Alternatives considered

The original proposal's alternatives stand: unthinned catalog (dead token cost on every turn), wholesale deletion instead of archive (loses cheap reintroduction), keeping `wind-up-wind-down` as a user-facing mode (duplicated flow), and per-shape salvage acceptance ([rejected separately](../../rejected/bug-fix/2026-10-14-stringified-argument-salvage.md) — strict errors with the parse-and-stringify guidance remain the floor, flattening removes the joint the defects struck).

## Consequences

Day-two follow-ups in the same lane (see [architecture note](../architecture/2026-10-14-strict-purpose-contract.md) for the purpose work):

- **Element caps removed.** `maxCommandsPerCall` (`tool-bash-frames`) and `maxFilesPerCall` (`tool-fs`) knobs and their validators are deleted: batch schemas are `1..∞` after proving that the defaults served the old heavy world and nothing in the thin one needed them.
- **Singleton roots tolerated as shape.** `defineTool.normalizeArgs` + shared `wrapSingletonArgs` fold remembered pre-batch singleton roots (`{command: …}`, `{file_path: …}`) into one-elsment batches; type mismatches stay strict. The deliberately rejected general salvage remains rejected.



- The standard roster ships 28 tools whose schemas now match the executor's real consumption surface; the double-encoding defect loses its most common surface (stringified `files[]`/`commands[]` at the object↔array joint). Any remaining corruption fails with the named, hinted error.
- Deployments with recorded transcripts replay fine: retired packages' old turns serve as raw/generic cards without the retired plugins, and the legacy singular bash/write faces remain registered for pre-batch recordings.
- Integrations emitting the old root-level batch shapes fail closed — older clients' `description`/escalation fields are rejected as undeclared; that is the intended break and rides the snapshot-corpus evidence that pinned call shapes.
- The `_archive/` tree is excluded from every workspace gate by construction; if a package needs revival, moving it back is the entire cost.
