// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ModelDirectory } from '../src/client/directory.ts'
import { zh } from '../src/client/provider/locales.ts'
import { ProviderWindowStore } from '../src/client/provider/store.ts'
import { ProviderWindow } from '../src/client/provider/ProviderWindow.tsx'
import type { Context as ClientContext } from '@deepseek-ai/cordis'

const t = (key: keyof typeof zh, params?: Record<string, string>): string => {
  const template = zh[key]
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
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
  }],
}

function directoryWith(current: { provider: string; model: string; temperature?: number } | undefined): ModelDirectory {
  return {
    store: createSnapshotStore({ current }),
    select: vi.fn(async () => undefined),
  } as unknown as ModelDirectory
}

function buildWindow(directoryCurrent: { provider: string; model: string } | undefined) {
  const directory = directoryWith(directoryCurrent)
  const ctx = {
    remote: {
      llm: {
        listProviders: async () => ({ ok: true, value: [{ id: 'digitalocean', name: 'DigitalOcean' }] }),
        listConfigurableProviders: async () => ({
          ok: true,
          value: [{ provider: 'digitalocean', displayName: 'DigitalOcean', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'digitalocean'] }],
        }),
        discoverModels: async () => ({ ok: true, value: [{ id: 'brand-new-model' }] }),
      },
      credentials: {
        describe: async (refs: string[]) => ({
          ok: true,
          value: Object.fromEntries(refs.map(ref => [ref, { configured: true, writable: true }])),
        }),
        set: async () => ({ ok: true, value: undefined }),
      },
      settings: {
        mutate: async (_ns: string, ops: { op: string; path: string[]; value?: unknown }[]) => {
          for (const operation of ops) {
            if (operation.op === 'set') setAt(value, ['providers', 'digitalocean', ...operation.path.slice(2)], operation.value)
          }
          revision += 1
          return { ok: true, value: { ns: 'llm-pi-ai', value, schema, revision } }
        },
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
  type SettingsNode = { [key: string]: unknown }
  const value: SettingsNode = { providers: { digitalocean: { ...PROFILE } } }
  const setAt = (root: SettingsNode, path: readonly string[], val: unknown): void => {
    let node = root
    for (const key of path.slice(0, -1)) {
      const next = node[key]
      const child: SettingsNode = typeof next === 'object' && next !== null ? next as SettingsNode : {}
      node[key] = child
      node = child
    }
    const last = path.at(-1)
    if (last !== undefined) node[last] = val
  }
  const at = (root: unknown, path: readonly string[]): unknown => path.reduce<unknown>(
    (node, key) => typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[key] : undefined,
    root,
  )
  const schema = {
    providers: {
      '\u0000probe': {
        api: { type: 'union', list: [{ value: 'openai-completions' }, { value: 'openai-responses' }] },
      },
    },
  }
  let revision = 1
  const view = { writable: true, namespaces: [{ ns: 'llm-pi-ai', value, schema, revision }] }
  const controller = new ProviderWindowStore(
    ctx,
    {
      ensure: async () => undefined,
      getSnapshot: () => ({ status: 'ready', view, error: null }),
    } as never,
    { rehydrate: (root: unknown) => root, nodeAtPath: at, getPath: at },
    () => ({ sessionId: directoryCurrent === undefined ? undefined : 's1', directory }),
  )
  return { controller, directory }
}

afterEach(cleanup)

describe('provider window', () => {
  it('renders the route table with the session dot and static rates', async () => {
    const { controller } = buildWindow({ provider: 'digitalocean', model: 'deepseek-v4-flash-0731' })
    render(<ProviderWindow controller={controller} hooks={{ provider: controller.store }} t={t} onClose={() => undefined} />)
    await screen.findByText('deepseek-v4-flash-0731')
    expect(screen.getByText('0.14')).toBeTruthy()
    expect(screen.getByText('0.028')).toBeTruthy()
    expect(screen.queryByText('0.99')).toBeNull()
    cleanup()
  })

  it('opens the provider menu and commits a route fact write', async () => {
    const { controller } = buildWindow(undefined)
    render(<ProviderWindow controller={controller} hooks={{ provider: controller.store }} t={t} onClose={() => undefined} />)
    fireEvent.click(await screen.findByRole('button', { name: zh['provider.aria'] }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /digitalocean/ }))
    fireEvent.click(screen.getByRole('button', { name: 'openai-completions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'openai-completions' }))
    fireEvent.click(await screen.findByRole('button', { name: /拉取模型规格/ }))
    await screen.findByText('brand-new-model')
    cleanup()
  })
})
