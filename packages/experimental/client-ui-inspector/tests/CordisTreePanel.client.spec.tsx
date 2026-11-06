// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CordisRuntimeFiber, CordisRuntimeTree } from '@deepseek-ai/dsh-experimental-inspector/client'
import type { InspectorTreeSnapshot } from '../src/client/tree-source.ts'
import {
  CordisTreeFooterButton,
  CordisTreePanel,
  type CordisTreeFooterProps,
  type CordisTreePanelProps,
} from '../src/client/CordisTreePanel.tsx'
import { en } from '../src/client/locales.ts'
import { inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

const dictionary: Record<string, string> = en
const t: CordisTreePanelProps['t'] = (key, params = {}) => Object.entries(params).reduce(
  (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
  dictionary[key] ?? key,
)

const TREE: CordisRuntimeTree = {
  schemaVersion: 1,
  host: {
    source: { sourceId: 'host-test' as never, kind: 'host', label: 'Host process' },
    connection: { state: 'connected' },
    revision: 4,
    truncated: false,
    root: {
      kind: 'context',
      children: [{
        kind: 'fiber',
        uid: 42,
        pluginName: 'namedPlugin',
        entryName: '@fixture/named-plugin',
        state: 'active',
        inject: ['shell'],
        store: [{ name: 'shell', providerUid: 7 }],
        provides: ['visitor'],
        children: [{ kind: 'context', children: [{ kind: 'context', children: [] }] }],
      }],
    },
  },
  clients: [{
    source: { sourceId: 'client-test' as never, kind: 'client', label: 'Browser page' },
    connection: { state: 'disconnected', reason: 'socket closed' },
    revision: 7,
    truncated: true,
    root: { kind: 'context', children: [] },
  }],
}

function props(snapshot: InspectorTreeSnapshot, onRefresh = vi.fn()): CordisTreePanelProps {
  return {
    useInspection: (selector: (value: InspectorTreeSnapshot) => InspectorTreeSnapshot) => selector(snapshot),
    onRefresh,
    usePreview: (selector: (state: null) => null) => selector(null),
    onSelectService: vi.fn(),
    onClosePreview: vi.fn(),
    t,
  } as unknown as CordisTreePanelProps
}

function fiber(uid: number, overrides: Partial<CordisRuntimeFiber> = {}): CordisRuntimeFiber {
  return {
    kind: 'fiber',
    uid,
    pluginName: 'namedPlugin',
    entryName: null,
    state: 'active',
    inject: [],
    store: [],
    provides: [],
    children: [{ kind: 'context', children: [] }],
    ...overrides,
  }
}

afterEach(cleanup)

describe('CordisTreePanel', () => {
  it('keeps the Host entry inert and declares only panel dependencies', () => {
    expect(hostApply).not.toThrow()
    expect(inject).toEqual(['inspector', 'slots', 'locale', 'layout'])
  })

  it('renders Context layers, owned Fiber Contexts, realm status, truncation, and refresh', () => {
    const onRefresh = vi.fn()
    render(<CordisTreePanel {...props({ tree: TREE, read: true }, onRefresh)} />)
    expect(screen.getByRole('heading', { name: 'Cordis runtime' })).toBeTruthy()
    expect(screen.getByText('Host process')).toBeTruthy()
    expect(screen.getByText('Fiber #42')).toBeTruthy()
    expect(screen.getByText('namedPlugin')).toBeTruthy()
    expect(screen.getAllByText('@fixture/named-plugin')).toHaveLength(2)
    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.getByText('shell → Fiber #7')).toBeTruthy()
    expect(screen.getByText('visitor')).toBeTruthy()
    expect(screen.getAllByText('Context')).toHaveLength(4)
    expect(screen.getByText('Connected')).toBeTruthy()
    expect(screen.getByText('Disconnected: socket closed')).toBeTruthy()
    expect(screen.getByRole('note').textContent).toContain('node limit')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('expands every Fiber and Context by default, including deep branches', () => {
    let deep = fiber(49)
    for (let uid = 48; uid >= 44; uid -= 1) {
      deep = fiber(uid, { children: [{ kind: 'context', children: [deep] }] })
    }
    const tree: CordisRuntimeTree = {
      schemaVersion: 1,
      host: { ...TREE.host!, root: { kind: 'context', children: [deep] } },
      clients: [],
    }
    const view = render(<CordisTreePanel {...props({ tree, read: true })} />)
    const details = view.container.querySelectorAll('details')
    expect(details.length).toBeGreaterThan(4)
    expect([...details].every(element => element.open)).toBe(true)
  })

  it('distinguishes anonymous, unloaded, empty-store, failed, and disposed-provider states', () => {
    const tree: CordisRuntimeTree = {
      schemaVersion: 1,
      host: {
        ...TREE.host!,
        root: {
          kind: 'context',
          children: [
            fiber(50, { pluginName: null, state: 'pending', store: null }),
            fiber(51, { pluginName: 'emptyPlugin' }),
            fiber(52, { pluginName: 'failedPlugin', state: 'failed', store: [{ name: 'shell', providerUid: null }] }),
          ],
        },
      },
      clients: [],
    }
    render(<CordisTreePanel {...props({ tree, read: true })} />)
    expect(screen.getAllByText('Anonymous plugin')).not.toHaveLength(0)
    expect(screen.getByText('Pending')).toBeTruthy()
    expect(screen.getByText('Failed')).toBeTruthy()
    expect(screen.getByText('Unloaded; store is null')).toBeTruthy()
    expect(screen.getByText('Loaded; store is empty')).toBeTruthy()
    expect(screen.getByText('shell → disposed provider')).toBeTruthy()
    expect(screen.getAllByText('No declared dependencies')).toHaveLength(3)
    expect(screen.getAllByText('No provided services')).toHaveLength(3)
  })

  it('distinguishes the initial read from an empty result', () => {
    const view = render(<CordisTreePanel {...props({ tree: null, read: false })} />)
    expect(screen.getByRole('status').textContent).toContain('Reading the runtime tree')
    view.rerender(<CordisTreePanel {...props({ tree: { schemaVersion: 1, host: null, clients: [] }, read: true })} />)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText('No Host snapshot is available yet.')).toBeTruthy()
    expect(screen.getByText('No browser client snapshots are available yet.')).toBeTruthy()
  })

  it('reports a failure without discarding the previous tree', () => {
    render(<CordisTreePanel {...props({ tree: TREE, read: true, error: 'transport unavailable' })} />)
    expect(screen.getByRole('alert').textContent).toContain('transport unavailable')
    expect(screen.getByText('Fiber #42')).toBeTruthy()
    expect(screen.getByText('namedPlugin')).toBeTruthy()
    expect(screen.getAllByText('@fixture/named-plugin')).toHaveLength(2)
    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.getByText('shell → Fiber #7')).toBeTruthy()
    expect(screen.getByText('visitor')).toBeTruthy()
  })

  it('filters realms and inert Host entries without discarding useful descendants', () => {
    const tree: CordisRuntimeTree = {
      ...TREE,
      host: {
        ...TREE.host!,
        root: {
          kind: 'context',
          children: [
            ...TREE.host!.root.children,
            fiber(99, { entryName: '@fixture/inert-host' }),
            { kind: 'context', children: [fiber(98, { entryName: '@fixture/inert-context' })] },
          ],
        },
      },
    }
    render(<CordisTreePanel {...props({ tree, read: true })} />)
    expect(screen.getAllByText('@fixture/inert-host')).toHaveLength(2)
    expect(screen.getAllByText('@fixture/inert-context')).toHaveLength(2)
    const contextsBefore = screen.getAllByText('Context').length
    expect(screen.getByRole('checkbox', { name: 'Hide empty Fibers and Contexts' })).toHaveProperty('checked', false)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Hide empty Fibers and Contexts' }))
    expect(screen.queryByText('@fixture/inert-host')).toBeNull()
    expect(screen.queryByText('@fixture/inert-context')).toBeNull()
    expect(screen.getAllByText('Context').length).toBeLessThan(contextsBefore)
    expect(screen.getByText('Fiber #42')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Host only' }))
    expect(screen.queryByRole('heading', { name: 'Browser clients' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Host only' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Browser clients only' }))
    expect(screen.queryByRole('heading', { name: 'Host' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Browser clients' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'All realms' }))
    expect(screen.getByRole('heading', { name: 'Host' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Browser clients' })).toBeTruthy()
  })

  it('replaces the realm root Context with an empty state when every descendant is filtered', () => {
    const tree: CordisRuntimeTree = {
      schemaVersion: 1,
      host: {
        ...TREE.host!,
        root: { kind: 'context', children: [fiber(99, { entryName: '@fixture/only-inert' })] },
      },
      clients: [],
    }
    render(<CordisTreePanel {...props({ tree, read: true })} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Hide empty Fibers and Contexts' }))
    expect(screen.getByText('No Fibers or Contexts match the current filters.')).toBeTruthy()
    expect(screen.queryByText('Context')).toBeNull()
  })

  it('matches the shared footer control size and opens the runtime panel through its injected action', () => {
    const open = vi.fn()
    const view = render(<CordisTreeFooterButton {...{ wide: false, open, t } as unknown as CordisTreeFooterProps} />)
    const button = screen.getByRole('button', { name: 'Cordis runtime' })
    expect(view.container.querySelector('svg')?.getAttribute('width')).toBe('14')
    fireEvent.click(button)
    expect(open).toHaveBeenCalledOnce()
    view.rerender(<CordisTreeFooterButton {...{ wide: true, open, t } as unknown as CordisTreeFooterProps} />)
    expect(view.container.querySelector('svg')?.getAttribute('width')).toBe('13')
  })
})
