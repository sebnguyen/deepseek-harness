/**
 * Twin dist discovery: where the VS Code twin lives when the deployment row
 * leaves `dist` empty.
 *
 * The twin dist is a ~485MB build output, so it is never vendored into
 * the repository: the vscode gulp lane lands it beside the sibling
 * `vscode` checkout, `scripts/bootstrap-vscode-twin.sh` builds it
 * from the pinned vscode fork into the harness-home cache, and the
 * discovery below finds all of those without an exported
 * `DSH_VSCODE_TWIN_DIST`, which is what lets a plain `dsh web` boot mount
 * the editor tab. Discovery candidates deliberately sit outside and inside
 * the repo root first, then the machine: the host's fresh gulp lane
 * (`vscode-reh-web-<platform>-<arch>`) beside the sibling `vscode` checkout
 * leads, so a development checkout serves the
 * build it just produced without restaging, then the sibling staging slot
 * shared by every worktree of the same clone (each worktree's `..` is the
 * checkout pool), then the in-repo slot of the self-contained single-clone
 * layout, and finally the machine-wide `$DSH_HOME/cache/vscode-twin/dist`
 * source-build cache — the only candidate shared across every clone on the
 * machine, so it ranks last and never shadows a developer's local staging.
 * An explicit deployment `dist` — the `DSH_VSCODE_TWIN_DIST` row — always
 * wins over every candidate.
 * @module @deepseek-ai/dsh-api-ide/twin-dist
 */

import { dshCachePath } from '@deepseek-ai/dsh-home-paths'
import { existsSync, realpathSync } from 'node:fs'
import { arch as hostArch, platform as hostPlatform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** One candidate qualifies when it holds the twin launcher the spawner execs. */
const LAUNCHER = join('bin', 'code-server-oss')

/**
 * The machine-wide source-build slot: `$DSH_HOME/cache/vscode-twin/dist`
 * (default `~/.dsh/cache/vscode-twin/dist`), written by
 * `scripts/bootstrap-vscode-twin.sh`. Resolution rides {@link dshCachePath}
 * so `$DSH_HOME` overrides apply exactly as every other harness-home
 * consumer sees them. One export keeps the candidates list and the tests
 * sharing a join.
 */
export function twinCacheDist(): string {
  return dshCachePath('vscode-twin', 'dist')
}

/**
 * The gulp lane the host's vscode checkout builds:
 * `vscode-reh-web-<platform>-<arch>`, matching the task matrix of
 * `build/gulpfile.reh.ts` (linux-x64/arm64, darwin-x64/arm64, win32-x64/
 * arm64). Its output lands beside the vscode checkout under this name.
 */
export function twinLaneName(): string {
  return `vscode-reh-web-${hostPlatform()}-${hostArch()}`
}

/**
 * Twin dist candidates under one repository root, in precedence order: the
 * freshly built gulp lane beside the sibling `vscode` checkout first — the
 * direct output of the host's `vscode-reh-web-<platform>-<arch>` task, so
 * dev dsh runs ride the last local build as-is — then the staged sibling
 * slot shared by every worktree of the clone, then the self-contained
 * in-repo slot, and finally the machine-wide source-build cache (see
 * {@link twinCacheDist}).
 */
export function twinDistCandidates(repoRoot: string): string[] {
  return [
    join(repoRoot, '..', twinLaneName()),
    join(repoRoot, '..', '.vscode-twin', 'dist'),
    join(repoRoot, '.vscode-twin', 'dist'),
    twinCacheDist(),
  ]
}

/**
 * Climb from `from` to the workspace root — the directory holding the
 * pnpm-workspace.yaml that declares the checkout. A fixed climb count cannot
 * survive the two load shapes (`packages/api/ide/src/*` on tsx,
 * `packages/api/ide/lib/*` plus `lib/types/twin-dist.js` from the built
 * package), so the climb stops at the workspace marker instead; without one
 * the historical four-climb stands, because the module ships at
 * `packages/api/ide/<face>` in every checkout as well as the consumer's
 * `node_modules` layout after `realpathSync` undoes the pnpm symlink.
 */
export function climbToRepoRoot(from: string): string {
  let dir = resolve(from)
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return resolve(from, '..', '..', '..', '..')
}

/** The repository root this module ships under, from its own load URL. */
function moduleRepoRoot(): string {
  return climbToRepoRoot(dirname(realpathSync(fileURLToPath(import.meta.url))))
}

/**
 * The first existing twin dist among {@link twinDistCandidates}, or `null`
 * when no candidate was staged — the namespace stays disabled then.
 */
export function findTwinDist(repoRoot: string = moduleRepoRoot()): string | null {
  for (const candidate of twinDistCandidates(repoRoot)) {
    if (existsSync(join(candidate, LAUNCHER))) return candidate
  }
  return null
}

/**
 * Deployment-row `dist` resolution: the explicit config value wins, otherwise
 * discovery decides, returning '' (disabled) when nothing was staged.
 */
export function resolveTwinDist(configured: string, repoRoot?: string): string {
  if (configured !== '') return configured
  return findTwinDist(repoRoot) ?? ''
}
