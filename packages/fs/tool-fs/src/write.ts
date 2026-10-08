/**
 * Model-facing unified file mutator: one sed-like tool for create, replace, and
 * patch. `content` alone creates or fully replaces the file; `edits` alone runs
 * sed-style entries (literal, regex, line-range, insert) against the current
 * disk text; together, `content` seeds the stream and the entries patch it
 * before the single atomic commit. The shipped face is the `files` batch:
 * elements dispatch in written order, each committing its own program
 * atomically — a failed element settles into its frame while later elements
 * still run (partial commit by construction; every element re-checks the target
 * against observed state). Config `legacyFaces` re-registers the pre-batch
 * singular call for recorded-session replay, whose committed model behavior
 * never batches. The intent slot supplies the guard — the loaded strict policy
 * first, else the tool-owned gate (observed-version CAS, explicit `overwrite`
 * flag for unread content writes, fresh stat basis for programs) — and an
 * element's `dry_run` previews without committing.
 * @module @deepseek-ai/dsh-tool-fs/src/write
 */

import type { Context } from '@deepseek-ai/cordis'
import { adviceLine } from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { DiffCallView, DiffResultView, FileDiff, ToolExecution, ToolResult } from '@deepseek-ai/dsh-tools'
import type { FsWriteOutcome } from '@deepseek-ai/dsh-fs'
import type { } from '@deepseek-ai/dsh-fs'
// Type-only: `ctx.get('checkpoint')` resolves to the capture service when it is mounted.
import type { } from '@deepseek-ai/dsh-checkpoint'
import { computeHunkDiffs, diffsFromMeta } from './diff.ts'
import { remediateFsError } from './error.ts'
import type { ToolOwnedGate } from './gate.ts'
import { applyProgram, compileProgram } from './program.ts'
import type { RawProgramEntry } from './program.ts'
import { FRAME_COORD_PROPERTIES } from './read.ts'
import { sessionResolveOptions } from './session-cwd.ts'

/**
 * The multi/singular title both batch presenters derive from the elements.
 * @param files - the schema-validated batch elements.
 * @returns the diff-card title naming the first element and the count.
 */
function batchWriteTitle(files: RawWriteElement[]): string {
  /* v8 ignore next -- replay of obsolete singular args cannot name a batched first element; the soft validator declines first. */
  const first = typeof files[0]?.file_path === 'string' ? (files[0] as RawWriteElement).file_path as string : '<invalid>'
  return files.length > 1
    ? `${files.length} writes: ${first}`
    : files[0]?.edits !== undefined ? `Patch ${first}` : `Write ${first}`
}

/**
 * The intended hunks of every element: one per `content`, one per `edits` entry;
 * the pending card's view and the meta-less replay fallback.
 * @param files - the schema-validated batch elements.
 * @returns the element-order hunks.
 */
function intendedWriteDiffs(files: RawWriteElement[]): FileDiff[] {
  return files.flatMap((element) => {
    /* v8 ignore next -- schema-validated batches carry string paths; the fallback guards replay of foreign args. */
    const path = typeof element.file_path === 'string' ? element.file_path : '<invalid>'
    if (typeof element.content === 'string') return [{ path, oldText: null, newText: element.content }]
    return presentEntrySnippets(element.edits as RawProgramEntry[] | undefined)
      .map(snippet => ({ path, ...snippet }))
  })
}
import type { FsSandboxController } from './sandbox.ts'

/**
 * Validate value constraints the schema DSL can't express: only a non-blank
 * `file_path` — an empty `content` is legitimate (it writes an empty file), and
 * at least one arm must be present.
 * @param args - the schema-validated raw tool arguments.
 * @returns the path after the emptiness check.
 */
export function parseWriteArgs(args: { file_path: string; content?: string; edits?: unknown }): { filePath: string } {
  if (args.file_path.trim().length === 0) throw new Error('file_path must be a non-empty string')
  if (args.content === undefined && args.edits === undefined) {
    throw new Error('provide content, edits, or both — a write with neither is a no-op')
  }
  return { filePath: args.file_path }
}

/**
 * Format a write outcome as one model-facing text block body.
 * @param displayPath - the backend-resolved path rendered in the envelope's `<path>` element.
 * @param line - the outcome summary line (created/updated/edits applied/dry-run wording).
 * @returns the model-facing confirmation envelope (no file content is echoed back).
 */
export function formatWriteOutput(displayPath: string, line: string): string {
  return `<path>${displayPath}</path>
<type>file</type>
<content>
${line}
</content>`
}

/** One schema-validated `files` array element of the batched face. */
export interface RawWriteElement {
  file_path?: unknown
  content?: unknown
  overwrite?: unknown
  edits?: unknown
  dry_run?: unknown
}

/** The validated arguments one element carries into the shared executor. */
export interface WriteElementArgs {
  file_path: string
  content?: string
  overwrite?: boolean
  edits?: RawProgramEntry[]
  dry_run?: boolean
}

/** One settled labeled slot of a batched write call. */
export interface WriteFrameRecord {
  /** The element's 0-based position in the batch. */
  index: number
  /** The requested path (or `<invalid>` when the element carried none). */
  file_path: string
  /** How the element settled: `written` (committed or previewed), `error`, or `not-run`. */
  kind: string
  /** The backend-resolved display path. */
  path?: string
  /** The target's content before the commit, null for creates and previews. */
  before?: string | null
  /** The committed or previewed content. */
  after?: string
  /** Whether the element committed; previews report false. */
  committed?: boolean
  /** Per-entry match accounting of the element's program. */
  outcomes?: { index: number; kind: string; matches: number }[]
  /** The settled error text of a failed element. */
  message?: string
  /** Why a skipped element did not run. */
  reason?: string
}

/** One diff snippet per entry for the pending call card. */
function presentEntrySnippets(edits: RawProgramEntry[] | undefined): { oldText: string | null; newText: string }[] {
  return (edits ?? []).map(entry => entry.old_string !== undefined
    ? { oldText: entry.old_string || null, newText: entry.new_string ?? '' }
    : entry.pattern !== undefined
      ? { oldText: `/${entry.pattern}/`, newText: entry.new_string ?? '' }
      : entry.after_line !== undefined
        ? { oldText: null, newText: entry.new_string ?? '' }
        : { oldText: `lines ${entry.first_line}-${entry.last_line}`, newText: entry.new_string ?? '' })
}

/**
 * The `write` tool's validated arguments: the base parameters, the explicit
 * overwrite flag, dry_run, plus the escalation fields advertised only under a
 * confining `ctx.fs` (absent from the schema otherwise, so the validator rejects
 * them before `execute`).
 */
interface WriteToolArgs {
  file_path: string
  content?: string
  overwrite?: boolean
  edits?: RawProgramEntry[]
  dry_run?: boolean
  sandbox_permissions?: string
  justification?: string
}

/** The unified write tool's structured result for one element. */
export interface WriteToolResult {
  path: string
  before: string | null
  after: string
  committed: boolean
  outcomes: { index: number; kind: string; matches: number }[]
}

/**
 * Render one settled write frame section: the header, then the element's
 * confirmation envelope for committed or previewed writes, or the frame's marker
 * line — so each section parses with the same anchor contract as a one-file
 * result.
 * @param frames - the settled element outcomes, in submission order.
 * @returns the model-facing sectioned text.
 */
export function renderWriteFrames(frames: readonly WriteFrameRecord[]): string {
  return frames.map((frame) => {
    const header = `[${frame.index + 1}/${frames.length}] ${frame.file_path}`
    if (frame.kind === 'written') {
      return `${header}\n${formatWriteOutput(frame.path ?? frame.file_path, formatOutcomeLine({
        path: frame.path ?? frame.file_path,
        before: frame.before ?? null,
        after: frame.after ?? '',
        committed: frame.committed === true,
        outcomes: frame.outcomes ?? [],
      }))}`
    }
    if (frame.kind === 'error') return `${header}\n[error: ${frame.message ?? ''}]`
    return `${header}\n[not run: ${frame.reason ?? ''}]`
  }).join('\n')
}

/**
 * Run one element's complete write program: validate, compile before I/O,
 * resolve the target, decide intent through the gate waterfall, apply, and
 * commit (or preview under `dry_run`). Throws on any failure; the frames face
 * settles the throw into the element's frame.
 * @param ctx - the plugin context supplying the `fs` service and the intent waterfall.
 * @param sandbox - the shared sandbox-escalation API for denial mapping.
 * @param gate - the tool-owned gate supplying the default write intent.
 * @param exec - the tool-execution context (agent, callId, signal).
 * @param sandboxPolicy - the call-level resolved policy to stamp onto the mutation.
 * @param args - the element's validated-to-schema arguments.
 * @returns the element's structured result.
 */
export async function runWriteProgram(
  ctx: Context,
  sandbox: FsSandboxController,
  gate: ToolOwnedGate,
  exec: ToolExecution,
  sandboxPolicy: Awaited<ReturnType<FsSandboxController['resolvePolicy']>>,
  args: WriteElementArgs,
): Promise<WriteToolResult> {
  const { filePath } = parseWriteArgs(args)
  // Compile before any I/O: a malformed program never reaches the provider.
  const program = compileProgram({ content: args.content, edits: args.edits })
  const target = await ctx.fs.resolve(filePath, sessionResolveOptions(exec, filePath, sandboxPolicy?.workspaceRoot))

  if (args.dry_run === true) {
    // Preview by design bypasses the guards the real commit enforces; a
    // missing preview target reports the same FS_NOT_FOUND a read gives.
    try {
      const stream = args.content ?? await ctx.fs.readText(target, exec.signal)
      const applied = program.entries.length === 0
        ? { after: stream, outcomes: [] }
        : applyProgram(stream, program.entries)
      return { path: target.displayPath, before: null, after: applied.after, committed: false, outcomes: applied.outcomes }
    } catch (error: unknown) {
      throw remediateFsError(sandbox.mapError(error, sandboxPolicy), target.displayPath)
    }
  }

  let outcome: FsWriteOutcome
  let outcomes: WriteToolResult['outcomes']
  try {
    // Single-slot decision: a loaded strict policy decides outright; the
    // default is the tool-owned gate over observed state — CAS at the
    // observed version, createIfAbsent for absent, fresh-stat CAS for
    // unobserved programs, and FS_OVERWRITE_DENIED for unobserved content
    // writes without the flag. The slot can reject, so it sits inside the
    // try with the provider call.
    const intent = await ctx.waterfall(
      'fs/write-intent',
      target,
      program.mode,
      exec,
      () => gate.writeIntent(target, program.mode, exec, args.overwrite === true, exec.signal),
    )
    const stream = program.entries.length === 0
      ? args.content ?? ''
      : (args.content ?? await ctx.fs.readText(target, exec.signal))
    const applied = program.entries.length === 0
      ? { after: stream, outcomes: [] }
      : applyProgram(stream, program.entries)
    outcomes = applied.outcomes
    outcome = await ctx.fs.writeText(target, applied.after, intent, exec.signal, sandboxPolicy)
  } catch (error: unknown) {
    // A sandbox denial becomes the shared [sandbox: …] marker (the model
    // recognizes it from bash); guarded mutation failures — including the
    // gate's overwrite denial thrown in the default above — receive their
    // stable model-facing diagnostic; anything else passes through.
    throw remediateFsError(sandbox.mapError(error, sandboxPolicy), target.displayPath)
  }
  ctx.emit('fs/observed', target, { kind: 'present', version: outcome.version }, exec)
  await ctx.get('checkpoint')?.captureWrite(exec, { path: target.displayPath, before: outcome.before, after: outcome.after })
  return {
    path: target.displayPath,
    before: outcome.before,
    after: outcome.after,
    committed: true,
    outcomes,
  }
}

/**
 * Validate one `files` element the schema DSL can't express: a non-blank
 * `file_path` string and at least one arm, plus boolean/entry re-typing.
 * @param raw - one schema-validated array element.
 * @returns the typed element arguments.
 */
export function parseWriteElement(raw: RawWriteElement): WriteElementArgs {
  if ((raw.file_path as string).trim().length === 0) {
    throw new Error('file_path must be a non-empty string')
  }
  if (raw.content === undefined && raw.edits === undefined) {
    throw new Error('provide content, edits, or both — a write with neither is a no-op')
  }
  return {
    file_path: raw.file_path as string,
    ...typeof raw.content === 'string' ? { content: raw.content } : {},
    ...raw.overwrite === true ? { overwrite: true } : {},
    ...Array.isArray(raw.edits) ? { edits: raw.edits as RawProgramEntry[] } : {},
    ...raw.dry_run === true ? { dry_run: true } : {},
  }
}

/**
 * Register the unified `write` tool and its scope-aware system-prompt guidance.
 * The shipped face is the `files` batch; `legacy` re-registers the pre-batch
 * singular call for recorded-session replay compositions.
 * @param ctx - the plugin context; registrations are effects scoped to it, and execution uses its `fs` service.
 * @param sandbox - the shared sandbox-escalation API (advertisement, mode stamping, denial mapping).
 * @param gate - the tool-owned gate supplying the default write intent.
 * @param maxFiles - the configured maximum number of elements one batched call accepts.
 * @param legacy - register the singular pre-batch face instead of the batch.
 */
export function applyWriteTool(ctx: Context, sandbox: FsSandboxController, gate: ToolOwnedGate, maxFiles: number, legacy = false): void {
  if (legacy) {
    applyLegacyWriteTool(ctx, sandbox, gate)
    return
  }
  ctx.systemPrompt.section({
    name: 'tool:write',
    order: ctx.systemPrompt.getSectionOrder('TOOL_WRITE'),
    text: ({ scope }) => ctx.tools.get('write', scope) === undefined
      ? ''
      : adviceLine('Write creates, replaces, or patches UTF-8 text files; pass every file this step changes as one `files` element — each element carries its own content or sed-style edits entries (literal old_string, regex pattern, line range, insert after_line) and commits atomically, elements dispatch in written order, and a failing element settles into its frame while later elements still run. Overwriting a file this session never read needs overwrite: true on that element, and dry_run previews one element without committing. Example: write two new fixture files as two elements once their shapes are agreed.'),
  })

  ctx.tools.register(defineTool({
    name: 'write',
    description: 'Create, replace, or patch several UTF-8 text files in one call; each `files` element runs its sed-style program in written order and commits atomically, settling into its own labeled frame — a failed element does not stop later ones.',
    parameters: {
      files: {
        type: 'array',
        required: true,
        description: 'The files to write, in written order. Independent file changes of one thought belong in one call; an element that edits a file another element creates or edits addresses that element\'s result, since elements see earlier commits.',
        items: EDITS_ITEM_SHAPE,
      },
      ...sandbox.escalationModes.length > 0 ? sandbox.schemaFields() : {},
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
                before: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                after: { type: 'string' },
                committed: { type: 'boolean' },
                outcomes: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      index: { type: 'integer', required: true },
                      kind: { type: 'string', required: true },
                      matches: { type: 'integer', required: true },
                    },
                  },
                },
                message: { type: 'string' },
                reason: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderWriteFrames(value.frames) }],
      // Persist one diff hunk set per committed element so the Web diff card
      // survives replay; previews and failures carry no diffs.
      presentationMeta: (_args, value) => ({
        frames: value.frames.flatMap((frame) => {
          if (frame.kind !== 'written' || frame.before === null || frame.before === undefined || frame.after === undefined) return []
          return [{
            index: frame.index,
            diffs: computeHunkDiffs(frame.file_path, frame.before, frame.after)
              .map(({ path, oldText, newText }) => ({ path, oldText, newText })),
          }]
        }),
      }),
    },
    async execute(args, exec) {
      const files = parseWriteBatch(args.files as RawWriteElement[], maxFiles)
      // Resolve the per-call sandbox policy (approved mode > session override
      // > backend default, plus the session cwd root) BEFORE anything executes;
      // an escalating call throws its distinct text on any non-grant.
      const sandboxPolicy = await sandbox.resolvePolicy('write', args, exec)
      const frames: WriteFrameRecord[] = []
      for (const [index, raw] of files.entries()) {
        let element: WriteElementArgs
        try {
          element = parseWriteElement(raw)
        } catch (error: unknown) {
          frames.push({
            index,
            file_path: raw.file_path as string,
            kind: 'error',
            message: error instanceof Error ? error.message : String(error),
          })
          continue
        }
        if (exec.signal.aborted) {
          frames.push({ index, file_path: element.file_path, kind: 'not-run', reason: 'call aborted' })
          continue
        }
        try {
          const result = await runWriteProgram(ctx, sandbox, gate, exec, sandboxPolicy, element)
          frames.push({
            index,
            file_path: element.file_path,
            kind: 'written',
            path: result.path,
            before: result.before,
            after: result.after,
            committed: result.committed,
            outcomes: result.outcomes,
          })
        } catch (error: unknown) {
          exec.signal.throwIfAborted()
          frames.push({ index, file_path: element.file_path, kind: 'error', message: error instanceof Error ? error.message : String(error) })
        }
      }
      return { frames }
    },
    // Pure display: one diff card listing every element's intended hunks.
    presentCall(args): DiffCallView {
      const files = (args.files ?? []) as RawWriteElement[]
      return {
        card: 'diff',
        title: batchWriteTitle(files),
        diffs: intendedWriteDiffs(files),
        locations: files
          .filter(element => typeof element.file_path === 'string')
          .map(element => ({ path: element.file_path as string })),
      }
    },
    // Result-time display repeats the intended diffs; applied hunks ride meta.
    presentResult(args, result: ToolResult): DiffResultView | undefined {
      if (result.isError) return undefined
      const files = (args.files ?? []) as RawWriteElement[]
      return {
        card: 'diff',
        title: batchWriteTitle(files),
        diffs: diffsFromMeta(result.meta) ?? intendedWriteDiffs(files),
      }
    },
  }))
}

/** The four sed-style entry forms, shared verbatim by both faces. */
const EDITS_ENTRIES_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        old_string: { type: 'string', required: true, description: 'Literal match: the exact text to find. Must appear exactly once unless replace_all is true.' },
        new_string: { type: 'string', description: 'Replacement text; omitted or empty deletes each match.' },
        replace_all: { type: 'boolean', description: 'Replace every match instead of requiring exactly one. Defaults to false.' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        pattern: { type: 'string', required: true, description: 'JavaScript regular-expression source matched against the text. Group references in new_string use $1 style.' },
        new_string: { type: 'string', description: 'Replacement text, $1-style groups allowed; omitted or empty deletes each match.' },
        replace_all: { type: 'boolean', description: 'Replace the first only. Defaults to false.' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        first_line: { type: 'integer', required: true, description: 'First (1-based, inclusive) of the lines to replace or delete; addresses the text after earlier entries.' },
        last_line: { type: 'integer', required: true, description: 'Last (1-based, inclusive) of the lines to replace or delete; must be >= first_line.' },
        new_string: { type: 'string', description: 'Lines to substitute for the range; omitted or empty deletes the range.' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        after_line: { type: 'integer', required: true, description: 'Insert new_string as new lines after this 1-based line; 0 inserts at the top, the file line count appends at the end.' },
        new_string: { type: 'string', required: true, description: 'The lines to insert; required non-empty for this form.' },
      },
    },
  ],
} as const

/** The element item schema, shared verbatim by both faces. */
const EDITS_ITEM_SHAPE = {
  type: 'object',
  additionalProperties: false,
  properties: {
    file_path: { type: 'string', required: true, description: 'Path of the file to write, resolved by the filesystem backend.' },
    content: {
      type: 'string',
      description: 'The element\'s input stream. Without edits, creates or fully replaces the file; with edits, this text — not the current disk content — is what the entries operate on.',
    },
    overwrite: {
      type: 'boolean',
      description: 'CLI -f style for this element: explicitly allow content to replace an existing file this session has not read. Never needed for new files, for files read or written this session, or for edits-only elements; operations stay atomic against concurrent changes either way.',
    },
    edits: {
      type: 'array',
      description: 'Sed-style operations applied in order and committed atomically for this element; later entries address the text produced by earlier ones. A failed entry fails the element and reports its index in the frame.',
      items: EDITS_ENTRIES_SCHEMA,
    },
    dry_run: {
      type: 'boolean',
      description: 'Run this element\'s program in memory and commit nothing: returns the would-be content and per-entry match counts, bypassing the guards the real commit enforces.',
    },
  },
} as const

/**
 * Validate the batch envelope the schema DSL can't express: at least one
 * element, at most the configured cap.
 * @param files - the schema-validated `files` array.
 * @param maxFiles - the configured element cap.
 * @returns the element list after the length guards.
 */
export function parseWriteBatch(files: RawWriteElement[], maxFiles: number): RawWriteElement[] {
  if (files.length === 0) throw new Error('files must contain at least one element')
  if (files.length > maxFiles) throw new Error(`files must contain at most ${maxFiles} elements`)
  return files
}

/** The pre-batch singular registration the recorded-session corpus replays. */
function applyLegacyWriteTool(ctx: Context, sandbox: FsSandboxController, gate: ToolOwnedGate): void {
  ctx.systemPrompt.section({
    name: 'tool:write',
    order: ctx.systemPrompt.getSectionOrder('TOOL_WRITE'),
    text: ({ scope }) => ctx.tools.get('write', scope) === undefined
      ? ''
      : adviceLine('Write creates, replaces, or patches a UTF-8 text file, sed-style: content seeds the file and edits entries — literal (old_string), regex (pattern), line range (first_line/last_line), insert (after_line) — apply sequentially in one atomic commit; overwriting a file this session never read needs overwrite: true, and dry_run previews without committing. Example: write a new fixture file once the shape is agreed.'),
  })

  ctx.tools.register(defineTool({
    name: 'write',
    description: 'Create, replace, or patch one UTF-8 text file; sed-style entries batch atomically.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path of the file to write, resolved by the filesystem backend.' },
      content: {
        type: 'string',
        description: 'The input stream. Without edits, creates or fully replaces the file; with edits, this text — not the current disk content — is what the entries operate on.',
      },
      overwrite: {
        type: 'boolean',
        description: 'CLI -f style: explicitly allow content to replace an existing file this session has not read. Never needed for new files, for files read or written this session, or for edits-only calls; operations stay atomic against concurrent changes either way.',
      },
      edits: {
        type: 'array',
        description: 'Sed-style operations applied in order and committed atomically; later entries address the text produced by earlier ones. A failed entry commits nothing and reports its index. Use dry_run to preview.',
        items: EDITS_ENTRIES_SCHEMA,
      },
      dry_run: {
        type: 'boolean',
        description: 'Run the whole program in memory and commit nothing: returns the would-be content and per-entry match counts, bypassing the guards the real commit enforces.',
      },
      ...sandbox.escalationModes.length > 0 ? sandbox.schemaFields() : {},
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          before: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
          after: { type: 'string', required: true },
          committed: { type: 'boolean', required: true },
          outcomes: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                index: { type: 'integer', required: true },
                kind: { type: 'string', required: true },
                matches: { type: 'integer', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: formatWriteOutput(value.path, formatOutcomeLine(value)),
      }],
      presentationMeta: (args, value) => ({
        diffs: value.before === null
          ? []
          : computeHunkDiffs(args.file_path, value.before, value.after)
            .map(({ path, oldText, newText }) => ({ path, oldText, newText })),
      }),
    },
    async execute(args: WriteToolArgs, exec) {
      // Resolve the per-call sandbox policy (approved mode > session override
      // > backend default, plus the session cwd root) BEFORE anything executes;
      // an escalating call throws its distinct text on any non-grant.
      const sandboxPolicy = await sandbox.resolvePolicy('write', args, exec)
      return runWriteProgram(ctx, sandbox, gate, exec as never, sandboxPolicy, args)
    },
    // Pure display: a diff card per hunk; whole-file content shows the full new
    // text with a null old side (the presenter has no prior content).
    presentCall(args): DiffCallView {
      return {
        card: 'diff',
        title: args.edits !== undefined ? `Patch ${args.file_path}` : `Write ${args.file_path}`,
        diffs: args.content !== undefined
          ? [{ path: args.file_path, oldText: null, newText: args.content }]
          : presentEntrySnippets(args.edits).map(snippet => ({ path: args.file_path, ...snippet })),
        locations: [{ path: args.file_path }],
      }
    },
    // Result-time display repeats the diff because completed views replace the
    // pending view. Creates and identical overwrites use the replay-safe args
    // fallback when applied metadata is absent.
    presentResult(args, result: ToolResult): DiffResultView | undefined {
      if (result.isError) return undefined
      const diffs = diffsFromMeta(result.meta)
        ?? (args.content !== undefined
          ? [{ path: args.file_path, oldText: null, newText: args.content }]
          : presentEntrySnippets(args.edits).map(snippet => ({ path: args.file_path, ...snippet })))
      return {
        card: 'diff',
        title: args.edits !== undefined ? `Patch ${args.file_path}` : `Write ${args.file_path}`,
        diffs,
      }
    },
  }))
}

function formatOutcomeLine(value: WriteToolResult): string {
  if (!value.committed) {
    return `Dry run — no commit. ${value.outcomes.length} entr${value.outcomes.length === 1 ? 'y' : 'ies'} would apply.`
  }
  if (value.outcomes.length === 0) {
    return value.before === null ? 'Created file' : 'Updated file'
  }
  const matches = value.outcomes.reduce((total, entry) => total + entry.matches, 0)
  return `Updated file. ${value.outcomes.length} edits applied (${matches} matches).`
}
