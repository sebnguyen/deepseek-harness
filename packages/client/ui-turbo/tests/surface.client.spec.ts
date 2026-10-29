import { describe, expect, it } from 'vitest'
import type { MosaicNode } from 'react-mosaic-component'
import { appendCell, containsCell, countCells, dropPosition, insertCell, type CellId } from '../src/client/surface.ts'

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
    const percentages = (next as { splitPercentages: number[] }).splitPercentages
    expect(percentages).toHaveLength(3)
    expect(percentages.reduce((total, value) => total + value, 0)).toBe(100)
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

  it('counts leaves and detects membership through nested splits', () => {
    const tree: MosaicNode<CellId> = {
      type: 'split',
      direction: 'row',
      children: ['a', { type: 'split', direction: 'column', children: ['b', 'c'] }],
    }
    expect(countCells(tree)).toBe(3)
    expect(containsCell(tree, 'c')).toBe(true)
    expect(containsCell(tree, 'missing')).toBe(false)
  })

  it('resolves the nearest cell edge', () => {
    const rect = { left: 0, top: 0, width: 400, height: 300 }
    expect(dropPosition(rect, 10, 150)).toBe('left')
    expect(dropPosition(rect, 390, 150)).toBe('right')
    expect(dropPosition(rect, 200, 10)).toBe('top')
    expect(dropPosition(rect, 200, 290)).toBe('bottom')
  })
})
