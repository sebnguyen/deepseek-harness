/** Pure helpers for the Turbo tiling tree; no React or DOM beyond the drop math. */
import type { MosaicNode } from 'react-mosaic-component'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** One stable cell identity; never derived from its position in the tree. */
export type CellId = string

/** Where a dragged session lands relative to a cell. */
export type DropPosition = 'left' | 'right' | 'top' | 'bottom'

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

/** The assignments and selection consequence of closing cells. */
export interface CellRemoval {
  /** Assignments for the cells still in the tree. */
  readonly cells: Map<CellId, SessionId | undefined>
  /** Whether the removal unbound the current provisional blank Session. */
  readonly clearsCurrent: boolean
}

/**
 * Drop closed cells from the assignment map. A provisional blank Session only
 * holds a cell while it is current, so a removal that unbinds it must also
 * clear the selection; otherwise the blank-append effect gives it a fresh cell.
 * @param cells - current cell-to-Session assignments.
 * @param removed - cell ids leaving the tree.
 * @param current - ambient current Session, when one is selected.
 * @param currentBlank - whether the current Session is provisional and blank.
 * @returns the remaining assignments and whether the selection must clear.
 */
export function removeCells(
  cells: ReadonlyMap<CellId, SessionId | undefined>,
  removed: Iterable<CellId>,
  current: SessionId | undefined,
  currentBlank: boolean,
): CellRemoval {
  const following = new Map(cells)
  let clearsCurrent = false
  for (const cellId of removed) {
    if (current !== undefined && currentBlank && cells.get(cellId) === current) {
      clearsCurrent = true
    }
    following.delete(cellId)
  }
  return { cells: following, clearsCurrent }
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

/**
 * One split path per divider, in the order react-mosaic renders the dividers.
 * MosaicRoot walks each child subtree first and then pushes the divider that
 * follows it (its `collectElements`); the divider DOM nodes keep that order.
 * @param tree - current layout.
 * @returns split paths indexed by divider order.
 */
export function dividerSplitPaths(tree: MosaicNode<CellId> | null): number[][] {
  const paths: number[][] = []
  const walk = (node: MosaicNode<CellId> | null, path: readonly number[]): void => {
    if (node === null || typeof node === 'string' || node.type === 'tabs') return
    node.children.forEach((child, index) => {
      walk(child, [...path, index])
      if (index < node.children.length - 1) paths.push([...path])
    })
  }
  walk(tree, [])
  return paths
}

/** Equalise the children of the split at a divider's path; nothing else moves. */
export function rebalanceSplit(tree: MosaicNode<CellId> | null, path: readonly number[]): MosaicNode<CellId> | null {
  if (tree === null) return null
  if (path.length === 0) {
    if (typeof tree === 'string' || tree.type === 'tabs') return tree
    return equalSplit(tree.direction, [...tree.children])
  }
  if (typeof tree === 'string' || tree.type === 'tabs') return tree
  const index = path[0] as number
  const child = tree.children[index]
  if (child === undefined) return tree
  const next = rebalanceSplit(child, path.slice(1))
  if (next === child) return tree
  const children = [...tree.children]
  children[index] = next as MosaicNode<CellId>
  return { ...tree, children }
}

/** Whether a layout contains a cell; tabs count as leaves. */
function containsCell(tree: MosaicNode<CellId>, cellId: CellId): boolean {
  if (typeof tree === 'string') return tree === cellId
  if (tree.type === 'tabs') return tree.tabs.includes(cellId)
  return tree.children.some(child => containsCell(child, cellId))
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
  const target = percentages[targetIndex] as number
  const share = target / 2
  const next = [...percentages]
  next[targetIndex] = share
  next.splice(before ? targetIndex : targetIndex + 1, 0, share)
  return next
}

/**
 * Give every child of one split the same share. The last share takes the
 * remainder so the percentages sum to exactly 100.
 */
function equalSplit(direction: 'row' | 'column', children: MosaicNode<CellId>[]): MosaicNode<CellId> {
  const share = 100 / children.length
  return {
    type: 'split',
    direction,
    children,
    splitPercentages: children.map((_, index) => index === children.length - 1
      ? 100 - share * (children.length - 1)
      : share),
  }
}
