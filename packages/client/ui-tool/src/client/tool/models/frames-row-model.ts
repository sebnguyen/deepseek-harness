/** Per-frame row material for the stacked batched read/write rows. @module */

import { diffTotals, type DiffHunk } from '@deepseek-ai/dsh-client-ui-primitives'
import { abbreviateHomePath, relativizeToCwd } from '@deepseek-ai/dsh-util-workspace-path'
import type { ToolCallBlock } from './tool-call-model.ts'
import { parsedToolCall } from './raw-tool-call.ts'
import { readBatchFiles, readFrameRecords, type ReadCardModel } from './read-card-model.ts'
import { batchElementDiffs, writeFrameRecords } from './diff-card-model.ts'

/** One openable stacked read card of a batched read row. */
export interface FramesRowRead {
  /** The ReadBlock material of the frame's window. */
  card: ReadCardModel
  /** The authored element path the row opens. */
  filePath: string
  /** The frame's 1-based start line; absent opens the file's beginning. */
  line?: number
}

/** The outcome note one stacked diff card carries beside its copy control. */
export type FramesRowDiffAccessory
  = | { kind: 'created' }
    | { kind: 'edits'; edits: number; matches: number }
    | { kind: 'dry-run' }

/** One openable stacked diff card of a batched write row. */
export interface FramesRowDiff {
  /** The element's hunks, in entry order. */
  diffs: DiffHunk[]
  /** The authored element path the row opens. */
  filePath: string
  /** Settled outcome note; running intent cards carry none. */
  accessory?: FramesRowDiffAccessory
}

/** One err/warn detach line of a batched row's failed or skipped element. */
export interface FramesRowFailure {
  /** The authored element path the line opens. */
  filePath: string
  /** The element's 1-based start line when its arguments named one. */
  line?: number
  /** Error = settled failure; not-run = skipped by the abort. */
  kind: 'error' | 'not-run'
  /** The settled error text, or the skip reason. */
  message: string
}

/** One stacked row body slot, in element order. */
export type FramesRowItem
  = | { kind: 'read'; read: FramesRowRead }
    | { kind: 'diff'; diff: FramesRowDiff }
    | { kind: 'failure'; failure: FramesRowFailure }

/**
 * The whole stacked-row derivation of one batched `read` or `write` call: the
 * body's frames in element order plus the collapsed line's batch summary input.
 * Non-batch calls, running calls, and malformed frames yield null so the row
 * keeps its singular or generic presentation.
 */
export interface FramesRowModel {
  /** The stacked body slots, in element order. */
  items: FramesRowItem[]
  /** The batch's element count, for the collapsed summary. */
  count: number
  /** The first element's authored path; the summary link opens it. */
  firstPath: string
  /** The first element's display path, for the collapsed summary text. */
  firstLabel: string
  /** The collapsed line's `+N -M` stat of every drawable hunk. */
  stat: { added: number; removed: number } | null
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
}

/** The validated `files` elements of a batched write call, or null for non-batch or malformed args. */
function writeBatchFiles(args: Record<string, unknown>): Record<string, unknown>[] | null {
  const { files } = args
  if (!Array.isArray(files) || files.length === 0) return null
  const elements: Record<string, unknown>[] = []
  for (const element of files) {
    if (typeof element !== 'object' || element === null || Array.isArray(element)) return null
    elements.push(element as Record<string, unknown>)
  }
  return elements
}

/**
 * Derive the stacked row of a settled batched `read` call: one openable read
 * card per successful frame and one detach line per error or skipped element,
 * all in element order.
 * @param block - running or settled Tool block.
 * @param sessionCwd - the session workspace root for relative path labels.
 * @param home - host account home; a leftover POSIX home path displays as `~`.
 * @returns the stacked row material, or null for the singular/generic path.
 */
export function readFramesRowModel(
  block: ToolCallBlock,
  sessionCwd?: string,
  home?: string,
): FramesRowModel | null {
  if (block.parentCallId !== undefined) return null
  const call = parsedToolCall(block)
  if (call?.name !== 'read') return null
  const batch = readBatchFiles(call.args)
  if (batch === null) return null
  const first = batch[0]
  if (first === undefined) return null
  // A running batch names its batch on the line but stacks nothing until
  // the frames settle.
  if (!('kind' in block)) {
    return {
      items: [],
      count: batch.length,
      firstPath: first.file_path,
      firstLabel: abbreviateHomePath(relativizeToCwd(first.file_path, sessionCwd), home),
      stat: null,
    }
  }
  const records = readFrameRecords(block.meta)
  if (records === null) return null
  const byIndex = new Map(records.map(record => [record.index, record]))
  const items: FramesRowItem[] = []
  for (const [index, element] of batch.entries()) {
    const record = byIndex.get(index)
    if (record === undefined) return null
    if (record.kind === 'read' && record.window !== undefined) {
      items.push({
        kind: 'read',
        read: {
          card: {
            label: abbreviateHomePath(relativizeToCwd(record.window.path, sessionCwd), home),
            lines: record.window.lines,
            totalLines: record.window.totalLines,
            lang: record.window.lang,
          },
          filePath: element.file_path,
          ...positiveInteger(record.window.offset) ? { line: record.window.offset } : {},
        },
      })
      continue
    }
    items.push({
      kind: 'failure',
      failure: {
        filePath: element.file_path,
        ...positiveInteger(element.offset) ? { line: element.offset } : {},
        kind: record.kind === 'error' ? 'error' : 'not-run',
        message: record.kind === 'error' ? record.message ?? '' : record.reason ?? '',
      },
    })
  }
  return {
    items,
    count: batch.length,
    firstPath: first.file_path,
    firstLabel: abbreviateHomePath(relativizeToCwd(first.file_path, sessionCwd), home),
    stat: null,
  }
}

/**
 * Derive the stacked row of a batched `write` call: one openable diff card per
 * element (settled hunks once committed or previewed, argument intent while
 * running) and one detach line per error or skipped element, in element order.
 * @param block - running or settled Tool block.
 * @param sessionCwd - the session workspace root for relative path labels.
 * @param home - host account home; a leftover POSIX home path displays as `~`.
 * @returns the stacked row material, or null for the singular/generic path.
 */
export function writeFramesRowModel(
  block: ToolCallBlock,
  sessionCwd?: string,
  home?: string,
): FramesRowModel | null {
  if (block.parentCallId !== undefined) return null
  const call = parsedToolCall(block)
  if (call?.name !== 'write') return null
  const batch = writeBatchFiles(call.args)
  if (batch === null) return null
  const running = !('kind' in block)
  const records = running ? null : writeFrameRecords(block.meta)
  if (!running && records === null) return null
  const byIndex = records === null ? null : new Map(records.map(record => [record.index, record]))
  const items: FramesRowItem[] = []
  let added = 0
  let removed = 0
  for (const [index, element] of batch.entries()) {
    const filePath = typeof element.file_path === 'string' ? element.file_path : ''
    const display = abbreviateHomePath(relativizeToCwd(filePath, sessionCwd), home)
    const record = byIndex?.get(index)
    if (record !== undefined && record.kind !== 'written') {
      items.push({
        kind: 'failure',
        failure: {
          filePath,
          kind: record.kind === 'error' ? 'error' : 'not-run',
          message: record.kind === 'error' ? record.message ?? '' : record.reason ?? '',
        },
      })
      continue
    }
    const diffs = record !== undefined
      ? [{ path: record.path ?? filePath, oldText: record.before ?? null, newText: record.after }]
      : batchElementDiffs(element)
    if (diffs === null) return null
    const totals = diffTotals(diffs)
    added += totals.added
    removed += totals.removed
    const editsArg = Array.isArray(element.edits) ? element.edits.length : 0
    const accessory = record === undefined
      ? undefined
      : record.committed === false
        ? { kind: 'dry-run' as const }
        : record.outcomes !== undefined || editsArg > 0
          ? {
            kind: 'edits' as const,
            edits: record.outcomes?.length ?? editsArg,
            matches: record.outcomes?.reduce((sum, outcome) => sum + outcome.matches, 0) ?? 0,
          }
          : record.before === null || record.before === undefined
            ? { kind: 'created' as const }
            : undefined
    items.push({ kind: 'diff', diff: { diffs, filePath: display, ...accessory === undefined ? {} : { accessory } } })
  }
  const first = batch[0]
  if (first === undefined) return null
  const firstPath = typeof first.file_path === 'string' ? first.file_path : ''
  return {
    items,
    count: batch.length,
    firstPath,
    firstLabel: abbreviateHomePath(relativizeToCwd(firstPath, sessionCwd), home),
    stat: { added, removed },
  }
}
