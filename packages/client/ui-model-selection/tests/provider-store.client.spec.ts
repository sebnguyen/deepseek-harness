import { describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ModelDirectory } from '../src/client/directory.ts'
import { effortsOf, modelRowsOf, ProviderWindowStore } from '../src/client/provider/store.ts'
import type { ProviderWindowStore as Store } from '../src/client/provider/store.ts'

/** First stored row, asserted present. */
function state0(store: Store) {
  const row = store.store.getSnapshot().models[0]
  if (row === undefined) throw new Error('expected one model row')
  return row
}

/** Settings mirror returning one namespace view; writes recorded. */
interface MutateReply {
  ok: boolean
  value?: { revision: number }
  error?: { code?: string; message: string }
}

function fakeContext(handlers: {
  mutate?: (ns: string, ops: unknown[], revision: number | undefined) => Promise<MutateReply>
  discover?: () => Promise<unknown>
  configurable?: readonly { provider: string; displayName: string; settingsNs: string; settingsPath: string[] }[]
  credConfigured?: boolean
} = {}) {
  const written: { ns: string; ops: unknown[] }[] = []
  const keys: { ref: string; value: string }[] = []
  const ctx = {
    remote: {
      llm: {
        listProviders: async () => ({ ok: true, value: [{ id: 'digitalocean', name: 'DigitalOcean' }] }),
        listConfigurableProviders: handlers.configurable === undefined
          ? async () => ({
            ok: true,
            value: [{ provider: 'digitalocean', displayName: 'DigitalOcean', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'digitalocean'] }],
          })
          : async () => ({ ok: true, value: handlers.configurable }),
        discoverModels: handlers.discover ?? (async () => ({
          ok: true,
          value: [
            { id: 'deepseek-v4-flash-0731', contextWindow: 999_999, maxTokens: 999 },
            { id: 'deepseek-r2-flash' },
          ],
        })),
      },
      credentials: {
        describe: async (refs: string[]) => ({
          ok: true,
          value: Object.fromEntries(refs.map(ref => [ref, { configured: handlers.credConfigured ?? true, writable: true }])),
        }),
        set: async (ref: string, value: string) => {
          keys.push({ ref, value })
          return { ok: true, value: undefined }
        },
      },
      settings: {
        mutate: handlers.mutate ?? (async (ns: string, ops: unknown[]) => {
          written.push({ ns, ops })
          return { ok: true, value: { revision: 7 } }
        }),
      },
      sessionStats: {
        describePricing: async () => ({
          ok: true,
          value: {
            inputPerMillionUsd: 0.14,
            outputPerMillionUsd: 0.28,
            cacheReadPerMillionUsd: 0.028,
            cacheWritePerMillionUsd: 0,
            models: { 'deepseek-v4-flash-0731': { inputPerMillionUsd: 0.14, outputPerMillionUsd: 0.28, cacheReadPerMillionUsd: 0.028, cacheWritePerMillionUsd: 0 } },
          },
        }),
      },
    },
  } as unknown as ClientContext
  return { ctx, written, keys }
}

const PROFILE = {
  api: 'openai-completions',
  baseURL: 'https://inference.do-ai.run/v1',
  apiKeyEnv: 'DO_INFERENCE_API_KEY',
  maxContextWindow: 391_168,
  models: [{
    id: 'deepseek-v4-flash-0731',
    contextWindow: 391_168,
    maxTokens: 32_768,
    reasoningEfforts: { low: 'low', high: 'high' },
    tunes: { temperature: 0.2, reasoningEffort: 'high' },
  }],
}

const PROFILE_ROOT = { providers: { digitalocean: PROFILE } }

function describeFaceFor(value: unknown, user?: unknown) {
  const namespace = {
    ns: 'llm-pi-ai',
    value,
    schema: {},
    revision: 5,
    ...user === undefined ? {} : { user },
  }
  return {
    ensure: async () => ({ ok: true, view: { writable: true, namespaces: [namespace], revision: 5 } }),
    getSnapshot: () => ({ view: { writable: true, namespaces: [namespace], revision: 5 }, error: undefined }),
  } as never
}

function schemaFor() {
  const at = (root: unknown, path: readonly string[]): unknown => path.reduce<unknown>(
    (node, key) => typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[key] : undefined,
    root,
  )
  return {
    rehydrate: (root: unknown) => root,
    nodeAtPath: at,
    getPath: at,
  }
}

function makeStore(
  directoryCurrent: { provider: string; model: string; temperature?: number; reasoningEffort?: string } | undefined,
  configurable?: readonly { provider: string; displayName: string; settingsNs: string; settingsPath: string[] }[],
) {
  const directory = {
    store: createSnapshotStore({ current: directoryCurrent }),
    select: vi.fn(async () => undefined),
  } as unknown as ModelDirectory & { select: ReturnType<typeof vi.fn> }
  const { ctx, written, keys } = fakeContext(configurable === undefined ? {} : { configurable })
  const store = new ProviderWindowStore(ctx, describeFaceFor(PROFILE_ROOT), schemaFor(),
    () => ({ sessionId: undefined, directory }))
  return { store, written, keys, directory }
}

describe('provider window store', () => {
  it('leads the route list with the flagship provider and defaults the window to it', async () => {
    const configured = [
      { provider: 'zeta-route', displayName: 'Zeta', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'zeta-route'] },
      { provider: 'digitalocean', displayName: 'DigitalOcean', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'digitalocean'] },
    ]
    const { store } = makeStore(undefined, configured)
    await store.load()
    const state = store.store.getSnapshot()
    expect(state.routes.map(row => row.provider)).toEqual(['digitalocean', 'zeta-route'])
    expect(state.current).toBe('digitalocean')
  })

  it('reads rows off the stored model entry and the credential state', async () => {
    const { store } = makeStore({ provider: 'digitalocean', model: 'deepseek-v4-flash-0731', temperature: 0.2 })
    await store.load()
    const state = store.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.current).toBe('digitalocean')
    const row = state0(store)
    expect(row.efforts).toEqual(['low', 'high'])
    expect(row.tunes?.temperature).toBe(0.2)
    expect(state.profile?.api).toBe('openai-completions')
    expect(state.pricing?.models?.['deepseek-v4-flash-0731']?.inputPerMillionUsd).toBe(0.14)
    expect(state.session?.model).toBe('deepseek-v4-flash-0731')
    expect(Object.keys(state.credentials)).toContain('DO_INFERENCE_API_KEY')
  })

  it('commits a passing row as settings path ops and reports refusals as failures', async () => {
    const { store, written } = makeStore(undefined)
    await store.load()
    const row = state0(store)
    await store.commitModel(row, { temp: '0.3', ctx: '382K', max: '' }, 'high', {})
    expect(written).toHaveLength(1)
    expect(written.at(-1)?.ns).toBe('llm-pi-ai')

    await store.commitModel(row, { temp: '2', ctx: '', max: '' }, undefined, { temp: 'x' })
    expect(written).toHaveLength(1)
  })

  it('surfaces a conflict refusal without writing', async () => {
    const { ctx } = fakeContext({
      mutate: async () => ({ ok: false, error: { code: 'settings/conflict', message: 'stale' } }),
    })
    const store = new ProviderWindowStore(ctx, describeFaceFor(PROFILE_ROOT), schemaFor(),
      () => ({ sessionId: undefined, directory: undefined }))
    await store.load()
    await store.commitModel(state0(store), { temp: '0.3', ctx: '', max: '' }, undefined, {})
    expect(store.store.getSnapshot().failure).toBe('conflict')
    await store.load()
    expect(store.store.getSnapshot().failure).toBeNull()
  })

  it('adopts an interrogation additively, pinning the full resolved list plus the new rows', async () => {
    const { store, written } = makeStore(undefined)
    await store.load()
    await store.fetchSpecs()
    const adopt = written.at(-1)
    expect(adopt?.ops).toEqual([{
      op: 'set',
      path: ['providers', 'digitalocean', 'models'],
      value: [
        PROFILE.models[0],
        { id: 'deepseek-r2-flash', contextWindow: 262_144, maxTokens: 32_768 },
      ],
    }])
  })

  it('stamps the route effort menu onto adopted entries', async () => {
    const { ctx, written } = fakeContext()
    const withEfforts = { providers: { digitalocean: { ...PROFILE, defaultReasoningEfforts: { low: 'low', high: 'high' } } } }
    const store = new ProviderWindowStore(ctx, describeFaceFor(withEfforts), schemaFor(),
      () => ({ sessionId: undefined, directory: undefined }))
    await store.load()
    await store.fetchSpecs()
    const adopt = written.at(-1)
    const ops = adopt?.ops as { op: string; value: Record<string, unknown>[] }[] | undefined
    expect(ops?.[0]?.value.at(-1)).toEqual({
      id: 'deepseek-r2-flash',
      contextWindow: 262_144,
      maxTokens: 32_768,
      reasoningEfforts: { low: 'low', high: 'high' },
    })
  })

  it('writes nothing when the interrogation names only rows already served', async () => {
    const { ctx, written } = fakeContext({
      discover: async () => ({ ok: true, value: [{ id: 'deepseek-v4-flash-0731' }] }),
    })
    const store = new ProviderWindowStore(ctx, describeFaceFor(PROFILE_ROOT), schemaFor(),
      () => ({ sessionId: undefined, directory: undefined }))
    await store.load()
    await store.fetchSpecs()
    expect(written).toHaveLength(0)
  })

  it('pins a catalog-only row by committing the whole models array', async () => {
    const { store, written } = makeStore(undefined)
    await store.load()
    await store.commitModel(state0(store), { temp: '0.3', ctx: '', max: '' }, 'high', {})
    expect(written.at(-1)?.ops).toEqual([{
      op: 'set',
      path: ['providers', 'digitalocean', 'models'],
      value: [{
        id: 'deepseek-v4-flash-0731',
        reasoningEfforts: { low: 'low', high: 'high' },
        tunes: { temperature: 0.3, reasoningEffort: 'high' },
      }],
    }])
  })

  it('addresses stored rows by their user-layer index when a user section exists', async () => {
    const { ctx, written } = fakeContext()
    const store = new ProviderWindowStore(ctx, describeFaceFor(PROFILE_ROOT, PROFILE_ROOT), schemaFor(),
      () => ({ sessionId: undefined, directory: undefined }))
    await store.load()
    await store.commitModel(state0(store), { temp: '0.4', ctx: '', max: '' }, undefined, {})
    const ops = written.at(-1)?.ops as { op: string; path: string[] }[]
    expect(ops.map(op => op.path.join('/'))).toContain('providers/digitalocean/models/0/tunes/temperature')
    expect(ops.some(op => op.path.join('/') === 'providers/digitalocean/models/0/tunes/reasoningEffort' && op.op === 'unset')).toBe(true)
  })

  it('reads the user layer through a root-pathed route', async () => {
    const { ctx, written } = fakeContext({
      configurable: [{ provider: 'digitalocean', displayName: 'DigitalOcean', settingsNs: 'llm-pi-ai', settingsPath: [] }],
    })
    const store = new ProviderWindowStore(ctx, describeFaceFor(PROFILE, PROFILE), schemaFor(),
      () => ({ sessionId: undefined, directory: undefined }))
    await store.load()
    expect(store.store.getSnapshot().current).toBe('digitalocean')
    await store.commitModel(state0(store), { temp: '', ctx: '512K', max: '' }, undefined, {})
    const ops = written.at(-1)?.ops as { op: string; path: string[] }[]
    expect(ops.map(op => op.path.join('/'))).toContain('models/0/contextWindow')
  })

  it('stores a typed key and commits route facts', async () => {
    const { store, written, keys } = makeStore(undefined)
    await store.load()
    await store.saveKey('dop_v1_secret')
    await store.commitFormat('openai-responses')
    await store.commitBaseURL('https://gw.example/v1')
    expect(keys).toEqual([{ ref: 'DO_INFERENCE_API_KEY', value: 'dop_v1_secret' }])
    expect(written.at(-2)?.ops).toEqual([{ op: 'set', path: ['providers', 'digitalocean', 'api'], value: 'openai-responses' }])
    expect(written.at(-1)?.ops).toEqual([{ op: 'set', path: ['providers', 'digitalocean', 'baseURL'], value: 'https://gw.example/v1' }])
  })

  it('writes the derived reference onto the profile when a reference-free key saves', async () => {
    const { ctx, written, keys } = fakeContext()
    const refless = { providers: { digitalocean: { api: PROFILE.api, baseURL: PROFILE.baseURL, models: PROFILE.models } } }
    const store = new ProviderWindowStore(ctx, describeFaceFor(refless), schemaFor(),
      () => ({ sessionId: undefined, directory: undefined }))
    await store.load()
    await store.saveKey('dop_v1_secret')
    expect(written.at(-1)?.ops).toEqual([{ op: 'set', path: ['providers', 'digitalocean', 'apiKeyEnv'], value: 'DIGITALOCEAN_API_KEY' }])
    expect(keys).toEqual([{ ref: 'DIGITALOCEAN_API_KEY', value: 'dop_v1_secret' }])
  })

  it('answers the fresh-start probe false when the route key is configured', async () => {
    const { store } = makeStore(undefined)
    expect(await store.startupCheck()).toBe(false)
    expect(store.store.getSnapshot().current).toBe('digitalocean')
  })

  it('answers the fresh-start probe true when the route key is unconfigured, once', async () => {
    const { ctx } = fakeContext({ credConfigured: false })
    const store = new ProviderWindowStore(ctx, describeFaceFor(PROFILE_ROOT), schemaFor(),
      () => ({ sessionId: undefined, directory: undefined }))
    expect(await store.startupCheck()).toBe(true)
    expect(await store.startupCheck()).toBe(true)
  })

  it('commits the dotted row through the shared selection projection', async () => {
    const { store, directory } = makeStore({ provider: 'digitalocean', model: 'deepseek-v4-flash-0731' })
    await store.load()
    await store.selectSession({ temperature: 0.4 })
    expect(directory.select).toHaveBeenCalledWith({
      provider: 'digitalocean',
      model: 'deepseek-v4-flash-0731',
      temperature: 0.4,
    })
  })

  it('reads offered levels and rows off stored entries', () => {
    expect(effortsOf({ reasoningEfforts: { low: 'low' } })).toEqual(['low'])
    expect(effortsOf({ reasoningEfforts: false })).toEqual([])
    expect(effortsOf(undefined)).toEqual([])
    expect(modelRowsOf(undefined, ['providers', 'x'])).toEqual([])
    expect(modelRowsOf({ models: [{ id: '' }] }, ['providers', 'x'])).toEqual([])
  })

  it('reports load failures from the provider directory and settings mirror', async () => {
    const ctx = {
      remote: {
        llm: {
          listProviders: async () => ({ ok: false, error: new RemoteError('gateway/internal', 'down', {}) }),
          listConfigurableProviders: async () => ({ ok: true, value: [] }),
        },
        sessionStats: { describePricing: async () => ({ ok: true, value: undefined }) },
      },
    } as unknown as ClientContext
    const store = new ProviderWindowStore(ctx, describeFaceFor({ providers: {} }), schemaFor(),
      () => ({ sessionId: undefined, directory: undefined }))
    await store.load()
    expect(store.store.getSnapshot().status).toBe('error')
  })
})
