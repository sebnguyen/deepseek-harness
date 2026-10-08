/**
 * One-page unified projection of two snapshot texts: context rows carry
 * both gutter numbers, removed rows the old one, added rows the new —
 * the frozen Changes display renders these directly and the chip rows
 * reuse `frameDiff` for their badges.
 *
 * @module @deepseek-ai/dsh-client-ui-primitives/unified
 */
import { structuredPatch } from 'diff'

/** One row of the frozen unified page. */
export interface UnifiedLine {
  readonly kind: 'context' | 'added' | 'removed'
  /** Old-side row number; absent on added rows. */
  readonly oldLine?: number
  /** New-side row number; absent on removed rows. */
  readonly newLine?: number
  /** The row text without its patch marker. */
  readonly text: string
}

/**
 * Project two snapshot texts into one unified page with three-line
 * context, the same patch the line-count badges are derived from.
 * @param before - the prior edge's text, undefined before first appearance.
 * @param after - the later edge's text, undefined when the file left.
 * @returns the rows of the unified page, in order.
 */
export function unifiedLines(before: string | undefined, after: string | undefined): readonly UnifiedLine[] {
  const patch = structuredPatch('', '', before ?? '', after ?? '', undefined, undefined, { context: 3 })
  const lines: UnifiedLine[] = []
  for (const hunk of patch.hunks) {
    let oldLine = hunk.oldStart
    let newLine = hunk.newStart
    for (const raw of hunk.lines) {
      if (raw.startsWith('\\')) continue // "no newline" markers carry no row
      if (raw.startsWith('+')) {
        lines.push({ kind: 'added', newLine: newLine, text: raw.slice(1) })
        newLine += 1
      }
      else if (raw.startsWith('-')) {
        lines.push({ kind: 'removed', oldLine: oldLine, text: raw.slice(1) })
        oldLine += 1
      }
      else {
        lines.push({ kind: 'context', oldLine: oldLine, newLine: newLine, text: raw.slice(1) })
        oldLine += 1
        newLine += 1
      }
    }
  }
  return lines
}
