import { describe, expect, it } from 'vitest'
import type { CordisRuntimeFiber, CordisRuntimeTree } from '@deepseek-ai/dsh-experimental-inspector/client'
import { filterCordisRuntimeTree } from '../src/client/filter-tree.ts'

function fiber(uid: number, overrides: Partial<CordisRuntimeFiber> = {}): CordisRuntimeFiber {
  return {
    kind: 'fiber',
    uid,
    pluginName: `plugin-${String(uid)}`,
    entryName: null,
    state: 'active',
    inject: [],
    store: [],
    provides: [],
    children: [{ kind: 'context', children: [] }],
    ...overrides,
  }
}

const TREE: CordisRuntimeTree = {
  schemaVersion: 1,
  host: {
    source: { sourceId: 'host-filter' as never, kind: 'host', label: 'Host' },
    connection: { state: 'connected' },
    revision: 1,
    truncated: false,
    root: {
      kind: 'context',
      children: [
        fiber(1, { entryName: 'inert-host-entry' }),
        fiber(2, {
          children: [{
            kind: 'context',
            children: [
              fiber(3),
              fiber(4, { inject: ['shell'], store: [{ name: 'shell', providerUid: 7 }] }),
            ],
          }],
        }),
        fiber(5, { provides: ['provided'] }),
        fiber(6, { store: null }),
        { kind: 'context', children: [fiber(8, { entryName: 'inert-context-entry' })] },
      ],
    },
  },
  clients: [{
    source: { sourceId: 'client-filter' as never, kind: 'client', label: 'Client' },
    connection: { state: 'connected' },
    revision: 2,
    truncated: false,
    root: { kind: 'context', children: [] },
  }],
}

describe('filterCordisRuntimeTree', () => {
  it('returns the original snapshot when no filter is active', () => {
    expect(filterCordisRuntimeTree(TREE, 'all', false)).toBe(TREE)
  })

  it('selects either realm without mutating the source snapshot', () => {
    expect(filterCordisRuntimeTree(TREE, 'host', false).clients).toEqual([])
    expect(filterCordisRuntimeTree(TREE, 'client', false).host).toBeNull()
    expect(filterCordisRuntimeTree(TREE, 'client', false).clients).toHaveLength(1)
    expect(TREE.host).not.toBeNull()
    expect(TREE.clients).toHaveLength(1)
  })

  it('prunes inert leaves but preserves ancestors and service facts', () => {
    const host = filterCordisRuntimeTree(TREE, 'all', true).host!
    expect(host.root.children.map(node => node.kind === 'fiber' ? node.uid : null)).toEqual([2, 5])
    const parent = host.root.children[0]!
    if (parent.kind !== 'fiber') throw new Error('expected retained parent')
    expect(parent.children[0].children.map(node => node.kind === 'fiber' ? node.uid : null)).toEqual([4])
    expect(host.root.children.every(node => node.kind === 'fiber')).toBe(true)
    expect(JSON.stringify(host)).not.toContain('inert-context-entry')
    expect(JSON.stringify(host)).not.toContain('inert-host-entry')
  })

  it('prunes unloaded fibers only when they have no descendants or services', () => {
    const host = filterCordisRuntimeTree(TREE, 'all', true).host!
    expect(host.root.children.some(node => node.kind === 'fiber' && node.uid === 6)).toBe(false)
    expect(host.root.children.some(node => node.kind === 'fiber' && node.uid === 5 && node.provides[0] === 'provided')).toBe(true)
  })

  it('leaves only the realm root when no Fiber survives in any Context branch', () => {
    const tree: CordisRuntimeTree = {
      ...TREE,
      host: {
        ...TREE.host!,
        root: {
          kind: 'context',
          children: [
            { kind: 'context', children: [fiber(20), { kind: 'context', children: [fiber(21)] }] },
          ],
        },
      },
      clients: [],
    }
    const filtered = filterCordisRuntimeTree(tree, 'all', true)
    expect(filtered.host!.root.children).toEqual([])
    expect(tree.host!.root.children).toHaveLength(1)
    expect(JSON.stringify(filtered)).not.toContain('plugin-20')
  })
})
