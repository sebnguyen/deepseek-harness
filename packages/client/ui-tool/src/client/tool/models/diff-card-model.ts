/** Pure diff-card derivation from raw file-mutation calls and result metadata. @module */
import type { DiffBlockProps, DiffHunk } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallBlock } from './tool-call-model.ts'
import { parsedToolCall, validEscalationFields } from './raw-tool-call.ts'

/**
 * Diff-body lines the chat row shows before collapsing the middle — half the
 * primitive's own default, which the details panel keeps. A chat row is a
 * summary surface inside the message flow: the flow must stay scannable across
 * many calls, while the details panel is the single-call reading surface. The
 * same split {@link CHAT_TERMINAL_MAX_LINES} draws for a terminal card, so the
 * two card kinds cap a long body at the same place in the flow. A design
 * constant of this UI's row geometry, not a deployment choice.
 */
export const CHAT_DIFF_MAX_LINES = 8

/**
 * The {@link DiffBlock} props this derivation owns. Picked off the primitive's
 * props so the two stay in step; `maxLines`/`className` belong to each render
 * site.
 */
export interface DiffCardModel {
  /**
   * The props {@link DiffBlock} draws. Held as a nested object so a render site
   * spreads exactly the primitive's own surface and can never leak a
   * neighbouring field into it.
   */
  card: Pick<DiffBlockProps, 'diffs'>
}

/**
 * Narrow opaque result metadata's `diffs` to well-formed hunks.
 * @param diffs - the metadata field to validate.
 * @returns the validated hunks, or null when the payload is not usable.
 */
function narrowDiffs(diffs: unknown): DiffHunk[] | null {
  if (!Array.isArray(diffs) || diffs.length === 0) return null
  const out: DiffHunk[] = []
  for (const hunk of diffs) {
    if (typeof hunk !== 'object' || hunk === null) return null
    const { path, oldText, newText } = hunk as Record<string, unknown>
    if (typeof path !== 'string') return null
    if (oldText !== null && typeof oldText !== 'string') return null
    if (typeof newText !== 'string') return null
    out.push({ path, oldText, newText })
  }
  return out
}

type IntendedDiff = { tool: 'write' | 'edit' | 'str_replace_editor'; diff: DiffHunk }

/**
 * The intended hunks of a batched `write` call's elements, for the pending card.
 * One diff per element `content`, one per `edits` entry; malformed elements or
 * a batch mixing nothing drawable yield null for the generic path.
 * @param args - the parsed batched write arguments.
 * @returns the intended hunks in element order, or null when unusable.
 */
/**
 * The intended hunks of one batched `write` element: one diff per `content`,
 * one per `edits` entry. A pathless or content-less element yields null.
 * @param element - one schema-validated `files` element of a batched write call.
 * @returns the element's intended hunks, or null when it draws nothing.
 */
export function batchElementDiffs(element: Record<string, unknown>): DiffHunk[] | null {
  const { file_path: path, content, edits } = element
  if (typeof path !== 'string' || path.trim() === '') return null
  const diffs: DiffHunk[] = []
  if (typeof content === 'string') diffs.push({ path, oldText: null, newText: content })
  if (!Array.isArray(edits)) {
    if (content === undefined) return null
    return diffs.length > 0 ? diffs : null
  }
  for (const entry of edits) {
    if (typeof entry !== 'object' || entry === null) return null
    const {
      old_string: oldString, new_string: newString, pattern,
      after_line: afterLine, first_line: firstLine, last_line: lastLine,
    } = entry as Record<string, unknown>
    const newText = typeof newString === 'string' ? newString : ''
    if (typeof oldString === 'string') diffs.push({ path, oldText: oldString || null, newText })
    else if (typeof pattern === 'string') diffs.push({ path, oldText: `/${pattern}/`, newText })
    else if (typeof afterLine === 'number') diffs.push({ path, oldText: null, newText })
    else if (typeof firstLine === 'number' && typeof lastLine === 'number') diffs.push({ path, oldText: `lines ${firstLine}-${lastLine}`, newText })
    else return null
  }
  return diffs.length > 0 ? diffs : null
}

function batchWriteDiffs(args: Record<string, unknown>): DiffHunk[] | null {
  const { files } = args
  if (!Array.isArray(files) || files.length === 0) return null
  const diffs: DiffHunk[] = []
  for (const element of files) {
    if (typeof element !== 'object' || element === null || Array.isArray(element)) return null
    const perElement = batchElementDiffs(element as Record<string, unknown>)
    if (perElement === null) return null
    diffs.push(...perElement)
  }
  return diffs.length > 0 ? diffs : null
}

/** One settled labeled frame record of a batched write call's persisted meta. */
export interface WriteFrameRecord {
  /** The element's 0-based position in the batch. */
  index: number
  /** The requested path as the call authored it. */
  filePath: string
  /** How the element settled, mirroring the tool's frame kinds. */
  kind: 'written' | 'error' | 'not-run'
  /** The backend-resolved display path of a written element. */
  path?: string
  /** The target's content before the commit; null for creates and previews. */
  before?: string | null
  /** The committed or previewed content. */
  after: string
  /** Whether the element committed; previews report false. */
  committed?: boolean
  /** Per-entry match accounting of the element's program. */
  outcomes?: { matches: number }[]
  /** The settled error text of a failed element. */
  message?: string
  /** Why a skipped element did not run. */
  reason?: string
}

/**
 * Narrow the persisted `frames` meta of a batched write call into settled
 * records per element outcome — commits, previews, errors, and skips alike.
 * Malformed data yields null.
 * @param meta - the persisted result metadata of a settled batched write call.
 * @returns the settled records, or null when the payload is not usable.
 */
export function writeFrameRecords(meta: unknown): WriteFrameRecord[] | null {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return null
  const { frames } = meta as Record<string, unknown>
  if (!Array.isArray(frames) || frames.length === 0) return null
  const records: WriteFrameRecord[] = []
  for (const frame of frames) {
    if (typeof frame !== 'object' || frame === null || Array.isArray(frame)) return null
    const {
      index, file_path: filePath, kind, path, before, after, committed,
      dry_run: dryRun, outcomes, message, reason,
    } = frame as Record<string, unknown>
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) return null
    if (typeof filePath !== 'string') return null
    if (kind === 'written') {
      if (typeof after !== 'string') return null
      if (before !== undefined && before !== null && typeof before !== 'string') return null
      if (path !== undefined && typeof path !== 'string') return null
      if (committed !== undefined && typeof committed !== 'boolean') return null
      if (dryRun !== undefined && typeof dryRun !== 'boolean') return null
      const narrowedOutcomes: { matches: number }[] = []
      if (outcomes !== undefined) {
        if (!Array.isArray(outcomes)) return null
        for (const outcome of outcomes) {
          if (typeof outcome !== 'object' || outcome === null) return null
          const { matches } = outcome as Record<string, unknown>
          if (typeof matches !== 'number' || !Number.isInteger(matches) || matches < 0) return null
          narrowedOutcomes.push({ matches })
        }
      }
      records.push({
        index,
        filePath,
        kind,
        after,
        ...before === undefined ? {} : { before },
        ...path === undefined ? {} : { path },
        ...committed === undefined ? {} : { committed },
        ...dryRun === true ? { committed: false } : {},
        ...narrowedOutcomes.length === 0 ? {} : { outcomes: narrowedOutcomes },
      })
      continue
    }
    if (kind !== 'error' && kind !== 'not-run') return null
    records.push({
      index,
      filePath,
      kind,
      after: '',
      ...typeof message === 'string' ? { message } : {},
      ...typeof reason === 'string' ? { reason } : {},
    })
  }
  return records
}

function intendedDiff(block: ToolCallBlock): IntendedDiff | null {
  const parsed = parsedToolCall(block)
  if (parsed === null) return null
  if (parsed.name === 'str_replace_editor') {
    const { command, path, file_text: fileText, old_str: oldText, new_str: newText } = parsed.args
    if (typeof path !== 'string' || path.trim() === '') return null
    if (command === 'create') {
      if (fileText !== undefined && typeof fileText !== 'string') return null
      return {
        tool: 'str_replace_editor',
        diff: { path, oldText: null, newText: fileText ?? '' },
      }
    }
    if (command === 'str_replace') {
      if (oldText !== undefined && typeof oldText !== 'string') return null
      if (newText !== undefined && typeof newText !== 'string') return null
      return {
        tool: 'str_replace_editor',
        diff: { path, oldText: oldText ?? null, newText: newText ?? '' },
      }
    }
    return null
  }
  const { file_path: path } = parsed.args
  if (typeof path !== 'string' || path.trim() === '') return null
  if (!validEscalationFields(parsed.args)) return null
  if (parsed.name === 'write') {
    const { content } = parsed.args
    return typeof content === 'string'
      ? { tool: 'write', diff: { path, oldText: null, newText: content } }
      : null
  }
  if (parsed.name !== 'edit') return null
  const { old_string: oldText, new_string: newText, replace_all: replaceAll } = parsed.args
  if (typeof oldText !== 'string' || typeof newText !== 'string') return null
  if (replaceAll !== undefined && typeof replaceAll !== 'boolean') return null
  return { tool: 'edit', diff: { path, oldText: oldText || null, newText } }
}

function appliedDiffs(meta: unknown): DiffHunk[] | 'empty' | null {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return null
  const record = meta as Record<string, unknown>
  let diffs: unknown = record.diffs
  if (!Array.isArray(diffs) && Array.isArray(record.frames)) {
    const collected: unknown[] = []
    for (const frame of record.frames) {
      if (typeof frame !== 'object' || frame === null || Array.isArray(frame)) return null
      const frameDiffs = (frame as Record<string, unknown>).diffs
      if (!Array.isArray(frameDiffs)) return null
      collected.push(...frameDiffs)
    }
    diffs = collected
  }
  if (!Array.isArray(diffs)) return null
  if (diffs.length === 0) return 'empty'
  return narrowDiffs(diffs)
}

/**
 * Derive running diffs for root write/edit and `str_replace_editor`
 * create/replace calls, plus applied settled diffs for root write/edit calls.
 * A successful write with valid empty metadata uses its argument-derived
 * whole-file diff, matching create and identical-overwrite presentation;
 * batched `write` files calls show their elements' hunks while running and
 * the applied frame hunks once settled. `str_replace_editor` settles through
 * Generic because it has no result view.
 * @param block - running or settled Tool block.
 * @returns the diff-card props, or null for the generic path.
 */
export function diffCardModel(block: ToolCallBlock): DiffCardModel | null {
  if (block.parentCallId !== undefined) return null
  const parsed = parsedToolCall(block)
  if (parsed !== null && parsed.name === 'write' && Array.isArray(parsed.args.files)) {
    if (!validEscalationFields(parsed.args)) return null
    const intended = batchWriteDiffs(parsed.args)
    if (intended === null) return null
    if (!('kind' in block)) return { card: { diffs: intended } }
    if (block.isError) return null
    const applied = appliedDiffs(block.meta)
    if (applied === null || applied === 'empty') return { card: { diffs: intended } }
    return { card: { diffs: applied } }
  }
  const intended = intendedDiff(block)
  if (intended === null) return null
  if (!('kind' in block)) return { card: { diffs: [intended.diff] } }
  if (intended.tool === 'str_replace_editor') return null
  if (block.isError) return null
  const applied = appliedDiffs(block.meta)
  if (applied === null || applied === 'empty') {
    return intended.tool === 'write' ? { card: { diffs: [intended.diff] } } : null
  }
  return { card: { diffs: applied } }
}
