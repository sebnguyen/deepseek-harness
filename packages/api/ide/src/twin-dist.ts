/**
 * Twin dist discovery: where the VS Code twin lives when the deployment row
 * leaves `dist` empty.
 *
 * The twin dist is a ~485MB build output, so it is never vendored into
 * the repository: `scripts/bootstrap-vscode-twin.sh` builds it from the
 * pinned vscode fork into the one machine-wide pipeline slot —
 * `$DSH_HOME/cache/vscode-twin/dist` (default `~/.dsh/cache/vscode-twin/dist`)
 * — and that cache is the only discovered location, so every clone on the
 * machine serves the same freshly built twin without an exported
 * `DSH_VSCODE_TWIN_DIST`. An explicit deployment `dist` — the
 * `DSH_VSCODE_TWIN_DIST` row — always wins over the cache.
 * @module @deepseek-ai/dsh-api-ide/twin-dist
 */

import { dshCachePath } from '@deepseek-ai/dsh-home-paths'
import { existsSync, realpathSync } from 'node:fs'
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
 * The twin dist pipeline: the machine-wide source-build cache only (see
 * {@link twinCacheDist}), so a stale or half-built sibling lane beside a
 * checkout can never shadow the bootstrap product. `repoRoot` stays on the
 * signature for call compatibility; the pipeline location is machine-wide,
 * not repo-relative.
 */
export function twinDistCandidates(_repoRoot?: string): string[] {
  return [twinCacheDist()]
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
