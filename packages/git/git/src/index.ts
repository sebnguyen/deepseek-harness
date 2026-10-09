/**
 * Service Definition for the git capability seam (`ctx.git`): a provider
 * registry and execution-time selection over read-only repository queries —
 * status relative to HEAD and single-file diffs. Duplicate ids are rejected.
 * At execution time a configured provider must exist and be usable; without
 * one, exactly one usable provider is required, so selection never depends
 * on registration order.
 * @module @deepseek-ai/dsh-git
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { GitDiffRequest, GitFileDiff, GitProvider, GitStatusRequest, GitStatusResult } from './types.ts'
import { GitError } from './types.ts'

export { GitError } from './types.ts'
export type {
  GitDiffRequest,
  GitErrorCode,
  GitFileDiff,
  GitFileStatus,
  GitProvider,
  GitStatusEntry,
  GitStatusRequest,
  GitStatusResult,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    git: GitRuntime
  }
}

/** Selection inputs for execution-time provider resolution. */
interface Selection {
  /** The configured provider id for this capability, if any. */
  readonly configuredId?: string
  /** Providers registered for this capability. */
  readonly providers: ReadonlyMap<string, GitProvider>
}

/**
 * Config for the git seam. `provider` pins which provider wins; omitted, a
 * single registered usable provider auto-selects. `maxEntries` and
 * `maxFileBytes` are the deployment caps a request may narrow but never
 * widen.
 */
export interface GitRuntimeConfig {
  /** Explicit provider id. Omitted = auto-select when exactly one usable. */
  readonly provider?: string
  /** Inclusive cap on one status result's entries. */
  readonly maxEntries?: number
  /** Inclusive byte cap on one diff side's text. */
  readonly maxFileBytes?: number
}

/**
 * The git capability service. Registered as `ctx.git` (one instance per
 * context).
 *
 * Selection semantics (resolved at execution time, never order-dependent):
 * - A configured id that is registered and `available()` → that provider.
 * - A configured id not registered → `GIT_PROVIDER_CONFIGURED_MISSING`.
 * - A configured id registered but unavailable → `GIT_PROVIDER_CONFIGURED_UNAVAILABLE`.
 * - No id configured, exactly one registered usable provider → that provider.
 * - No id configured, multiple usable providers → `GIT_PROVIDER_AMBIGUOUS`.
 * - No id configured, no usable provider → `GIT_PROVIDER_UNAVAILABLE`.
 */
export class GitRuntime extends Service {
  static Config: z<GitRuntimeConfig> = z.object({
    provider: z.string(),
    maxEntries: z.number().step(1).min(1).default(5000),
    maxFileBytes: z.number().step(1).min(1).default(32 * 1024 * 1024),
  })

  private readonly providers = new Map<string, GitProvider>()
  private readonly configuredId: string | undefined
  private readonly maxEntries: number
  private readonly maxFileBytes: number

  /**
   * @param ctx - Host context the service registers into.
   * @param config - provider selection and the deployment caps.
   */
  constructor(ctx: Context, config: GitRuntimeConfig = {}) {
    super(ctx, 'git')
    this.configuredId = config.provider
    this.maxEntries = config.maxEntries ?? 5000
    this.maxFileBytes = config.maxFileBytes ?? 32 * 1024 * 1024
  }

  /**
   * Register a provider. Throws {@link GitError} `GIT_DUPLICATE_PROVIDER` if its
   * id is already registered. Returns a disposer; disposed with the calling
   * fiber.
   * @param provider - the provider; its `id` is the registry key.
   * @returns the disposer that unregisters the provider.
   */
  registerProvider(provider: GitProvider): () => void {
    if (this.providers.has(provider.id)) {
      throw new GitError(`a git provider with id "${provider.id}" is already registered`, 'GIT_DUPLICATE_PROVIDER')
    }
    const providers = this.providers
    const dispose = this.ctx.effect(function* () {
      providers.set(provider.id, provider)
      yield () => providers.delete(provider.id)
    }, 'git.registerProvider()')
    // ctx.effect's disposer returns Promise<void>; our disposer API is
    // synchronous fire-and-forget — discard the (always-resolved) promise.
    return () => void dispose()
  }

  /**
   * Read one repository's status through the selected provider. A result
   * above the request's (or configured) entry cap is truncated and flagged.
   * @param request - the repository root and optional entry cap.
   * @param signal - optional cancellation forwarded to the provider.
   * @returns the status, cut to the effective entry cap.
   */
  async status(request: GitStatusRequest, signal?: AbortSignal): Promise<GitStatusResult> {
    const cap = request.maxEntries ?? this.maxEntries
    const result = await this.resolve().status(request, signal)
    if (result.entries.length <= cap) return result
    return { ...result, entries: result.entries.slice(0, cap), truncated: true }
  }

  /**
   * Read one file's HEAD and worktree texts through the selected provider.
   * @param request - the repository root, file path, and optional byte cap.
   * @param signal - optional cancellation forwarded to the provider.
   * @returns the two texts, each within the effective byte cap.
   */
  async diff(request: GitDiffRequest, signal?: AbortSignal): Promise<GitFileDiff> {
    return this.resolve().diff(
      { ...request, ...request.maxFileBytes === undefined ? { maxFileBytes: this.maxFileBytes } : {} },
      signal,
    )
  }

  /** Resolve the selected provider or throw the matching {@link GitError}. */
  private resolve(): GitProvider {
    const selection: Selection = {
      providers: this.providers,
      ...this.configuredId !== undefined ? { configuredId: this.configuredId } : {},
    }
    const { configuredId, providers } = selection
    if (configuredId !== undefined) {
      const provider = providers.get(configuredId)
      if (!provider) {
        throw new GitError(`configured git provider "${configuredId}" is not registered`, 'GIT_PROVIDER_CONFIGURED_MISSING')
      }
      if (!provider.available()) {
        throw new GitError(`configured git provider "${configuredId}" is registered but unavailable`, 'GIT_PROVIDER_CONFIGURED_UNAVAILABLE')
      }
      return provider
    }
    const usable = [...providers.values()].filter(provider => provider.available())
    const [single] = usable
    if (single === undefined) {
      throw new GitError('no usable git provider is registered', 'GIT_PROVIDER_UNAVAILABLE')
    }
    if (usable.length > 1) {
      const ids = usable.map(provider => provider.id).join(', ')
      throw new GitError(`multiple usable git providers are registered (${ids}); configure one explicitly`, 'GIT_PROVIDER_AMBIGUOUS')
    }
    return single
  }
}

export default GitRuntime
