/**
 * SearXNG-backed `WebSearchProvider` plugin. It mounts `SearxngRuntime` — the singleton `ctx`
 * service that owns the one managed SearXNG container — then registers a `SearxngSearchProvider`
 * bound to it into the `ctx.web` registry. SearXNG is a self-hostable, open-source metasearch
 * engine, so this provider needs no API key and no configured endpoint: it launches and manages
 * its own Docker container automatically.
 *
 * @module @deepseek-ai/dsh-web-search-searxng
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { WebError } from '@deepseek-ai/dsh-web'
import type {} from '@deepseek-ai/dsh-subprocess'
import { SearxngSearchProvider } from './provider.ts'
import { SearxngRuntime, SEARXNG_DEFAULT_IMAGE, SEARXNG_DEFAULT_READY_TIMEOUT_MS } from './runtime.ts'

export { SEARXNG_PROVIDER_ID, SearxngSearchProvider } from './provider.ts'
export {
  SearxngRuntime,
  SEARXNG_DEFAULT_IMAGE,
  SEARXNG_DEFAULT_READY_TIMEOUT_MS,
} from './runtime.ts'
export type { SearxngInstanceSource, SearxngRuntimeOptions } from './runtime.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-searxng'

/** The web seam this provider registers into, and the subprocess seam the managed container needs. */
export const inject = ['web', 'subprocess']

/** Plugin config (all optional — `apply` fills the constant defaults). */
export interface Config {
  /** Docker image reference for the managed container. Defaults to a moving `latest` tag. */
  image?: string
  /** Upper bound (ms) to wait for the container to become ready. Defaults to 60000. */
  readyTimeoutMs?: number
}

export const Config: z<Config> = z.object({
  image: z.string(),
  readyTimeoutMs: z.number().step(1).min(1),
})

/** Mount the managed SearXNG runtime and register its search provider with `ctx.web`. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.plugin(SearxngRuntime, {
    image: config.image ?? SEARXNG_DEFAULT_IMAGE,
    readyTimeoutMs: config.readyTimeoutMs ?? SEARXNG_DEFAULT_READY_TIMEOUT_MS,
  })
  // `searxngRuntime` is this plugin's own creation, not a declared dependency,
  // so the topology-scoped `ctx.searxngRuntime` proxy is unavailable here —
  // `ctx.get` reads the global service store directly instead.
  const runtime = ctx.get('searxngRuntime')
  /* v8 ignore next 3 -- unreachable: the awaited `ctx.plugin` above only
   * resolves once SearxngRuntime has registered under this exact key */
  if (runtime === undefined) {
    throw new WebError('web-search-searxng: searxngRuntime failed to mount', 'WEB_PROVIDER_ERROR')
  }
  ctx.web.registerSearchProvider(new SearxngSearchProvider(runtime))
}
