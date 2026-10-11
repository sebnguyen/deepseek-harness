/**
 * Twin dist discovery: where the VS Code twin lives when the deployment row
 * leaves `dist` empty.
 *
 * The twin dist is a 600MB-class build output, so it is never vendored into
 * the repository: `scripts/prepare-vscode-twin.sh` stages it beside the
 * checkout (or inside it) and the discovery below finds it without an
 * exported `DSH_VSCODE_TWIN_DIST`, which is what lets a plain `dsh web`
 * boot mount the editor tab. Discovery candidates deliberately sit outside
 * and inside the repo root, in that order: the sibling slot is shared by
 * every worktree of the same clone (each worktree's `..` is the checkout
 * pool), while the in-repo slot is the self-contained single-clone layout.
 * An explicit deployment `dist` — the `DSH_VSCODE_TWIN_DIST` row — always
 * wins over both.
 * @module @deepseek-ai/dsh-api-ide/twin-dist
 */

import { existsSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** One candidate qualifies when it holds the twin launcher the spawner execs. */
const LAUNCHER = join('bin', 'code-server-oss')

/**
 * Twin dist candidates under one repository root, in precedence order: the
 * sibling slot shared by every worktree of the clone first, then the
 * self-contained in-repo slot.
 */
export function twinDistCandidates(repoRoot: string): string[] {
  return [
    join(repoRoot, '..', '.vscode-twin', 'dist'),
    join(repoRoot, '.vscode-twin', 'dist'),
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
