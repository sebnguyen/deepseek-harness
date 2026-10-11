/**
 * model-provider window store: the joined provider directory, the selected
 * route's profile read from its settings namespace through the shared
 * describe mirror, and every commit as the Models page and the composer
 * already issue them — path operations through `remote.settings.mutate`
 * fenced with the revision the namespace view carried when read,
 * credential writes through `remote.credentials`, endpoint interrogation
 * through `remote.llm.discoverModels`, and the view session's dotted row
 * through the shared selection projection. Nothing here owns storage.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {
  CostPricing, CredentialInfo, LlmConfigurableProvider, LlmModelDiscoveryRequest,
  LlmProviderInfo, SettingsNamespaceView, SettingsPathOpView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsDescribeFace } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ModelDirectory } from '../directory.ts'
import { adoptionEntries, entryWith, rowOps } from './rules.ts'
import type { ProviderDraftErrors } from './rules.ts'

/** One provider row the window offers, from the configurable directory. */
export interface ProviderRouteRow {
  readonly provider: string
  readonly displayName: string
  readonly settingsNs: string
  readonly settingsPath: readonly string[]
  readonly active: boolean
}

/** One model row read out of the selected route's profile. */
export interface ProviderModelRow {
  readonly id: string
  readonly index: number
  /** Settings path of this model entry; capacity and tune ops anchor here. */
  readonly base: readonly string[]
  contextWindow?: number
  maxTokens?: number
  tunes?: { temperature?: number; reasoningEffort?: string }
  readonly efforts: readonly string[]
  /** The resolved entry the row was built from; full-array commits pin it. */
  readonly raw: Record<string, unknown>
}

/** Window snapshot. */
export interface ProviderWindowState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  /** One write's failure text; cleared on the next commit or full reload. */
  failure: string | null
  writable: boolean
  routes: readonly ProviderRouteRow[]
  current: string | undefined
  /** The selected route's profile header, once read. */
  profile: {
    api?: string
    baseURL?: string
    apiKeyEnv?: string
    maxContextWindow?: number
    defaultContextWindow: number
    defaultMaxTokens: number
    /** Route-level effort menu stamped onto adopted model entries. */
    defaultReasoningEfforts?: Readonly<Record<string, string | null>>
  } | undefined
  models: readonly ProviderModelRow[]
  /** Protocol choices from the owning namespace's schema. */
  protocols: readonly string[]
  /** Credential states by reference, for the key chip. */
  credentials: Readonly<Record<string, CredentialInfo>>
  /** Deployment rate table; absent means the deployment priced nothing. */
  pricing: CostPricing | undefined
  /** The view session's durable selection, when its route is the selected one. */
  session: { model: string; temperature?: number; reasoningEffort?: string } | undefined
  /** Whether the view session's directory can commit the dotted row. */
  sessionWritable: boolean
  /** The draft's write fence: the selected namespace view's revision. */
  revision: number | undefined
}

/** Model entries read from a stored profile, whichever home they ride in. */
interface StoredModelEntry {
  id?: unknown
  contextWindow?: unknown
  maxTokens?: unknown
  reasoningEfforts?: unknown
  tunes?: unknown
}

/**
 * Resolve the offered effort levels of one stored entry: the keys its
 * harness reasoningEfforts map declares, in declaration order.
 * @param entry - the stored model entry or override.
 * @returns offered levels; empty when the entry declares none.
 */
export function effortsOf(entry: StoredModelEntry | undefined): readonly string[] {
  const efforts = entry?.reasoningEfforts
  if (typeof efforts !== 'object' || efforts === null) return []
  return Object.keys(efforts)
}

/**
 * The model rows one route profile exposes through its hand-declared
 * `models` list (the Models page is the catalog-browsing authority; this
 * window refines what the profile already declares).
 * @param profile - the stored profile object at the route's settings path.
 * @param settingsPath - route path; rows anchor under `models`.
 * @returns rows in stored order.
 */
export function modelRowsOf(
  profile: { models?: readonly StoredModelEntry[] } | undefined,
  settingsPath: readonly string[],
): ProviderModelRow[] {
  const models = profile?.models
  if (models === undefined) return []
  const rows: ProviderModelRow[] = []
  for (let index = 0; index < models.length; index += 1) {
    const entry = models[index]
    if (entry === undefined) continue
    if (typeof entry.id !== 'string' || entry.id.length === 0) continue
    const row: ProviderModelRow = {
      id: entry.id,
      index,
      base: [...settingsPath, 'models', String(index)],
      efforts: effortsOf(entry),
      raw: { ...entry },
    }
    if (typeof entry.contextWindow === 'number') row.contextWindow = entry.contextWindow
    if (typeof entry.maxTokens === 'number') row.maxTokens = entry.maxTokens
    if (typeof entry.tunes === 'object' && entry.tunes !== null) {
      const stored = entry.tunes as { temperature?: unknown; reasoningEffort?: unknown }
      const tunes: NonNullable<ProviderModelRow['tunes']> = {}
      if (typeof stored.temperature === 'number') tunes.temperature = stored.temperature
      if (typeof stored.reasoningEffort === 'string') tunes.reasoningEffort = stored.reasoningEffort
      row.tunes = tunes
    }
    rows.push(row)
  }
  return rows
}

/**
 * The conventional credential reference the Models page stores keys under.
 * @param provider - the route id the key authenticates.
 * @returns the `<ROUTE>_API_KEY` reference the credentials seam stores.
 */
export function derivedRefOf(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/**
 * The flagship route the window leads its lists with and defaults to:
 * the standard agent preset seeds sessions from this provider, so the
 * window's first open shows the route a fresh session already rides.
 */
const LEAD_PROVIDER = 'digitalocean'

/** Initial window snapshot. */
const INITIAL: ProviderWindowState = {
  status: 'idle',
  error: null,
  failure: null,
  writable: false,
  routes: [],
  current: undefined,
  profile: undefined,
  models: [],
  protocols: [],
  credentials: {},
  pricing: undefined,
  session: undefined,
  sessionWritable: false,
  revision: undefined,
}

/** The window store (one per settings surface, like the Models page's). */
export class ProviderWindowStore {
  /** The snapshot the window renders from. */
  readonly store: SnapshotStore<ProviderWindowState> = createSnapshotStore<ProviderWindowState>(INITIAL)

  private generation = 0

  private namespaces = new Map<string, SettingsNamespaceView>()

  /**
   * @param ctx - client context carrying the Remote namespaces.
   * @param describeFace - the shared settings mirror's describe face.
   * @param schema - settings-owned schema callbacks for reads.
   * @param sessionFace - view-session facts (id and live directory).
   */
  constructor(
    private readonly ctx: ClientContext,
    private readonly describeFace: SettingsDescribeFace,
    private readonly schema: {
      rehydrate(serialized: unknown): unknown
      nodeAtPath(root: unknown, path: readonly string[]): unknown
      getPath(value: unknown, path: readonly string[]): unknown
    },
    private readonly sessionFace: () => { sessionId: string | undefined; directory: ModelDirectory | undefined },
  ) {}

  /** Refresh the whole window snapshot. */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'loading'; s.error = null; s.failure = null })
    const [registered, declared, pricing] = await Promise.all([
      this.ctx.remote.llm.listProviders(),
      this.ctx.remote.llm.listConfigurableProviders(),
      // The rate table rides the sessionStats remote when the host composes
      // one; a host without it (or mid-composition) simply prices nothing.
      (this.ctx.remote as {
        sessionStats?: { describePricing(): Promise<{ ok: boolean; value?: CostPricing }> }
      }).sessionStats?.describePricing().then(
        response => response === undefined || !response.ok ? undefined : response.value,
        () => undefined,
      ),
    ])
    if (generation !== this.generation) return
    if (!registered.ok) {
      this.store.update((s) => { s.status = 'error'; s.error = registered.error.message })
      return
    }
    if (!declared.ok) {
      this.store.update((s) => { s.status = 'error'; s.error = declared.error.message })
      return
    }
    await this.describeFace.ensure()
    if (generation !== this.generation) return
    const view = this.describeFace.getSnapshot().view
    if (view === undefined) {
      this.store.update((s) => { s.status = 'error'; s.error = 'settings are unavailable in this browser' })
      return
    }
    const active = new Set(registered.value.map((provider: LlmProviderInfo) => provider.id))
    // Stable sort: the lead route first, declared order otherwise — the
    // stored providers dict keys arrive in write order, which a surface
    // must not inherit as a display order.
    const routes: ProviderRouteRow[] = declared.value.map((entry: LlmConfigurableProvider) => ({
      provider: entry.provider,
      displayName: entry.displayName,
      settingsNs: entry.settingsNs,
      settingsPath: [...entry.settingsPath],
      active: active.has(entry.provider),
    })).sort((a, b) => Number(b.provider === LEAD_PROVIDER) - Number(a.provider === LEAD_PROVIDER))
    this.namespaces = new Map<string, SettingsNamespaceView>(
      view.namespaces.map((nsView: SettingsNamespaceView) => [nsView.ns, nsView]),
    )
    const current = this.store.getSnapshot().current ?? routes[0]?.provider
    this.store.update((s) => {
      s.status = 'ready'
      s.error = null
      s.writable = view.writable
      s.routes = routes
      s.pricing = pricing
    })
    await this.loadRoute(generation, current)
  }

  /**
   * Read the selected route's profile, credentials, and session facts.
   * @param generation - the load pass this read belongs to; stale passes drop.
   * @param provider - the route to read, or undefined to clear the table.
   */
  async loadRoute(generation: number, provider: string | undefined): Promise<void> {
    if (generation !== this.generation) return
    const route = this.store.getSnapshot().routes.find(row => row.provider === provider)
    if (route === undefined) {
      this.store.update((s) => {
        s.current = undefined
        s.profile = undefined
        s.models = []
        s.session = undefined
        s.revision = undefined
      })
      return
    }
    const namespace = this.namespaces.get(route.settingsNs)
    const profile = namespace === undefined
      ? undefined
      : route.settingsPath.length === 0
        ? namespace.value as object
        : this.schema.getPath(namespace.value, route.settingsPath) as object | undefined
    const read = (path: readonly string[]): unknown =>
      profile === undefined ? undefined : this.schema.getPath(profile, path)
    const apiKeyEnv = read(['apiKeyEnv'])
    const refs = new Set<string>([derivedRefOf(route.provider)])
    if (typeof apiKeyEnv === 'string') refs.add(apiKeyEnv)
    const described = await this.ctx.remote.credentials.describe([...refs])
    if (generation !== this.generation) return
    const { directory } = this.sessionFace()
    const selection = directory?.store.getSnapshot().current
      ?? undefined
    this.store.update((s) => {
      s.current = route.provider
      s.profile = profile === undefined ? undefined : {
        ...(() => {
          const api = read(['api'])
          const baseURL = read(['baseURL'])
          const maxContextWindow = read(['maxContextWindow'])
          const defaultContextWindow = read(['defaultContextWindow'])
          const defaultMaxTokens = read(['defaultMaxTokens'])
          const defaultReasoningEfforts = read(['defaultReasoningEfforts'])
          return {
            ...typeof api === 'string' ? { api } : {},
            ...typeof baseURL === 'string' ? { baseURL } : {},
            ...typeof apiKeyEnv === 'string' ? { apiKeyEnv } : {},
            ...typeof maxContextWindow === 'number' ? { maxContextWindow } : {},
            defaultContextWindow: typeof defaultContextWindow === 'number' ? defaultContextWindow : 262_144,
            defaultMaxTokens: typeof defaultMaxTokens === 'number' ? defaultMaxTokens : 32_768,
            ...typeof defaultReasoningEfforts === 'object' && defaultReasoningEfforts !== null
              ? { defaultReasoningEfforts: defaultReasoningEfforts as Record<string, string | null> }
              : {},
          }
        })(),
      }
      s.models = modelRowsOf(profile, route.settingsPath)
      s.protocols = this.protocolChoices(route.settingsNs)
      s.credentials = described.ok ? described.value : {}
      s.session = selection !== undefined && selection.provider === route.provider
        ? {
          model: selection.model,
          ...selection.temperature === undefined ? {} : { temperature: selection.temperature },
          ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort },
        }
        : undefined
      s.sessionWritable = directory !== undefined
      s.revision = namespace?.revision
    })
  }

  private protocolChoices(ns: string): string[] {
    const namespace = this.namespaces.get(ns)
    if (namespace === undefined) return []
    const node = this.schema.nodeAtPath(
      this.schema.rehydrate(namespace.schema),
      ['providers', '\u0000probe', 'api'],
    )
    const list = node as { type?: string; list?: readonly { value?: unknown }[] } | undefined
    if (list?.type !== 'union' || list.list === undefined) return []
    return list.list.map(entry => entry.value).filter((value): value is string => typeof value === 'string')
  }

  /**
   * Switch the window to another route.
   * @param provider - the chosen route's id.
   */
  async select(provider: string): Promise<void> {
    await this.loadRoute(this.generation, provider)
  }

  /** Commit one write and refresh the view the write returned. */
  private async mutate(ns: string, ops: SettingsPathOpView[]): Promise<void> {
    const revision = this.store.getSnapshot().revision
    const response = await this.ctx.remote.settings.mutate(ns, ops, revision)
    if (!response.ok) {
      this.store.update((s) => {
        s.failure = response.error.code === 'settings/conflict' ? 'conflict' : response.error.message
      })
      return
    }
    this.namespaces.set(ns, response.value)
    this.store.update((s) => { s.failure = null; s.revision = response.value.revision })
    await this.loadRoute(this.generation, this.store.getSnapshot().current)
  }

  /**
   * Commit a row's passing drafts; the caller judged them first.
   * @param row - the stored row the drafts belong to.
   * @param drafts - the three capacity/temperature texts as typed.
   * @param effort - the chosen reasoning effort, undefined to unset.
   * @param errors - the judged diagnostics; any entry blocks the write.
   */
  async commitModel(
    row: ProviderModelRow,
    drafts: { temp: string; ctx: string; max: string },
    effort: string | undefined,
    errors: ProviderDraftErrors,
  ): Promise<void> {
    if (Object.keys(errors).length > 0) return
    const state = this.store.getSnapshot()
    const route = state.routes.find(candidate => candidate.provider === state.current)
    if (route === undefined) return
    const stored = this.userModelsOf(route).findIndex(entry => entry.id === row.id)
    if (stored >= 0) {
      // The entry exists in the user layer: address it by its index there.
      await this.mutate(route.settingsNs, rowOps(
        [...route.settingsPath, 'models', String(stored)],
        { ...drafts, effort },
      ))
      return
    }
    // A catalog-derived row: any user-layer `models` list replaces the
    // catalog, so the commit pins the full resolved list with this row's
    // entry adjusted.
    await this.mutate(route.settingsNs, [{
      op: 'set',
      path: [...route.settingsPath, 'models'],
      value: state.models.map(candidate => candidate.id === row.id
        ? entryWith(candidate.raw, drafts, effort)
        : candidate.raw) as Extract<SettingsPathOpView, { op: 'set' }>['value'],
    }])
  }

  /**
   * Commit the dotted row's live selection through the shared projection.
   * @param patch - the knobs the row's cells changed; absent knobs keep the selection's values.
   */
  async selectSession(patch: { temperature?: number | undefined; reasoningEffort?: string | undefined }): Promise<void> {
    const directory = this.sessionFace().directory
    const selection = directory?.store.getSnapshot().current ?? undefined
    if (directory === undefined || selection === undefined) return
    await directory.select({
      provider: selection.provider,
      model: selection.model,
      ...patch.reasoningEffort !== undefined
        ? { reasoningEffort: patch.reasoningEffort }
        : selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort },
      ...patch.temperature !== undefined
        ? { temperature: patch.temperature }
        : selection.temperature === undefined ? {} : { temperature: selection.temperature },
    })
  }

  /**
   * Commit the route's wire protocol.
   * @param api - the chosen protocol from the schema union.
   */
  async commitFormat(api: string): Promise<void> {
    const route = this.currentRoute()
    if (route === undefined) return
    await this.mutate(route.settingsNs, [{ op: 'set', path: [...route.settingsPath, 'api'], value: api }])
  }

  /**
   * Commit the route's endpoint.
   * @param baseURL - the endpoint the profile's `/models` and chat requests ride.
   */
  async commitBaseURL(baseURL: string): Promise<void> {
    const route = this.currentRoute()
    if (route === undefined) return
    await this.mutate(route.settingsNs, [{ op: 'set', path: [...route.settingsPath, 'baseURL'], value: baseURL }])
  }

  /**
   * Store the derived credential reference for the selected route.
   * @param value - the raw key literal to store.
   * @returns the refusal message, or undefined once stored.
   */
  async saveKey(value: string): Promise<string | undefined> {
    const route = this.currentRoute()
    if (route === undefined || value.trim().length === 0) return undefined
    const response = await this.ctx.remote.credentials.set(derivedRefOf(route.provider), value.trim())
    if (!response.ok) return response.error.message
    await this.loadRoute(this.generation, route.provider)
    return undefined
  }

  /** Interrogate the endpoint and adopt unknown ids additively. */
  async fetchSpecs(): Promise<void> {
    const state = this.store.getSnapshot()
    const route = this.currentRoute()
    const profile = state.profile
    if (route === undefined || profile === undefined) return
    const request: LlmModelDiscoveryRequest = {
      provider: route.provider,
      ...profile.baseURL === undefined ? {} : { baseURL: profile.baseURL },
      ...profile.api === undefined ? {} : { api: profile.api },
    }
    const response = await this.ctx.remote.llm.discoverModels(route.settingsNs, request)
    if (!response.ok) {
      this.store.update((s) => { s.failure = response.error.message })
      return
    }
    const existing = new Set(state.models.map(model => model.id))
    const additions = adoptionEntries(
      existing,
      response.value,
      { contextWindow: profile.defaultContextWindow, maxTokens: profile.defaultMaxTokens },
      profile.defaultReasoningEfforts,
    )
    if (additions.length === 0) return
    await this.mutate(route.settingsNs, [{
      op: 'set',
      path: [...route.settingsPath, 'models'],
      value: [...state.models.map(model => model.raw), ...additions] as Extract<SettingsPathOpView, { op: 'set' }>['value'],
    }])
  }

  /** The user layer's stored model entries for one route, as saved. */
  private userModelsOf(route: ProviderRouteRow): StoredModelEntry[] {
    const namespace = this.namespaces.get(route.settingsNs)
    if (namespace?.user === undefined) return []
    const section: unknown = route.settingsPath.length === 0
      ? namespace.user
      : this.schema.getPath(namespace.user, route.settingsPath)
    const models = typeof section === 'object' && section !== null
      ? (section as { models?: unknown }).models
      : undefined
    if (!Array.isArray(models)) return []
    return models.filter((entry): entry is StoredModelEntry => typeof entry === 'object' && entry !== null)
  }

  private currentRoute(): ProviderRouteRow | undefined {
    const state = this.store.getSnapshot()
    return state.routes.find(candidate => candidate.provider === state.current)
  }
}
