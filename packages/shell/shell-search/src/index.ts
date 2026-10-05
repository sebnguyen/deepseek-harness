/**
 * Grep-family command shims for model shell calls: POSIX wrappers named
 * `grep`, `egrep`, and `fgrep` generated at boot under the Harness home's
 * `shell-search/` directory and prepended to the harness process `PATH`, so
 * every command a model shell tool runs resolves the grep family through
 * them. With a resolvable ripgrep binary (the vendored
 * `@vscode/ripgrep-<plat>` platform package first, then `rg` on `PATH`) the
 * wrappers exec a generated Node translator that maps GNU grep argv onto
 * ripgrep argv through a fail-open table; without one they exec the host
 * GNU grep verbatim. Ownership of the directory and the `PATH` prepend is a
 * single effect: disposing the plugin restores the prior `PATH`,
 * unregisters the `DSH_SEARCH_BIN` shell-environment fact, and removes the
 * generated directory.
 *
 * @module @deepseek-ai/dsh-shell-search
 */

import { accessSync, chmodSync, constants, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-shell-env'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import z from '@deepseek-ai/schemastery'
import { findExecutable, renderShims, renderTranslator, SHIM_NAMES } from './shims.ts'
import type { ShimBackend } from './shims.ts'

export const name = 'shell-search'
export const inject: string[] = ['shellEnv']

/** Plugin config (all optional — every field has a boot-time default). */
export interface Config {
  /** Harness home hosting `shell-search/`; highest precedence of the home resolution order. */
  dshHome?: string
  /** Absolute ripgrep binary path; startup fails when it is not executable. */
  rg?: string
}

/** Runtime configuration schema for the shell-search plugin. */
export const Config: z<Config> = z.object({
  dshHome: z.string(),
  rg: z.string(),
})

/**
 * `@vscode/ripgrep` platform-package suffix per `process.platform/process.arch`;
 * mirrors the optionalDependencies the main ripgrep package declares.
 */
export const PLATFORM_SUFFIX: Record<string, string> = {
  'linux/x64': 'linux-x64',
  'linux/arm64': 'linux-arm64',
  'linux/arm': 'linux-arm',
  'linux/ia32': 'linux-ia32',
  'linux/ppc64': 'linux-ppc64',
  'linux/s390x': 'linux-s390x',
  'linux/riscv64': 'linux-riscv64',
  'darwin/x64': 'darwin-x64',
  'darwin/arm64': 'darwin-arm64',
  'win32/x64': 'win32-x64',
  'win32/arm64': 'win32-arm64',
  'win32/ia32': 'win32-ia32',
}

/**
 * Resolve the ripgrep backend by precedence: an explicit configured path
 * (validated executable at boot), then the installed `@vscode/ripgrep-<plat>`
 * platform package selected for the current platform, then `rg` on `PATH`.
 *
 * @param configuredRg - the plugin config's explicit binary path, when set.
 * @param shimDir - the directory the shims will live in, excluded from `rg` discovery.
 * @returns the resolved ripgrep path, or `undefined` when no tier has one.
 * @throws when a configured path is not executable.
 */
export function resolveRg(configuredRg: string | undefined, shimDir: string): string | undefined {
  if (configuredRg !== undefined) {
    try {
      accessSync(configuredRg, constants.X_OK)
    } catch {
      throw new Error(`shell-search: configured rg binary is not executable: ${configuredRg}`)
    }
    return configuredRg
  }
  const suffix = PLATFORM_SUFFIX[`${process.platform}/${process.arch}`]
  if (suffix !== undefined) {
    try {
      const requireFromHere = createRequire(import.meta.url)
      const mainPackage = requireFromHere.resolve('@vscode/ripgrep')
      const platformPackage = createRequire(mainPackage).resolve(`@vscode/ripgrep-${suffix}/package.json`)
      /* v8 ignore next -- the win32 executable name is unreachable on the POSIX run host */
      const binary = join(dirname(platformPackage), 'bin', process.platform === 'win32' ? 'rg.exe' : 'rg')
      accessSync(binary, constants.X_OK)
      return binary
    } catch {
      /* v8 ignore next -- package resolves but payload binary missing is not constructible under a correct install */
      // The main or platform package is absent or the payload binary missing; the PATH tier decides.
    }
  }
  return findExecutable('rg', shimDir)
}

/**
 * Resolve the complete backend for one generation: the ripgrep tier (see
 * {@link resolveRg}) plus the host grep the fall-back forms exec.
 *
 * @param configuredRg - the plugin config's explicit binary path, when set.
 * @param shimDir - the directory the shims will live in.
 * @returns the resolved backend.
 * @throws when a configured rg is not executable, or no host grep exists.
 */
export function resolveBackend(configuredRg: string | undefined, shimDir: string): ShimBackend {
  const hostGrep = findExecutable('grep', shimDir)
  if (hostGrep === undefined) throw new Error('shell-search: no host grep found on PATH to fall back to')
  const rg = resolveRg(configuredRg, shimDir)
  return rg === undefined ? { hostGrep } : { hostGrep, rg }
}

/**
 * Generate the grep-family shims and the Node translator under the Harness
 * home, prepend the shim directory to `PATH` on POSIX, and expose the
 * directory as `DSH_SEARCH_BIN` through the managed shell environment.
 *
 * @param ctx - the plugin context; the shell environment registry is reached through it.
 * @param config - the deployment's config after schema defaulting.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const dir = join(resolveDshHome(config.dshHome), 'shell-search')
  const binDir = join(dir, 'bin')
  ctx.effect(function* prepareShims(this: Context) {
    const backend = resolveBackend(config.rg, binDir)
    mkdirSync(binDir, { recursive: true })
    const translatePath = join(dir, 'translate.mjs')
    writeFileSync(translatePath, renderTranslator())
    const shims = renderShims(backend, translatePath)
    for (const shimName of SHIM_NAMES) {
      const shimPath = join(binDir, shimName)
      writeFileSync(shimPath, shims[shimName])
      chmodSync(shimPath, 0o755)
    }
    const previousPath = process.env.PATH
    if (process.platform !== 'win32') {
      /* v8 ignore next -- a grep discoverable on PATH requires PATH to be set, so the unset-PATH assignment is unreachable */
      process.env.PATH = previousPath === undefined ? binDir : `${binDir}:${previousPath}`
    }
    const disposeContribution = ctx.shellEnv.register({
      name,
      variables: { DSH_SEARCH_BIN: { description: 'Directory of the shell-search grep-family command shims.' } },
      resolve: () => ({ DSH_SEARCH_BIN: binDir }),
    })
    yield () => {
      disposeContribution()
      process.env.PATH = previousPath
      rmSync(dir, { recursive: true, force: true })
    }
  }.bind(ctx), 'shell-search.prepare()')
}
