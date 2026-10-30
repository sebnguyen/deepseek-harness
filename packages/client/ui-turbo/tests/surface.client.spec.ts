import { describe, expect, it } from 'vitest'
import type { MosaicNode } from 'react-mosaic-component'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  appendCell, dividerSplitPaths, dropPosition, insertCell, rebalanceSplit, removeCells, type CellId,
} from '../src/client/surface.ts'

/** Read a split node's explicit percentages. */
function percentages(node: MosaicNode<CellId>): number[] {
  return (node as { splitPercentages: number[] }).splitPercentages
}

/** Read a split node's children. */
function children(node: MosaicNode<CellId>): MosaicNode<CellId>[] {
  return (node as { children: MosaicNode<CellId>[] }).children
}

/** Assert one split divides its area equally across its children. */
function expectEqualShares(node: MosaicNode<CellId>, count: number): void {
  const values = percentages(node)
  expect(values).toHaveLength(count)
  for (const value of values) expect(value).toBeCloseTo(100 / count, 10)
  expect(values.reduce((total, value) => total + value, 0)).toBeCloseTo(100, 10)
}

describe('Turbo tiling helpers', () => {
  it('appends cells without renaming existing leaves', () => {
    expect(appendCell(null, 'a')).toBe('a')
    expect(appendCell('a', 'b')).toEqual({
      type: 'split', direction: 'row', children: ['a', 'b'],
    })
    const tree: MosaicNode<CellId> = {
      type: 'split', direction: 'row', children: ['a', 'b'],
    }
    expect(appendCell(tree, 'c')).toEqual({
      type: 'split', direction: 'row', children: ['a', 'b', 'c'],
    })
  })

  it('keeps a tabs node as one pane beside the appended cell', () => {
    const tabs = { type: 'tabs', tabs: ['a', 'b'] } as MosaicNode<CellId>
    expect(appendCell(tabs, 'c')).toEqual({
      type: 'split', direction: 'row', children: [tabs, 'c'],
    })
  })

  it('keeps explicit split percentages aligned when a cell is appended', () => {
    const tree: MosaicNode<CellId> = {
      type: 'split',
      direction: 'row',
      children: ['a', 'b'],
      splitPercentages: [50, 50],
    }
    const next = appendCell(tree, 'c')
    expect(next).toEqual({
      type: 'split',
      direction: 'row',
      children: ['a', 'b', 'c'],
      splitPercentages: [50, 25, 25],
    })
    const values = percentages(next)
    expect(values).toHaveLength(3)
    expect(values.reduce((total, value) => total + value, 0)).toBe(100)
  })

  it('inserts beside a leaf in the target direction', () => {
    expect(insertCell('a', 'a', 'b', 'right')).toEqual({
      type: 'split', direction: 'row', children: ['a', 'b'],
    })
    expect(insertCell('a', 'a', 'b', 'top')).toEqual({
      type: 'split', direction: 'column', children: ['b', 'a'],
    })
  })

  it('adds a sibling when the enclosing split already matches the axis', () => {
    const tree: MosaicNode<CellId> = {
      type: 'split', direction: 'row', children: ['a', 'b'],
    }
    expect(insertCell(tree, 'a', 'c', 'left')).toEqual({
      type: 'split', direction: 'row', children: ['c', 'a', 'b'],
    })
    expect(insertCell(tree, 'b', 'c', 'bottom')).toEqual({
      type: 'split',
      direction: 'row',
      children: ['a', { type: 'split', direction: 'column', children: ['b', 'c'] }],
    })
  })

  it('keeps explicit split percentages aligned when a sibling is inserted', () => {
    const tree: MosaicNode<CellId> = {
      type: 'split',
      direction: 'row',
      children: ['a', 'b'],
      splitPercentages: [70, 30],
    }
    expect(insertCell(tree, 'b', 'c', 'right')).toEqual({
      type: 'split',
      direction: 'row',
      children: ['a', 'b', 'c'],
      splitPercentages: [70, 15, 15],
    })
    expect(insertCell(tree, 'a', 'c', 'left')).toEqual({
      type: 'split',
      direction: 'row',
      children: ['c', 'a', 'b'],
      splitPercentages: [35, 35, 30],
    })
  })

  it('drops malformed percentages instead of keeping a stale array', () => {
    const tree = {
      type: 'split',
      direction: 'row',
      children: ['a', 'b', 'c'],
      splitPercentages: [50, 50],
    } as MosaicNode<CellId>
    expect(appendCell(tree, 'd')).toEqual({
      type: 'split', direction: 'row', children: ['a', 'b', 'c', 'd'],
    })
  })

  it('leaves the layout untouched when the drop target is not a cell', () => {
    expect(insertCell(null, 'missing', 'a', 'right')).toBe('a')
    expect(insertCell('a', 'missing', 'b', 'right')).toBe('a')
    const tabs = { type: 'tabs', tabs: ['a'] } as MosaicNode<CellId>
    expect(insertCell(tabs, 'a', 'b', 'right')).toBe(tabs)
    const tree: MosaicNode<CellId> = { type: 'split', direction: 'row', children: ['a', 'b'] }
    expect(insertCell(tree, 'missing', 'c', 'right')).toBe(tree)
  })

  it('finds a target inside a nested split and a tabs child', () => {
    const nested: MosaicNode<CellId> = {
      type: 'split',
      direction: 'row',
      children: ['a', { type: 'split', direction: 'column', children: ['b', 'c'] }],
    }
    expect(insertCell(nested, 'c', 'd', 'right')).toEqual({
      type: 'split',
      direction: 'row',
      children: [
        'a',
        {
          type: 'split',
          direction: 'column',
          children: ['b', { type: 'split', direction: 'row', children: ['c', 'd'] }],
        },
      ],
    })
    const withTabs: MosaicNode<CellId> = {
      type: 'split', direction: 'row', children: ['a', { type: 'tabs', tabs: ['b'], activeTabIndex: 0 }],
    }
    expect(insertCell(withTabs, 'b', 'c', 'right')).toBe(withTabs)
  })
})

describe('Turbo divider rebalance', () => {
  it('maps every rendered divider to its split in render order', () => {
    const grid: MosaicNode<CellId> = {
      type: 'split',
      direction: 'column',
      children: [
        { type: 'split', direction: 'row', children: ['a', 'b'] },
        { type: 'split', direction: 'row', children: ['c', 'd'] },
      ],
    }
    expect(dividerSplitPaths(grid)).toEqual([[0], [], [1]])
    expect(dividerSplitPaths(null)).toEqual([])
    expect(dividerSplitPaths('a')).toEqual([])
    expect(dividerSplitPaths({ type: 'tabs', tabs: ['a', 'b'] } as MosaicNode<CellId>)).toEqual([])
    expect(dividerSplitPaths({ type: 'split', direction: 'row', children: ['a', 'b', 'c'] })).toEqual([[], []])
  })

  it('equalises the split at a divider path without touching the rest', () => {
    const resized: MosaicNode<CellId> = {
      type: 'split',
      direction: 'column',
      children: [
        { type: 'split', direction: 'row', children: ['a', 'b'], splitPercentages: [80, 20] },
        { type: 'split', direction: 'row', children: ['c', 'd'], splitPercentages: [70, 30] },
      ],
      splitPercentages: [60, 40],
    }
    const paths = dividerSplitPaths(resized)
    const nested = rebalanceSplit(resized, paths[2]!)
    expectEqualShares(children(nested!)[1]!, 2)
    expect(percentages(children(nested!)[0]!)).toEqual([80, 20])
    expect(percentages(nested!)).toEqual([60, 40])

    const root = rebalanceSplit(resized, paths[1]!)
    expectEqualShares(root!, 2)
    expect(children(root!)[0]).toBe(children(resized)[0])
  })

  it('leaves a leaf, tabs node, missing child, or missing tree unchanged', () => {
    const tabs = { type: 'tabs', tabs: ['a', 'b'] } as MosaicNode<CellId>
    expect(rebalanceSplit(null, [])).toBeNull()
    expect(rebalanceSplit('a', [])).toBe('a')
    expect(rebalanceSplit(tabs, [])).toBe(tabs)
    expect(rebalanceSplit('a', [0])).toBe('a')
    expect(rebalanceSplit(tabs, [0])).toBe(tabs)
    const tree: MosaicNode<CellId> = {
      type: 'split', direction: 'row', children: ['a', { type: 'tabs', tabs: ['b'], activeTabIndex: 0 }],
    }
    expect(rebalanceSplit(tree, [0])).toBe(tree)
    expect(rebalanceSplit(tree, [1])).toBe(tree)
    expect(rebalanceSplit(tree, [5])).toBe(tree)
  })
})

describe('Turbo cell removal', () => {
  const session = (id: string): SessionId => id as SessionId
  const cells = new Map<CellId, SessionId | undefined>([
    ['a', session('s1')],
    ['b', undefined],
    ['c', session('s2')],
  ])

  it('drops removed cells without mutating the assignments', () => {
    const removal = removeCells(cells, ['b'], session('s1'), true)
    expect([...removal.cells.keys()]).toEqual(['a', 'c'])
    expect(removal.clearsCurrent).toBe(false)
    expect(cells.has('b')).toBe(true)
  })

  it('clears a provisional blank current Session unbound by the removal', () => {
    expect(removeCells(cells, ['a'], session('s1'), true).clearsCurrent).toBe(true)
  })

  it('keeps the selection when the removal does not unbind a blank current Session', () => {
    expect(removeCells(cells, ['b'], session('s1'), true).clearsCurrent).toBe(false)
    expect(removeCells(cells, ['c'], session('s1'), true).clearsCurrent).toBe(false)
    expect(removeCells(cells, ['a'], session('s1'), false).clearsCurrent).toBe(false)
    expect(removeCells(cells, ['a'], undefined, true).clearsCurrent).toBe(false)
  })
})

describe('Turbo drop edges', () => {
  it('resolves the nearest cell edge', () => {
    const rect = { left: 0, top: 0, width: 400, height: 300 }
    expect(dropPosition(rect, 10, 150)).toBe('left')
    expect(dropPosition(rect, 390, 150)).toBe('right')
    expect(dropPosition(rect, 200, 10)).toBe('top')
    expect(dropPosition(rect, 200, 290)).toBe('bottom')
  })
})
