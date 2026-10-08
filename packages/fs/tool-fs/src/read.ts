/**
 * Model-facing UTF-8 read. Each element performs one provider stat for type,
 * routing, and observed version, streams large or size-unknown files, renders a
 * bounded window, then emits the observation. The shipped face is the `files`
 * batch: every element settles into its own `[i/N] <path>` frame, earlier
 * failures included, so several reads ride one tool call. Config `legacyFaces`
 * re-registers the pre-batch singular call for recorded-session replay, whose
 * committed model behavior never batches.
 * @module @deepseek-ai/dsh-tool-fs/src/read
 */

import type { Context } from '@deepseek-ai/cordis'
import { adviceLine } from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ReadResultView, ToolExecution, ToolResult } from '@deepseek-ai/dsh-tools'
import type { } from '@deepseek-ai/dsh-fs'
import { buildWindow, formatReadOutput, langFromPath, readMetaFromMeta } from './read-render.ts'
import { resolveRegularReadTarget } from './read-target.ts'

/** Default and maximum number of lines returned by one `read` element (the `readLimit` config). */
export const READ_LIMIT = 2000

/** Default and maximum number of elements one `read` call batches (the `maxFilesPerCall` config). */
export const MAX_FILES_PER_CALL = 8

/**
 * Default streaming threshold (the `readStreamMinSize` config): files at or
 * above this size stream; smaller files read whole into memory.
 */
export const STREAM_MIN_SIZE = 10 * 1024 * 1024

/** Resolved read-tool caps — plugin config after defaulting (see `Config` in index.ts). */
export interface ReadToolCaps {
  /** Default and maximum number of lines returned by one element. */
  limit: number
  /** Maximum characters returned for a single line. */
  maxLineLength: number
  /** Maximum bytes returned for a single element's selected lines. */
  maxBytes: number
  /** Files at or above this size stream; smaller files read whole into memory. */
  streamMinSize: number
  /** Maximum elements one batched call accepts. */
  maxFiles: number
}

/** Validated read element constraints after defaulting. */
interface ReadElementInput {
  filePath: string
  offset: number
  limit: number
}

/** One schema-validated `files` array element. */
interface RawReadElement {
  file_path?: unknown
  offset?: unknown
  limit?: unknown
}

/** One settled labeled slot of a batched read call. */
export interface ReadFrameRecord {
  /** The element's 0-based position in the batch. */
  index: number
  /** The requested path (or `<invalid>` when the element carried none). */
  file_path: string
  /** How the element settled: `read`, `error`, or `not-run`. */
  kind: string
  /** The backend-resolved display path of a successful read. */
  path?: string
  /** The 1-based first line of a successful read's window. */
  offset?: number
  /** A successful read's numbered window lines. */
  lines?: { number: number; text: string }[]
  /** A successful read's exact file line count. */
  totalLines?: number
  /** The settled error text of a failed element. */
  message?: string
  /** Why a skipped element did not run. */
  reason?: string
}

function parsePositiveInteger(value: number, name: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

/**
 * Validate value constraints the schema DSL can't express. `maxLimit` is the deployment's line cap.
 * @param args - the schema-validated raw tool arguments; `offset`/`limit` must be positive integers when given.
 * @param maxLimit - the configured line cap: both the default `limit` and the largest one accepted.
 * @returns the validated input with `offset` defaulted to 1 and `limit` to `maxLimit`.
 */
export function parseReadArgs(args: { file_path: string; offset?: number; limit?: number }, maxLimit: number): ReadInput {
  if (args.file_path.trim().length === 0) throw new Error('file_path must be a non-empty string')
  const offset = args.offset === undefined ? 1 : parsePositiveInteger(args.offset, 'offset')
  const limit = args.limit === undefined ? maxLimit : parsePositiveInteger(args.limit, 'limit')
  if (limit > maxLimit) throw new Error(`limit must be less than or equal to ${maxLimit}`)
  return { filePath: args.file_path, offset, limit }
}

/** Validated `read` arguments after defaulting (singular legacy face). */
interface ReadInput {
  filePath: string
  offset: number
  limit: number
}

/**
 * Validate one `files` element with the same caps the singular face applies.
 * `file_path` must be a non-blank string; `offset`/`limit` are positive integers
 * when given, `limit` additionally bounded by the deployment cap.
 * @param raw - one schema-validated array element.
 * @param maxLimit - the configured line cap.
 * @returns the validated element with defaults applied.
 */
export function parseReadElement(raw: RawReadElement, maxLimit: number): ReadElementInput {
  if ((raw.file_path as string).trim().length === 0) {
    throw new Error('file_path must be a non-empty string')
  }
  const offset = raw.offset === undefined ? 1 : parsePositiveInteger(raw.offset as number, 'offset')
  const limit = raw.limit === undefined ? maxLimit : parsePositiveInteger(raw.limit as number, 'limit')
  if (limit > maxLimit) throw new Error(`limit must be less than or equal to ${maxLimit}`)
  return { filePath: raw.file_path as string, offset, limit }
}

/**
 * Validate the batch envelope the schema DSL can't express: at least one
 * element, at most the configured cap.
 * @param files - the schema-validated `files` array.
 * @param maxFiles - the configured element cap.
 * @returns the element list, re-typed after the length guards.
 */
export function parseReadBatch(files: RawReadElement[], maxFiles: number): RawReadElement[] {
  if (files.length === 0) throw new Error('files must contain at least one element')
  if (files.length > maxFiles) throw new Error(`files must contain at most ${maxFiles} elements`)
  return files
}

/**
 * Render one settled read frame section: the header, then the singular read
 * envelope for successes or the frame's marker line, so each section parses
 * with the same anchor contract as a one-file result.
 * @param frames - the settled element outcomes, in submission order.
 * @returns the model-facing sectioned text.
 */
export function renderReadFrames(frames: readonly ReadFrameRecord[]): string {
  return frames.map((frame) => {
    const header = `[${frame.index + 1}/${frames.length}] ${frame.file_path}`
    if (frame.kind === 'read') {
      return `${header}\n${formatReadOutput(frame.path ?? frame.file_path, {
        offset: frame.offset ?? 1,
        lines: frame.lines ?? [],
        totalLines: frame.totalLines ?? 0,
      })}`
    }
    if (frame.kind === 'error') return `${header}\n[error: ${frame.message ?? ''}]`
    return `${header}\n[not run: ${frame.reason ?? ''}]`
  }).join('\n')
}

/** The persisted `meta` payload for batched read results: one window per successful frame. */
export interface FsReadFramesMeta {
  frames: FsReadFrameMetaEntry[]
}

/** One successful frame's window persisted for replay-safe cards. */
export interface FsReadFrameMetaEntry {
  /** The element's 0-based position in the batch. */
  index: number
  /** The read file's model-facing path. */
  path: string
  /** The 1-based first line the window requested. */
  offset: number
  /** The returned window's lines. */
  lines: { number: number; text: string }[]
  /** Exact total line count in the file. */
  totalLines: number
  /** Syntax-highlighting language hint, or omitted for plain text. */
  lang?: string
}

/**
 * Narrow opaque live or replayed batch metadata to its frame windows. Malformed
 * metadata returns `undefined` so presentation falls back to the generic card.
 * @param meta - result metadata.
 * @returns the validated frame windows, or `undefined` for absent or malformed data.
 */
export function readFramesMetaFromMeta(meta: unknown): FsReadFramesMeta | undefined {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const { frames } = meta as Record<string, unknown>
  if (!Array.isArray(frames)) return undefined
  const entries: FsReadFrameMetaEntry[] = []
  for (const frame of frames) {
    if (typeof frame !== 'object' || frame === null || Array.isArray(frame)) return undefined
    const { index } = frame as Record<string, unknown>
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) return undefined
    const window = readMetaFromMeta(frame)
    if (window === undefined) return undefined
    entries.push({ index, ...window })
  }
  return { frames: entries }
}

/** The settled-frame identity properties both tools' frames output schemas share. */
export const FRAME_COORD_PROPERTIES = {
  index: { type: 'integer', required: true },
  file_path: { type: 'string', required: true },
  kind: { type: 'string', required: true },
  path: { type: 'string' },
} as const

/**
 * Resolve, stream, window-cap, and observe one read element's target; the single
 * read pipeline both registered faces execute.
 * @param ctx - the plugin context owning `fs`.
 * @param exec - the running tool call (signal, scoped cwd).
 * @param caps - the resolved read caps.
 * @param input - the element's validated path and window bounds.
 * @returns the display path, offset, and capped window of the read.
 */
async function executeReadWindow(
  ctx: Context,
  exec: ToolExecution,
  caps: ReadToolCaps,
  input: ReadElementInput,
) {
  // One stat: absence observation OR type check + size routing + present version.
  // A concurrent write can only make a later guarded mutation fail stale and require reread.
  const { target, info } = await resolveRegularReadTarget(ctx, exec, input.filePath)

  // Stream when the file is large OR size is unknown, so a size-less backend
  // never buffers an arbitrarily large file.
  const chunks = info.size === undefined || info.size >= caps.streamMinSize
    ? await ctx.fs.streamText(target, exec.signal)
    : [await ctx.fs.readText(target, exec.signal)]
  const window = await buildWindow(
    chunks,
    { offset: input.offset, limit: input.limit, maxLineLength: caps.maxLineLength, maxBytes: caps.maxBytes },
    target.displayPath,
  )
  // Record the present observation (a no-op when no policy plugin listens). The
  // read already succeeded; an fs/observed listener is contractually a
  // synchronous, side-effect-only recorder.
  ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
  return { path: target.displayPath, offset: input.offset, lines: window.lines, totalLines: window.totalLines }
}

/** Run one read element to its settled frame fields; failures settle, never throw. */
async function executeReadElement(
  ctx: Context,
  exec: ToolExecution,
  caps: ReadToolCaps,
  raw: RawReadElement,
): Promise<Omit<ReadFrameRecord, 'index' | 'file_path'>> {
  try {
    return { kind: 'read', ...await executeReadWindow(ctx, exec, caps, parseReadElement(raw, caps.limit)) }
  } catch (error: unknown) {
    exec.signal.throwIfAborted()
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) }
  }
}
/**
 * Register the `read` tool and its scope-aware system-prompt guidance. The
 * shipped face is the `files` batch; `legacy` re-registers the pre-batch
 * singular call for recorded-session replay compositions.
 * @param ctx - the plugin context; registrations are effects scoped to it, and execution uses its `fs` service.
 * @param caps - the deployment's resolved read caps (plugin config after defaulting).
 * @param legacy - register the singular pre-batch face instead of the batch.
 */
export function applyReadTool(ctx: Context, caps: ReadToolCaps, legacy = false): void {
  if (legacy) {
    applyLegacyReadTool(ctx, caps)
    return
  }
  ctx.systemPrompt.section({
    name: 'tool:read',
    order: ctx.systemPrompt.getSectionOrder('TOOL_READ'),
    text: ({ scope }) => ctx.tools.get('read', scope) === undefined
      ? ''
      : adviceLine('Read gives UTF-8 contents with line numbers that bash cat and sed cannot; pass every file the next step needs as one `files` element — each with its own offset and limit — and every element settles into its own labeled frame, a missing file reported in-frame instead of failing the call. Example: read the handler and its test as two elements before editing the error branch.'),
  })

  ctx.tools.register(defineTool({
    name: 'read',
    description: 'Read UTF-8 text files and return line-numbered content; each element of `files` runs and settles into its own labeled frame, in written order, earlier failures included.',
    parameters: {
      files: {
        type: 'array',
        required: true,
        description: `The files to read, in written order; 1 to ${caps.maxFiles} elements. Independent reads of one thought belong in one call.`,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            file_path: { type: 'string', required: true, description: 'Path to read, resolved by the filesystem backend.' },
            offset: { type: 'number', description: '1-based first line to return for this file. Defaults to 1.' },
            limit: { type: 'number', description: `Maximum number of lines to return for this file. Defaults to ${caps.limit}.` },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          frames: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                ...FRAME_COORD_PROPERTIES,
                offset: { type: 'integer' },
                lines: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      number: { type: 'integer', required: true },
                      text: { type: 'string', required: true },
                    },
                  },
                },
                totalLines: { type: 'integer' },
                message: { type: 'string' },
                reason: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderReadFrames(value.frames) }],
      // Project every successful frame's window into persisted `meta` so the
      // Web read cards survive replay: the raw canonical output object is not
      // on the wire, only the model-facing text.
      presentationMeta: (_args, value) => ({
        frames: value.frames.flatMap((frame) => {
          if (frame.kind !== 'read'
            || frame.path === undefined
            || frame.offset === undefined
            || frame.lines === undefined
            || frame.totalLines === undefined) return []
          const lang = langFromPath(frame.path)
          return [{
            index: frame.index,
            path: frame.path,
            offset: frame.offset,
            lines: frame.lines.map(({ number, text }) => ({ number, text })),
            totalLines: frame.totalLines,
            ...lang === undefined ? {} : { lang },
          }]
        }),
      }),
    },
    // Observation races fail closed because guarded mutations re-check the version in-lock.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const files = parseReadBatch(args.files as RawReadElement[], caps.maxFiles)
      const frames: ReadFrameRecord[] = []
      for (const [index, element] of files.entries()) {
        const label = element.file_path as string
        if (exec.signal.aborted) {
          frames.push({ index, file_path: label, kind: 'not-run', reason: 'call aborted' })
          continue
        }
        frames.push({ index, file_path: label, ...await executeReadElement(ctx, exec, caps, element) })
      }
      return { frames }
    },
    // Pure display: a generic card titled by the first file; one line pill
    // cannot represent several frames.
    presentCall(args): GenericCallView {
      const files = (args.files ?? []) as RawReadElement[]
      /* v8 ignore next -- replay of obsolete singular args cannot name a batched first element; the soft validator declines first. */
      const first = typeof files[0]?.file_path === 'string' ? files[0].file_path : '<invalid>'
      return {
        card: 'generic',
        title: files.length <= 1 ? `Read ${first}` : `${files.length} reads: ${first}`,
        kind: 'read',
        /* v8 ignore next -- schema-validated batches carry string paths; the filter guards replay of foreign args. */
        locations: files
          .filter(file => typeof file.file_path === 'string')
          .map(file => ({ path: file.file_path as string, line: typeof file.offset === 'number' ? file.offset : 1 })),
      }
    },
  }))
}

/** The pre-batch singular registration the recorded-session corpus replays. */
function applyLegacyReadTool(ctx: Context, caps: ReadToolCaps): void {
  ctx.systemPrompt.section({
    name: 'tool:read',
    order: ctx.systemPrompt.getSectionOrder('TOOL_READ'),
    text: ({ scope }) => ctx.tools.get('read', scope) === undefined
      ? ''
      : adviceLine('Read gives UTF-8 contents with line numbers that bash cat and sed cannot, and offset and limit keep a large file inside context. Example: read the handler file at offset 1 limit 120 before editing the error branch.'),
  })

  ctx.tools.register(defineTool({
    name: 'read',
    description: 'Read a UTF-8 text file and return line-numbered content.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to read, resolved by the filesystem backend.' },
      offset: { type: 'number', description: '1-based first line to return. Defaults to 1.' },
      limit: { type: 'number', description: `Maximum number of lines to return. Defaults to ${caps.limit}.` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          offset: { type: 'integer', required: true },
          lines: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                number: { type: 'integer', required: true },
                text: { type: 'string', required: true },
              },
            },
          },
          totalLines: { type: 'integer', required: true },
        },
      },
      render: (args, value) => {
        const input = parseReadArgs(args, caps.limit)
        const endLine = value.lines.at(-1)?.number ?? Math.max(0, value.offset - 1)
        const truncatedByBytes = value.lines.length < input.limit && endLine < value.totalLines
        return [{
          type: 'text',
          text: formatReadOutput(value.path, {
            offset: value.offset,
            lines: value.lines,
            totalLines: value.totalLines,
            ...truncatedByBytes ? { truncatedByBytes: true } : {},
          }),
        }]
      },
      // Project the structured window into persisted `meta` so a UI's read card
      // survives replay: the raw canonical output object is not on the wire, only
      // the model-facing text, from which the line/lang data cannot be recovered.
      presentationMeta: (_args, value) => {
        const lang = langFromPath(value.path)
        return {
          path: value.path,
          offset: value.offset,
          lines: value.lines.map(({ number, text }) => ({ number, text })),
          totalLines: value.totalLines,
          ...lang === undefined ? {} : { lang },
        }
      },
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      return executeReadWindow(ctx, exec, caps, parseReadArgs(args, caps.limit))
    },
    // Result-time display: a `read` card carrying the structured line window a
    // capable UI renders as a line-numbered, syntax-highlighted view. The
    // structured data is narrowed from the persisted `meta` (replay-safe); the
    // envelope-stripped model-facing text rides along as `content` so a UI without
    // the read capability still shows the file text. A malformed or absent meta,
    // or a result whose text is not the read envelope, declines to `undefined`
    // (the generic fallback), never throwing on replay of obsolete logged output.
    presentResult(_args, result: ToolResult): ReadResultView | undefined {
      if (result.isError) return undefined
      const meta = readMetaFromMeta(result.meta)
      if (meta === undefined) return undefined
      const only = result.content.length === 1 ? result.content[0] : undefined
      const text = only?.type === 'text' ? only.text : undefined
      if (text === undefined) return undefined
      // Group 1 always captures (possibly empty) when the envelope matches.
      const body = /^<path>[^\n]*<\/path>\n<type>file<\/type>\n<content>\n([\s\S]*)\n<\/content>$/u.exec(text)?.[1]
      if (body === undefined) return undefined
      return {
        card: 'read',
        path: meta.path,
        offset: meta.offset,
        lines: meta.lines,
        totalLines: meta.totalLines,
        ...meta.lang === undefined ? {} : { lang: meta.lang },
        content: [{ type: 'text', text: body }],
      }
    },
    // Pure display: a generic card titled by the file with the read window appended (`Read
    // foo.txt (5 - 8)`), `read` kind (icon), and a follow-along location whose line is the
    // read's offset (defaulting to 1). The window reflects raw args, so an omitted limit keeps
    // the title bare instead of smuggling config into this pure presenter.
    presentCall(args): GenericCallView {
      const { offset, limit } = args
      const window = limit !== undefined && limit > 0
        ? ` (${offset ?? 1} - ${(offset ?? 1) + limit - 1})`
        : offset !== undefined ? ` (from line ${offset})` : ''
      return {
        card: 'generic',
        title: `Read ${args.file_path}${window}`,
        kind: 'read',
        locations: [{ path: args.file_path, line: offset ?? 1 }],
      }
    },
  }))
}
