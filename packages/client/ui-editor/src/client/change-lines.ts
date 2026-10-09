/**
 * The line-number projection one frozen frame contributes to the source
 * editor's gutter: the after-side numbers of added lines and the
 * before-side numbers of removed lines, projected off the same
 * `unifiedLines` the frozen unified view renders.
 */
import { unifiedLines } from '@deepseek-ai/dsh-client-ui-primitives'

/** One frozen frame's changed line numbers, per side. */
export interface ChangedLines {
  /** One-based line numbers the later text added or rewrote. */
  readonly added: readonly number[]
  /** One-based line numbers the earlier text lost. */
  readonly removed: readonly number[]
}

/**
 * The changed line numbers of two snapshot texts.
 * @param before - the prior edge's text, undefined before first appearance.
 * @param after - the later edge's text, undefined when the file left.
 * @returns after-side added and before-side removed line numbers, ascending.
 */
export function changedLines(before: string | undefined, after: string | undefined): ChangedLines {
  const added: number[] = []
  const removed: number[] = []
  for (const line of unifiedLines(before, after)) {
    if (line.kind === 'added' && line.newLine !== undefined) added.push(line.newLine)
    else if (line.kind === 'removed' && line.oldLine !== undefined) removed.push(line.oldLine)
  }
  return { added, removed }
}

/**
 * The union of changed line numbers the markers draw, deduplicated and
 * ascending, clamped to the after text's length so a shrink never points
 * past the document.
 * @param change - one frame's changed lines.
 * @param afterLineCount - the later text's line count.
 * @returns the marker line numbers, ascending.
 */
export function markerLines(change: ChangedLines, afterLineCount: number): readonly number[] {
  const set = new Set<number>()
  for (const line of change.added) set.add(line)
  for (const line of change.removed) set.add(Math.min(line, afterLineCount))
  return [...set].filter(line => line >= 1).sort((left, right) => left - right)
}
