/** Pure helpers for the Turbo tiling tree; no React or DOM beyond the drop math. */
import type { MosaicNode } from 'react-mosaic-component'

/** One stable cell identity; never derived from its position in the tree. */
export type CellId = string

/** Where a dragged session lands relative to a cell. */
export type DropPosition = 'left' | 'right' | 'top' | 'bottom'

/** Count the leaves in one layout. */
export function countCells(tree: MosaicNode<CellId> | null): number {
  if (tree === null) return 0
  if (typeof tree === 'string') return 1
  if (tree.type === 'tabs') return tree.tabs.length
  return tree.children.reduce((total, child) => total + countCells(child), 0)
}

/** Append a cell at the root edge without disturbing the existing split tree. */
export function appendCell(tree: MosaicNode<CellId> | null, cellId: CellId): MosaicNode<CellId> {
  if (tree === null) return cellId
  if (typeof tree === 'string' || tree.type === 'tabs') {
    return { type: 'split', direction: 'row', children: [tree, cellId] }
  }
  const { splitPercentages, ...rest } = tree
  const children = [...tree.children, cellId]
  const percentages = addSiblingPercentage(splitPercentages, tree.children.length, tree.children.length - 1, false)
  return percentages === undefined
    ? { ...rest, children }
    : { ...rest, children, splitPercentages: percentages }
}

/**
 * Insert a new cell beside one existing cell. A matching-direction split gains
 * a sibling; a cross-direction insertion wraps the target in its own split.
 */
export function insertCell(
  tree: MosaicNode<CellId> | null,
  targetId: CellId,
  cellId: CellId,
  position: DropPosition,
): MosaicNode<CellId> {
  if (tree === null) return cellId
  if (tree === targetId) return splitAround(targetId, cellId, position)
  if (typeof tree === 'string') return tree
  if (tree.type === 'tabs') return tree

  const index = tree.children.findIndex(child => containsCell(child, targetId))
  if (index < 0) return tree
  const child = tree.children[index] as MosaicNode<CellId>
  if (child === targetId && tree.direction === axisOf(position)) {
    const { splitPercentages, ...rest } = tree
    const children = [...tree.children]
    const before = position === 'left' || position === 'top'
    children.splice(before ? index : index + 1, 0, cellId)
    const percentages = addSiblingPercentage(splitPercentages, tree.children.length, index, before)
    return percentages === undefined
      ? { ...rest, children }
      : { ...rest, children, splitPercentages: percentages }
  }
  const next = insertCell(child, targetId, cellId, position)
  if (next === child) return tree
  const children = [...tree.children]
  children[index] = next
  return { ...tree, children }
}

/** Whether the tree already contains a cell. */
export function containsCell(tree: MosaicNode<CellId> | null, cellId: CellId): boolean {
  if (tree === null) return false
  if (typeof tree === 'string') return tree === cellId
  if (tree.type === 'tabs') return tree.tabs.includes(cellId)
  return tree.children.some(child => containsCell(child, cellId))
}

/** Which edge of a cell a pointer is nearest to; the centre resolves to `right`. */
export function dropPosition(rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>, x: number, y: number): DropPosition {
  const left = x - rect.left
  const right = rect.left + rect.width - x
  const top = y - rect.top
  const bottom = rect.top + rect.height - y
  const nearest = Math.min(left, right, top, bottom)
  if (nearest === left) return 'left'
  if (nearest === top) return 'top'
  if (nearest === bottom) return 'bottom'
  return 'right'
}

function axisOf(position: DropPosition): 'row' | 'column' {
  return position === 'left' || position === 'right' ? 'row' : 'column'
}

function splitAround(targetId: CellId, cellId: CellId, position: DropPosition): MosaicNode<CellId> {
  const before = position === 'left' || position === 'top'
  return {
    type: 'split',
    direction: axisOf(position),
    children: before ? [cellId, targetId] : [targetId, cellId],
  }
}

/**
 * A split that carries explicit percentages must keep exactly one number per
 * child, or `MosaicRoot` computes a child box as `undefined` and crashes when
 * the tree gains a child. Give the newcomer half of the target's share; both
 * halves keep the total at 100. A malformed or absent list is dropped so the
 * library's equal-share default applies instead of a stale array.
 */
function addSiblingPercentage(
  percentages: readonly number[] | undefined,
  childCount: number,
  targetIndex: number,
  before: boolean,
): number[] | undefined {
  if (percentages === undefined || percentages.length !== childCount) return undefined
  const target = percentages[targetIndex]
  if (target === undefined) return undefined
  const share = target / 2
  const next = [...percentages]
  next[targetIndex] = share
  next.splice(before ? targetIndex : targetIndex + 1, 0, share)
  return next
}
