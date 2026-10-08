/**
 * Model-facing unified file mutator: one sed-like tool for create, replace, and
 * patch. `content` alone creates or fully replaces the file; `edits` alone runs
 * sed-style entries (literal, regex, line-range, insert) against the current
 * disk text; together, `content` seeds the stream and the entries patch it
 * before the single atomic commit. The intent slot supplies the guard — the
 * loaded strict policy first, else the tool-owned gate (observed-version CAS,
 * explicit `overwrite` flag for unread content writes, fresh stat basis for
 * programs) — and `dry_run` previews without committing.
 * @module @deepseek-ai/dsh-tool-fs/src/write
 */

import type { Context } from '@deepseek-ai/cordis'
import { adviceLine } from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { DiffCallView, DiffResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import type { FsWriteOutcome } from '@deepseek-ai/dsh-fs'
import type { } from '@deepseek-ai/dsh-fs'
// Type-only: when mounted, `ctx.get('checkpoint')` resolves to the capture service.
import type { } from '@deepseek-ai/dsh-checkpoint'
import { computeHunkDiffs, diffsFromMeta } from './diff.ts'
import { remediateFsError } from './error.ts'
import type { ToolOwnedGate } from './gate.ts'
import { applyProgram, compileProgram } from './program.ts'
import type { RawProgramEntry } from './program.ts'
import { sessionResolveOptions } from './session-cwd.ts'
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

/** One diff snippet per entry for the pending call card. */
function presentEntrySnippets(args: WriteToolArgs): { oldText: string | null; newText: string }[] {
  return (args.edits ?? []).map(entry => entry.old_string !== undefined
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

/** The unified write tool's structured result. */
interface WriteToolResult {
  path: string
  before: string | null
  after: string
  committed: boolean
  outcomes: { index: number; kind: string; matches: number }[]
}

/**
 * Register the unified `write` tool and its scope-aware system-prompt guidance.
 * @param ctx - the plugin context; registrations are effects scoped to it, and execution uses its `fs` service.
 * @param sandbox - the shared sandbox-escalation API (advertisement, mode stamping, denial mapping).
 * @param gate - the tool-owned gate supplying the default write intent.
 */
export function applyWriteTool(ctx: Context, sandbox: FsSandboxController, gate: ToolOwnedGate): void {
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
        items: {
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
                replace_all: { type: 'boolean', description: 'Replace every match instead of the first only. Defaults to false.' },
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
        },
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
      const { filePath } = parseWriteArgs(args)
      // Compile before any I/O: a malformed program never reaches the provider.
      const program = compileProgram({ content: args.content, edits: args.edits })
      // Resolve the per-call sandbox policy (approved mode > session override
      // > backend default, plus the session cwd root) BEFORE anything executes;
      // an escalating call throws its distinct text on any non-grant.
      const sandboxPolicy = await sandbox.resolvePolicy('write', args, exec)
      const target = await ctx.fs.resolve(filePath, sessionResolveOptions(exec, filePath, sandboxPolicy?.workspaceRoot))

      if (args.dry_run === true) {
        // Preview by design bypasses the guards the real commit enforces; a
        // missing preview target reports the same FS_NOT_FOUND a read gives.
        let result: WriteToolResult
        try {
          const stream = args.content ?? await ctx.fs.readText(target, exec.signal)
          const applied = program.entries.length === 0
            ? { after: stream, outcomes: [] }
            : applyProgram(stream, program.entries)
          result = { path: target.displayPath, before: null, after: applied.after, committed: false, outcomes: applied.outcomes }
        } catch (error: unknown) {
          throw remediateFsError(sandbox.mapError(error, sandboxPolicy), target.displayPath)
        }
        return result
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
      // The write-gated snapshot capture: the committed before/after texts are
      // exactly what the write already holds, so capture never re-reads the disk.
      await ctx.get('checkpoint')?.captureWrite(exec, { path: target.displayPath, before: outcome.before, after: outcome.after })
      return {
        path: target.displayPath,
        before: outcome.before,
        after: outcome.after,
        committed: true,
        outcomes,
      }
    },
    // Pure display: a diff card per hunk; whole-file content shows the full new
    // text with a null old side (the presenter has no prior content).
    presentCall(args): DiffCallView {
      return {
        card: 'diff',
        title: args.edits !== undefined ? `Patch ${args.file_path}` : `Write ${args.file_path}`,
        diffs: args.content !== undefined
          ? [{ path: args.file_path, oldText: null, newText: args.content }]
          : presentEntrySnippets(args).map(snippet => ({ path: args.file_path, ...snippet })),
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
          : presentEntrySnippets(args).map(snippet => ({ path: args.file_path, ...snippet })))
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
