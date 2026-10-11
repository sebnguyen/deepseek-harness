/**
 * Generic pi-ai-backed LLM adapter plugin. One plugin instance owns a dict of
 * provider routes; a route naming an installed pi-ai provider inherits that
 * provider's endpoint, protocol, and model catalog as defaults, and a route
 * pi-ai does not ship is declared outright. Profile facts resolve per request
 * over the optional `llm-pi-ai` user-settings section and the optional
 * credential seam, so a changed key, endpoint, model, or knob reaches the next
 * request without a restart; a changed *route set* (or a route's
 * registration-captured retry policy) re-registers the same adapter instance
 * in place.
 *
 * ```yaml
 * - id: llm
 *   name: '@deepseek-ai/dsh-llm-pi-ai'
 *   config:
 *     providers:
 *       # Catalog route: everything but the credential comes from pi-ai.
 *       openai:
 *         apiKeyEnv: OPENAI_API_KEY
 *         retryPolicy:
 *           mode: normal
 *           maxRetries: 2
 *       # Catalog route with the catalog narrowed and one capacity corrected.
 *       anthropic:
 *         apiKeyEnv: ANTHROPIC_API_KEY
 *         models:
 *           - id: claude-sonnet-4-5
 *             contextWindow: 200000
 *       # Hand-declared route: pi-ai ships nothing under this key.
 *       acme-gateway:
 *         displayName: Acme Gateway
 *         apiKeyEnv: ACME_GATEWAY_API_KEY
 *         api: openai-completions
 *         baseURL: https://gateway.acme.example/v1
 *         # Reasoning dialect for a URL pi-ai cannot recognize.
 *         compat:
 *           thinkingFormat: deepseek
 *         models:
 *           - id: acme-large
 *             name: Acme Large
 *             contextWindow: 65536
 *             maxTokens: 4096
 *           - id: acme-think
 *             name: Acme Think
 *             contextWindow: 262144
 *             maxTokens: 32768
 *             # key = selectable level, value = wire spelling; only off may
 *             # leave the value empty (supported, send nothing).
 *             reasoningEfforts:
 *               off:
 *               high: high
 *               max: ultra
 * ```
 *
 * @module @deepseek-ai/dsh-llm-pi-ai
 */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { assertUsableApiKey, LlmError, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type { AdapterRegistrationHandle, DirectoryRegistrationHandle, LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-settings'
// Type-only: brings the `ctx.sessions` service and the durable `request/wire`
// event member into the program; the capture hook below appends through them.
import type {} from '@deepseek-ai/dsh-session'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'
import { PiAiAdapter } from './adapter.ts'
import { authContextFrom, credentialStoreFrom } from './auth.ts'
import { catalogProviderIds, shippedRoute } from './catalog.ts'
import { assertServiceable, Config, resolveProfiles } from './config.ts'
import type { PiAiModelProfile, ResolvedPiAiProviderProfile } from './config.ts'
import { discoverModels } from './discovery.ts'
import type { StoredModelDiscoveryProfile } from './discovery.ts'
import { registerPiAiFlows } from './login.ts'

export { PiAiAdapter } from './adapter.ts'
export type { PiAiAdapterOptions, PiAiWireRequest } from './adapter.ts'
export { Config } from './config.ts'
export type {
  PiAiCompatProfile,
  PiAiModality,
  PiAiModelOverride,
  PiAiModelProfile,
  PiAiProviderProfile,
  PiAiReasoningEfforts,
  PiAiThinkingFormat,
  ResolvedPiAiProviderProfile,
} from './config.ts'
export { recordKeyFor } from './auth.ts'
export { supportedProtocols } from './provider.ts'

export const name = 'llm-pi-ai'
export const inject = ['llm']

const NS = 'llm-pi-ai'

/**
 * Interval between live-catalog interrogations of a route whose models come
 * from its endpoint. The endpoint's listing is the catalog, so a route keeps
 * serving what the vendor publishes without anyone storing a model list.
 */
const LIVE_REFRESH_INTERVAL_MS = 10 * 60_000

/**
 * The registry captures these per route; a change here must re-register.
 * Sorted by provider so a settings document that merely reorders its keys is
 * not mistaken for a route change.
 */
function registrationFacts(profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>): unknown {
  return [...profiles.entries()]
    // `displayName` rides along because the registry hands it to every selector
    // through `providerInfo()`: a rename that did not re-register would leave
    // the old label showing until some unrelated fact happened to change.
    .map(([provider, profile]) => ({
      provider,
      displayName: profile.displayName,
      retryPolicy: profile.retryPolicy,
    }))
    .sort((left, right) => left.provider.localeCompare(right.provider))
}

/**
 * The configurable-provider directory: every installed catalog route, plus
 * every route the current profiles declare. A hand-declared route has no
 * catalog entry, so without this union it would have no settings address and
 * configuration surfaces could neither show nor edit it.
 * @param profiles - the currently resolved provider profiles.
 * @returns the directory entries in catalog order, declared routes last.
 */
function directoryEntries(
  profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>,
): LlmConfigurableProvider[] {
  const catalog = new Set(catalogProviderIds())
  const entries = new Map<string, LlmConfigurableProvider>()
  const declare = (provider: string, displayName: string, error?: string): void => {
    entries.set(provider, {
      provider,
      displayName,
      settingsNs: NS,
      settingsPath: ['providers', provider],
      // Membership of the installed catalog, not of the settings document:
      // narrowing a shipped provider's models stores a profile too, and that
      // route is still one pi-ai knows.
      declared: !catalog.has(provider),
      ...error === undefined ? {} : { error },
    })
  }
  for (const provider of catalog) {
    declare(provider, shippedRoute(provider)?.displayName ?? provider)
  }
  for (const [provider, profile] of profiles) declare(provider, profile.displayName, profile.catalogError)
  return [...entries.values()]
}

/** Register one generic pi-ai adapter for all configured provider routes. */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  let lastRaw: Config | undefined
  let lastLiveVersion = -1
  let memoized: ReadonlyMap<string, ResolvedPiAiProviderProfile> | undefined
  /** The models the last endpoint interrogation fetched, per live route. */
  const liveModels = new Map<string, readonly PiAiModelProfile[]>()
  let liveVersion = 0
  /**
   * The resolved profiles for the current configuration, memoized by the raw
   * snapshot's identity — which is also what makes the adapter's own snapshot
   * stable across operations that observe no change.
   *
   * Catalog diagnostics stay in the snapshot beside serviceable models, so
   * stored configuration remains visible after an installed catalog changes.
   * Scalar configuration errors still reject resolution.
   */
  const profiles = (): ReadonlyMap<string, ResolvedPiAiProviderProfile> => {
    const raw = current()
    if (raw === lastRaw && lastLiveVersion === liveVersion && memoized !== undefined) return memoized
    // A live route's stored profile carries no models; the fetched feed is
    // merged in here so resolution, registration, and the adapter all see
    // the endpoint's catalog without anything landing in settings.
    const providers = liveModels.size === 0
      ? raw.providers
      : Object.fromEntries(Object.entries(raw.providers ?? {}).map(([route, profile]) => {
        const feed = liveModels.get(route)
        const stored = profile.models?.length ?? 0
        // A fresh array: `PiAiModelProfile.models` is mutable by schema, and
        // sharing the feed's would alias resolution's own copy.
        return [route, feed === undefined || stored > 0 ? profile : { ...profile, models: [...feed] }]
      }))
    const next = resolveProfiles(providers, 'deferred')
    lastRaw = raw
    lastLiveVersion = liveVersion
    memoized = next
    return next
  }
  profiles()

  const resolveApiKey = async (
    provider: string,
    profile: ResolvedPiAiProviderProfile,
  ): Promise<string | undefined> => {
    const ref = profile.apiKeyEnv
    // Only a profile that names no credential at all defers to pi-ai's
    // provider-native discovery. Once one is named, a miss must fail loud:
    // handing pi-ai `undefined` would let it pick up an unrelated ambient key
    // (OPENAI_API_KEY and friends), billing another tenant for a request the
    // deployment meant to authenticate differently.
    if (ref === undefined) return undefined
    const credentials = ctx.get('credentials')
    const hit = credentials !== undefined
      ? (await credentials.resolve(ref))?.value
      // Without the seam the environment is the whole credential plane.
      : launchEnvironmentOf(ctx).get(ref)?.value
    if (hit !== undefined && hit.length > 0) return assertUsableApiKey(hit, 'llm-pi-ai', ref)
    throw new LlmError(
      `llm-pi-ai: no credential for provider route "${provider}"; its profile resolves ${ref}, which is not`
      + ` set — store ${ref} through the credentials service (the web Models page writes it) or export it,`
      + ' and remove apiKeyEnv only if this provider should authenticate from pi-ai\'s own environment discovery',
      'MISSING_CREDENTIAL',
    )
  }

  // One store and one ambient context for the whole plugin instance: both read
  // through `ctx` per call, so they stay correct across the collection rebuilds
  // a configuration change causes, and a sign-in survives one.
  const auth = { credentials: credentialStoreFrom(ctx), authContext: authContextFrom(ctx) }
  const adapter = new PiAiAdapter({
    profiles,
    resolveApiKey,
    auth,
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
      attachments,
      hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath),
      ref,
    ),
    onReplayDegrade: ({ provider, model, reason }) => {
      ctx.logger.warn(
        `llm-pi-ai: unusable replay state on assistant history for route "${provider}/${model}";`
        + ` sending that message as provider-neutral content (${reason})`,
      )
    },
    onWireRequest: (request) => {
      if (request.sessionId === undefined) return
      ctx.get('sessions')?.get(request.sessionId)?.append('request/wire', {
        provider: request.provider,
        model: request.model,
        ...request.purpose === undefined ? {} : { purpose: request.purpose },
        payload: request.payload,
      })
    },
  })
  // Independent of the route set: signing in is what makes a route worth
  // adding, so the flows are offered before any profile names their provider.
  // Scoped to the authorization seam rather than injected outright, because a
  // composition without it (headless, ACP) simply has no surface to sign in
  // from, while everything else this plugin does still works.
  ctx.inject(['authorization'], (authorized) => { registerPiAiFlows(authorized, auth) })
  // The shipped catalog is configurable from the moment the plugin mounts —
  // dormant or not — so configuration surfaces offer the providers this build
  // ships before any route exists. Hand-declared routes join it as profiles
  // appear, and leave with them.
  let directory: DirectoryRegistrationHandle | undefined
  let directoryFacts: unknown
  const ensureDirectory = (): void => {
    const entries = directoryEntries(profiles())
    if (deepEqualJson(entries, directoryFacts)) return
    // Atomic replace, never dispose-then-register: a route another adapter
    // family already declares (a profile keyed `deepseek-official`) would
    // otherwise leave this plugin's whole directory withdrawn and the Models
    // page empty. The candidate set is validated first, so a collision keeps
    // the previous entries serving and only costs a diagnostic.
    if (directory === undefined) {
      directory = ctx.llm.registerConfigurableProviders(entries)
    } else {
      directory.replace(entries)
    }
    directoryFacts = entries
  }
  ensureDirectory()
  /** Host-owned request inputs for discovery of one configured route. */
  const storedDiscoveryProfile = (
    provider: string | undefined,
  ): StoredModelDiscoveryProfile | undefined => {
    if (provider === undefined) return undefined
    const profile = profiles().get(provider)
    if (profile === undefined) return undefined
    return {
      headers: profile.headers,
      resolveApiKey: () => resolveApiKey(provider, profile),
    }
  }
  // Interrogating an endpoint is a configuration-time action over a draft, so
  // it is offered for the whole namespace rather than per route: the provider
  // a surface is adding does not exist yet. The draft is the whole request
  // except the stored credential and deployment-owned headers: the curated UI
  // accepts neither, so an already-configured route supplies both inside the
  // Host rather than widening the discovery request.
  ctx.llm.registerModelDiscovery(NS, (request, signal) => discoverModels(
    { ...request, ...signal === undefined ? {} : { signal } },
    () => storedDiscoveryProfile(request.provider),
  ))
  // Route effects bind to this apply fiber via the stable `ctx` reference,
  // even when a swap runs inside the scoped settings callback below. A bare
  // mount (zero routes) is the dormant posture: nothing registers until a
  // settings section supplies profiles, and routes drop when it empties.
  let registration: AdapterRegistrationHandle | undefined
  let registeredFacts: unknown
  const ensureRegistrationFacts = (): void => {
    const facts = registrationFacts(profiles())
    if (deepEqualJson(facts, registeredFacts)) return
    // The registry captures the route set and each route's retry policy at
    // registration, so a change to either must re-register. The swap is
    // atomic (same adapter instance, validated before anything moves): a
    // conflicting route leaves the previous routes serving requests, and
    // `registeredFacts` only advances once the registry actually holds the
    // new set — so returning to a working configuration always re-applies.
    const routes = [...profiles().keys()]
    if (registration === undefined) {
      // Dormant bare mount: nothing is registered until a section supplies
      // profiles, and an empty section keeps it that way.
      if (routes.length === 0) {
        registeredFacts = facts
        return
      }
      registration = ctx.llm.registerAdapter(routes, adapter)
    } else {
      registration.replace(routes)
    }
    registeredFacts = facts
  }
  ensureRegistrationFacts()

  // A live route stores no model catalog: the endpoint's listing is the
  // catalog, fetched once the credential can probe it and re-fetched on the
  // interval, so shipped configuration names endpoints and keys alone.
  let refreshingLive = false
  const refreshLiveRoutes = async (): Promise<void> => {
    if (refreshingLive) return
    refreshingLive = true
    try {
      let changed = false
      await Promise.all([...profiles().entries()].map(async ([route, profile]) => {
        if (profile.live !== true) return
        try {
          const discovered = await discoverModels({
            provider: route,
            ...profile.baseURL === undefined ? {} : { baseURL: profile.baseURL },
            ...profile.api === undefined ? {} : { api: profile.api },
          }, () => ({
            headers: profile.headers,
            resolveApiKey: () => resolveApiKey(route, profile),
          }))
          const efforts = profile.defaultReasoningEfforts
          const feed: readonly PiAiModelProfile[] = discovered.map(model => ({
            id: model.id,
            ...model.name === model.id ? {} : { name: model.name },
            ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
            ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
            ...efforts === undefined ? {} : { reasoningEfforts: efforts },
          }))
          if (!deepEqualJson(liveModels.get(route), feed)) {
            liveModels.set(route, feed)
            changed = true
          }
        } catch (error) {
          ctx.logger.warn(
            `llm-pi-ai: live catalog refresh for route "${route}" failed:`
            + ` ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }))
      if (changed) {
        liveVersion += 1
        // The same atomic swap a settings change runs: routes whose feed
        // arrived register (or re-register) with their fetched catalog.
        ensureRegistrationFacts()
        ensureDirectory()
      }
    } finally {
      refreshingLive = false
    }
  }
  void refreshLiveRoutes()
  const liveRefreshTimer = setInterval(() => { void refreshLiveRoutes() }, LIVE_REFRESH_INTERVAL_MS)
  liveRefreshTimer.unref?.()

  ctx.inject(['settings'], (settingsCtx) => {
    let registering = true
    settingsCtx.settings.installSection(ctx, NS, Config, config, {
      validate: (value) => {
        // Stored catalog drift must not prevent registration of the repair UI.
        if (registering) {
          resolveProfiles(value.providers, 'deferred')
        } else {
          assertServiceable(value, current())
        }
      },
      setSource: (source) => {
        current = source
      },
      onChange: () => {
        // Named here rather than left to the settings watcher: `assertServiceable`
        // cannot see the llm registry, so a profile claiming a route another
        // adapter family owns is stored successfully and only fails at this swap.
        // Without its own diagnostic that refusal reaches the operator as a
        // generic "settings: watcher failed", naming neither the route nor why it
        // is not serving. The previous routes keep serving either way.
        try {
          ensureRegistrationFacts()
        } catch (error) {
          ctx.logger.error('llm-pi-ai: keeping the previously registered routes after a refused update')
          ctx.logger.error(error)
        }
        // The directory follows the profiles the registry accepted, so a route
        // that failed to register is not advertised as configurable. A refused
        // directory swap is contained here for the same reason the registry's
        // is: the previous entries keep serving, and `directoryFacts` stays put
        // so returning to a working configuration re-applies.
        try {
          ensureDirectory()
        } catch (error) {
          ctx.logger.error('llm-pi-ai: keeping the previous configurable-provider directory after a refused update')
          ctx.logger.error(error)
        }
        // A settings change may add a live route or supply its credential;
        // re-interrogate rather than waiting out the refresh interval.
        void refreshLiveRoutes()
      },
    })
    registering = false
  })
}
