/**
 * Cordis plugin registering the read-only isomorphic-git provider on
 * `ctx.git`. The provider reads through the composed `ctx.fs` filesystem,
 * so the same row serves local and remote execution worlds; a world whose
 * backend cannot reach the repository's `.git` simply reports no status.
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-git'
import { IsomorphicGitProvider } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'git-isomorphic'

/** The seam and the filesystem this provider reads through. */
export const inject = ['git', 'fs']

/** Provider identity and the internal read cap. */
export interface Config {
  /** Registry key the provider registers under. */
  readonly id?: string
  /** Inclusive byte cap on one internal read and one diff side a request does not narrow. */
  readonly maxFileBytes?: number
}

export const Config: z<Config> = z.object({
  id: z.string().default('isomorphic-git'),
  maxFileBytes: z.number().step(1).min(1).default(32 * 1024 * 1024),
})

/** Register the isomorphic-git provider with `ctx.git`. */
export function apply(ctx: Context, config: Config): void {
  ctx.git.registerProvider(new IsomorphicGitProvider(ctx, config.id ?? 'isomorphic-git', config.maxFileBytes ?? 32 * 1024 * 1024))
}
