// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CordisRuntimeFiber, CordisRuntimeRealm, CordisRuntimeTree } from '@deepseek-ai/dsh-experimental-inspector/client'
import type { InspectorTreeSnapshot } from '../src/client/tree-source.ts'
import { CordisTreePanel, type CordisTreePanelProps } from '../src/client/CordisTreePanel.tsx'
import { en } from '../src/client/locales.ts'

const dictionary: Record<string, string> = en
const t: CordisTreePanelProps['t'] = (key, params = {}) => Object.entries(params).reduce(
  (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
  dictionary[key] ?? key,
)

function fiber(uid: number, overrides: Partial<CordisRuntimeFiber> = {}): CordisRuntimeFiber {
  return {
    kind: 'fiber',
    uid,
    pluginName: 'providerPlugin',
    entryName: 'provider-plugin',
    state: 'active',
    inject: [],
    store: [],
    provides: [],
    children: [{ kind: 'context', children: [] }],
    ...overrides,
  }
}

function realm(
  sourceId: string,
  kind: 'host' | 'client',
  root: CordisRuntimeRealm['root'],
): CordisRuntimeRealm {
  return {
    source: { sourceId: sourceId as never, kind, label: kind === 'host' ? 'Host runtime' : 'Browser runtime' },
    connection: { state: 'connected' },
    revision: 1,
    truncated: false,
    root,
  }
}

function renderTree(hostRoot: CordisRuntimeRealm['root'], clientRoot: CordisRuntimeRealm['root'] = { kind: 'context', children: [] }) {
  const tree: CordisRuntimeTree = {
    schemaVersion: 1,
    host: realm('host-links', 'host', hostRoot),
    clients: [realm('client-links', 'client', clientRoot)],
  }
  const snapshot: InspectorTreeSnapshot = { tree, read: true }
  const props = {
    useInspection: (selector: (value: InspectorTreeSnapshot) => InspectorTreeSnapshot) => selector(snapshot),
    onRefresh: vi.fn(),
    usePreview: (selector: (state: null) => null) => selector(null),
    onSelectService: vi.fn(),
    onClosePreview: vi.fn(),
    t,
  } as unknown as CordisTreePanelProps
  return render(<CordisTreePanel {...props} />)
}

function consumer(): CordisRuntimeFiber {
  return fiber(41, {
    entryName: 'consumer-plugin',
    inject: ['shell'],
    store: [{ name: 'shell', providerUid: 42 }],
  })
}

function nestedProvider(provider: CordisRuntimeFiber): CordisRuntimeRealm['root'] {
  return {
    kind: 'context',
    children: [{ kind: 'context', children: [{ kind: 'context', children: [provider] }] }],
  }
}

afterEach(cleanup)

describe('provider links', () => {
  it('focuses the exact realm UID, expands collapsed ancestors, and never leaks into the other realm', async () => {
    const hostProvider = fiber(42, { entryName: 'host-provider', provides: ['shell'] })
    const clientProvider = fiber(42, { entryName: 'client-provider', provides: ['shell'] })
    renderTree(
      { kind: 'context', children: [consumer(), ...nestedProvider(hostProvider).children] },
      { kind: 'context', children: [clientProvider] },
    )
    const details = screen.getByText('host-provider', { selector: 'strong' }).closest('details')!
    expect(details.open).toBe(true)
    details.open = false

    const consumerDetails = screen.getByText('consumer-plugin', { selector: 'strong' }).closest('details')!
    fireEvent.click(within(consumerDetails).getByRole('button', { name: 'Focus provider of shell, Fiber #42' }))
    const summary = screen.getByText('host-provider', { selector: 'strong' }).closest('summary')!
    await waitFor(() => {
      expect(document.activeElement).toBe(summary)
    })
    expect(details.open).toBe(true)
    expect(summary.getAttribute('data-fiber-key')).toBe('host-links:42')
    expect(summary.getAttribute('data-focused')).toBe('true')
    expect(screen.getByText('client-provider', { selector: 'strong' }).closest('summary')!.getAttribute('data-focused')).toBeNull()
  })

  it('restores an existing provider hidden by the empty-Fiber filter', async () => {
    const provider = fiber(42, { entryName: 'stale-provider' })
    renderTree({ kind: 'context', children: [consumer(), provider] })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Hide empty Fibers and Contexts' }))
    expect(screen.queryByText('stale-provider')).toBeNull()

    const consumerDetails = screen.getByText('consumer-plugin', { selector: 'strong' }).closest('details')!
    fireEvent.click(within(consumerDetails).getByRole('button', { name: 'Focus provider of shell, Fiber #42' }))
    await waitFor(() => {
      expect(screen.getByText('stale-provider', { selector: 'strong' })).toBeTruthy()
      expect(document.activeElement).toBe(screen.getByText('stale-provider', { selector: 'strong' }).closest('summary'))
    })
    expect(screen.getByRole('checkbox', { name: 'Hide empty Fibers and Contexts' })).toHaveProperty('checked', false)
  })

  it('reports a provider missing from the current snapshot', async () => {
    const missing = fiber(41, {
      entryName: 'orphan-consumer',
      inject: ['shell'],
      store: [{ name: 'shell', providerUid: 999 }],
    })
    renderTree({ kind: 'context', children: [missing] })
    fireEvent.click(screen.getByRole('button', { name: 'Focus provider of shell, Fiber #999' }))
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('There is no visible row for provider Fiber #999.')
    })
  })

  it('reports the omitted root Fiber rather than throwing when its provider is selected', async () => {
    const rootConsumer = fiber(41, {
      entryName: 'root-consumer',
      inject: ['loader'],
      store: [{ name: 'loader', providerUid: 0 }],
    })
    renderTree({ kind: 'context', children: [rootConsumer] })
    fireEvent.click(screen.getByRole('button', { name: 'Focus provider of loader, Fiber #0' }))
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('There is no visible row for provider Fiber #0.')
    })
  })
})
