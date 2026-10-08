/** Pure read-card derivation from raw result content and metadata. @module */
import type { ReadBlockLine, ReadBlockProps } from '@deepseek-ai/dsh-client-ui-primitives'
import { abbreviateHomePath, relativizeToCwd } from '@deepseek-ai/dsh-util-workspace-path'
import type { ToolCallBlock } from './tool-call-model.ts'
import { parsedToolCall, singleResultText } from './raw-tool-call.ts'

/**
 * Content lines the chat row's resident read body shows before collapsing the
 * middle — half the primitive's own default, which the details panel keeps. A
 * chat row is a summary surface inside the message flow: the flow must stay
 * scannable across many calls, while the details panel is the single-call
 * reading surface. A design constant of this UI's row geometry, not a
 * deployment choice, so it is fixed here rather than a plugin Config field. The
 * same split [`CHAT_TERMINAL_MAX_LINES`](./terminal-card-model.ts) draws for
 * terminal output.
 */
export const CHAT_READ_MAX_LINES = 8

/**
 * The {@link ReadBlock} props this derivation owns. Picked off the primitive's
 * props so the two stay in step; `maxLines`/`className` belong to each render
 * site.
 */
export type ReadCardModel = Pick<ReadBlockProps, 'label' | 'lines' | 'totalLines' | 'lang'>

interface ReadMeta {
  path: string
  offset: number
  lines: ReadBlockLine[]
  totalLines: number
  lang?: string
}

/** Whether a model-supplied argument is a 1-based line position or count: an integer of at least 1. */
function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
}

function validReadCall(block: ToolCallBlock): boolean {
  const call = parsedToolCall(block)
  if (call?.name !== 'read') return false
  const { file_path: path, offset, limit } = call.args
  if (typeof path !== 'string' || path.trim() === '') return false
  if (offset !== undefined && !positiveInteger(offset)) return false
  if (limit !== undefined && !positiveInteger(limit)) return false
  return true
}

/** The validated `files` elements of a batched read call, or null for non-batch or malformed args. */
export function readBatchFiles(args: Record<string, unknown>): { file_path: string; offset?: number }[] | null {
  const { files } = args
  if (!Array.isArray(files) || files.length === 0) return null
  const elements: { file_path: string; offset?: number }[] = []
  for (const element of files) {
    if (typeof element !== 'object' || element === null || Array.isArray(element)) return null
    const { file_path: path, offset, limit } = element as Record<string, unknown>
    if (typeof path !== 'string' || path.trim() === '') return null
    if (offset !== undefined && !positiveInteger(offset)) return null
    if (limit !== undefined && !positiveInteger(limit)) return null
    elements.push({ file_path: path, ...positiveInteger(offset) ? { offset } : {} })
  }
  return elements
}

/** Narrow one persisted read window (singular meta or one batch frame). */
function narrowReadWindow(raw: unknown): ReadMeta | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const { path, offset, lines, totalLines, lang } = raw as Record<string, unknown>
  if (typeof path !== 'string' || typeof offset !== 'number' || !Number.isInteger(offset) || offset < 1) return null
  if (typeof totalLines !== 'number' || !Number.isInteger(totalLines) || totalLines < 0 || !Array.isArray(lines)) return null
  if (lang !== undefined && typeof lang !== 'string') return null
  const narrowed: ReadBlockLine[] = []
  let previous = offset - 1
  for (const line of lines) {
    if (typeof line !== 'object' || line === null || Array.isArray(line)) return null
    const { number, text } = line as Record<string, unknown>
    if (typeof number !== 'number' || !Number.isInteger(number) || number < 1 || number <= previous) return null
    if (number > totalLines || typeof text !== 'string') return null
    previous = number
    narrowed.push({ number, text })
  }
  return {
    path,
    offset,
    lines: narrowed,
    totalLines,
    ...lang === undefined ? {} : { lang },
  }
}

function readMeta(meta: unknown): ReadMeta | null {
  return narrowReadWindow(meta)
}

/** The persisted window of one successful batch frame, paired with its element position. */
interface ReadFrameMeta {
  index: number
  window: ReadMeta
}

/** One settled labeled frame record of a batched read call's persisted meta. */
export interface ReadFrameRecord {
  /** The element's 0-based position in the batch. */
  index: number
  /** The requested path as the call authored it. */
  filePath: string
  /** How the element settled, mirroring the tool's frame kinds. */
  kind: 'read' | 'error' | 'not-run'
  /** The successful element's window. */
  window?: ReadMeta
  /** The settled error text of a failed element. */
  message?: string
  /** Why a skipped element did not run. */
  reason?: string
}

/**
 * Narrow the persisted `frames` meta of a batched read call into settled
 * records per element outcome — windows, errors, and skips alike. Malformed
 * data yields null.
 * @param meta - the persisted result metadata of a settled batched read call.
 * @returns the settled records, or null when the payload is not usable.
 */
export function readFrameRecords(meta: unknown): ReadFrameRecord[] | null {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return null
  const { frames } = meta as Record<string, unknown>
  if (!Array.isArray(frames) || frames.length === 0) return null
  const records: ReadFrameRecord[] = []
  for (const frame of frames) {
    if (typeof frame !== 'object' || frame === null || Array.isArray(frame)) return null
    const { index, file_path: requested, path, kind, message, reason } = frame as Record<string, unknown>
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) return null
    // The tool persists the authored path as `file_path`; recorded sessions
    // predating it carry only the display `path`.
    const filePath = typeof requested === 'string' ? requested : typeof path === 'string' ? path : null
    if (filePath === null) return null
    // Recorded or minimal frames may omit the kind; a kind-less frame is a
    // success frame when its window narrows, unusable otherwise.
    if (kind === undefined || kind === 'read') {
      const window = narrowReadWindow(frame)
      if (window === null) return null
      records.push({ index, filePath, kind: 'read', window })
      continue
    }
    if (kind !== 'error' && kind !== 'not-run') return null
    if (message !== undefined && typeof message !== 'string') return null
    if (reason !== undefined && typeof reason !== 'string') return null
    records.push({
      index,
      filePath,
      kind,
      ...message === undefined ? {} : { message },
      ...reason === undefined ? {} : { reason },
    })
  }
  return records
}

/** The successful windows of a batched read call's frames meta; malformed data yields null. */
function readFramesMeta(meta: unknown): ReadFrameMeta[] | null {
  const records = readFrameRecords(meta)
  if (records === null) return null
  const entries: ReadFrameMeta[] = []
  for (const record of records) {
    if (record.kind === 'read' && record.window !== undefined) entries.push({ index: record.index, window: record.window })
  }
  return entries.length > 0 ? entries : null
}

/**
 * The line one `read` call was about, from its arguments.
 *
 * `offset` is the read tool's own 1-based start line, so opening the path can
 * land where the model looked. Available while the call is still running,
 * unlike the persisted metadata, because the arguments carry it. The arguments
 * are model-produced JSON: only an integer of at least 1 is a line, and a call
 * whose `offset` is anything else names none. A batched call names the first
 * element's line, matching the card the row settles to.
 * @param block - running or settled Tool block.
 * @returns the 1-based line, or undefined when the call named none.
 */
export function readCallLine(block: ToolCallBlock): number | undefined {
  const call = parsedToolCall(block)
  if (call?.name !== 'read') return undefined
  const batch = readBatchFiles(call.args)
  if (batch === null) {
    const { file_path: path, offset } = call.args
    if (typeof path !== 'string' || path.trim() === '') return undefined
    return positiveInteger(offset) ? offset : undefined
  }
  const frames = 'kind' in block ? readFramesMeta(block.meta) : null
  const element = frames === null ? batch[0] : batch[frames[0]?.index ?? 0]
  return element !== undefined && positiveInteger(element.offset) ? element.offset : undefined
}

/** The read envelope body of one frame section of a batched result text. */
function frameSectionBody(text: string, filesLength: number, index: number, filePath: string): string | undefined {
  const header = `[${index + 1}/${filesLength}] ${filePath}`
  const start = text.indexOf(header)
  if (start === -1) return undefined
  const body = text.slice(start + header.length + 1)
  const nextStart = Array.from({ length: filesLength }, (_, candidate) => candidate)
    .filter(candidate => candidate !== index)
    .map(candidate => body.indexOf(`\n[${candidate + 1}/${filesLength}] `))
    .filter(position => position !== -1)
    .reduce((left, right) => Math.min(left, right), body.length)
  const section = body.slice(0, nextStart)
  return /^<path>[^\n]*<\/path>\n<type>file<\/type>\n<content>\n([\s\S]*)\n<\/content>$/u.exec(section)?.[1]
}

/**
 * Derive a settled root read card after validating its persisted metadata and
 * model-facing read envelope. Singular calls read their one window; batched
 * `files` calls render the first successful frame's window (the row is a
 * one-card summary surface, the raw sections stay in the generic body).
 * @param block - running or settled Tool block.
 * @param sessionCwd - the session workspace root; a workspace-rooted absolute
 *   path label displays relative to it. Absent leaves the path as authored.
 * @param home - host account home; a leftover POSIX home path displays as `~`.
 * @returns the read-card props, or null for the generic path.
 */
export function readCardModel(
  block: ToolCallBlock,
  sessionCwd?: string,
  home?: string,
): ReadCardModel | null {
  if (block.parentCallId !== undefined || !('kind' in block) || block.isError) return null
  const call = parsedToolCall(block)
  if (call?.name !== 'read') return null
  const batch = readBatchFiles(call.args)
  if (batch === null) {
    if (!validReadCall(block)) return null
    const meta = readMeta(block.meta)
    if (meta === null) return null
    const text = singleResultText(block)
    if (text === undefined) return null
    const body = /^<path>[^\n]*<\/path>\n<type>file<\/type>\n<content>\n([\s\S]*)\n<\/content>$/u.exec(text)?.[1]
    if (body === undefined) return null
    return {
      label: abbreviateHomePath(relativizeToCwd(meta.path, sessionCwd), home),
      lines: meta.lines,
      totalLines: meta.totalLines,
      lang: meta.lang,
    }
  }
  const frames = readFramesMeta(block.meta)
  if (frames === null) return null
  const [first] = frames
  if (first === undefined || first.index >= batch.length) return null
  const filePath = batch[first.index]?.file_path
  if (filePath === undefined) return null
  const text = singleResultText(block)
  if (text === undefined) return null
  if (frameSectionBody(text, batch.length, first.index, filePath) === undefined) return null
  return {
    label: abbreviateHomePath(relativizeToCwd(first.window.path, sessionCwd), home),
    lines: first.window.lines,
    totalLines: first.window.totalLines,
    lang: first.window.lang,
  }
}
