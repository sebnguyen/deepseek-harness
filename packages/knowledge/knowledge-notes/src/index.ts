/**
 * File-anchored durable knowledge notes. One JSON note per source file under
 * the harness home; a pointer line attached to every `read` of a noted file;
 * `read_note` and `upsert_note` as the whole authoring surface; one serial
 * turn-boundary notice per turn for noted files the turn changed. Nothing
 * model-visible adds a session event type: injections ride
 * `agent/inbox/spliced` and the tools log ordinary `tool/call`/`tool/result`
 * records, so replay never reads the store.
 * @module @deepseek-ai/dsh-knowledge-notes
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { join } from 'node:path'
// Type-only: resolves the service declarations this plugin reads or calls.
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import type { SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { PostToolDecision, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { z as zod } from 'zod'
import { sourceHash } from './hash.ts'
import { NoteStore } from './store.ts'
import { HASH_SCHEME } from './types.ts'
import type { KnowledgeNotesTurnState, NoteState } from './types.ts'

export type { NoteRecord, NoteState } from './types.ts'
export { NoteStore } from './store.ts'
export { normalizeSource, sourceHash } from './hash.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'knowledge-notes'

/** Services required by the note store, the two tools, and the two listeners. */
export const inject = ['fs', 'tools', 'systemPrompt', 'sessionProjections']

/** Plugin configuration. */
export interface Config {
  /** Harness-home override; the store lives under `<home>/knowledge/notes`. */
  dshHome?: string
}

export const Config: z<Config> = z.object({ dshHome: z.string() })

/** Load-bearing label: an unlabeled context renders as an ordinary user prompt in derived history. */
const PLUGIN_SOURCE: { kind: 'plugin'; plugin: string } = { kind: 'plugin', plugin: 'knowledge-notes' }

/** Model-visible text head of the refresh obligation; the projection folds on it, so it is pinned. */
const OBLIGATION_HEAD = 'File notes need re-checking:'

/**
 * The one prompt sentence this plugin registers; the tool schemas carry the
 * rest of the contract. Late fixed order: the note rule refines tool use, it
 * does not introduce the tools.
 */
const NOTE_SECTION_ORDER = 90
const SECTION_TEXT = 'A source file may carry one durable note — one fact worth knowing before changing it. '
  + 'Read pointers name noted files; use `read_note` to fetch a note and `upsert_note` to write, update, or remove one.'

/** Tools whose successful call changes a file's content and can stale a note. */
const MUTATING_TOOL_NAMES = new Set(['write', 'str_replace_editor'])

/**
 * Extract the source-file path one mutating tool call touched.
 * @param name - the called tool's name.
 * @param args - the call's parsed arguments.
 * @returns the raw path argument, or `undefined` for a non-touching call.
 */
function touchedPath(name: string, args: Record<string, unknown>): string | undefined {
  if (name === 'str_replace_editor') {
    // `view` is a read wearing the editor's schema; only its mutating commands touch content.
    return args.command !== 'view' && typeof args.path === 'string' ? args.path : undefined
  }
  return typeof args.file_path === 'string' ? args.file_path : undefined
}

/** Zod face of the projection state, for persisted-cache validation. */
const turnStateSchema: zod.ZodType<KnowledgeNotesTurnState> = zod.object({
  touched: zod.array(zod.object({ turn: zod.number(), path: zod.string() })),
  steered: zod.boolean(),
})

/**
 * Per-turn fold: which source files this turn's mutating tool calls touched,
 * and whether the refresh obligation already went out. Both facts are derived
 * from the log — the projection is the store of record, and this plugin keeps
 * no per-session map of its own.
 */
/** Exported for tests and future host consumers; registered once in {@link apply}. */
export const knowledgeNotesProjection = {
  key: 'knowledgeNotes',
  stateVersion: 1,
  stateSchema: turnStateSchema,
  init: () => ({ touched: [], steered: false }),
  apply: (state: KnowledgeNotesTurnState, event: SessionEvent): KnowledgeNotesTurnState => {
    switch (event.type) {
      case 'turn/start':
        return { touched: [], steered: false }
      case 'tool/call': {
        if (!MUTATING_TOOL_NAMES.has(event.data.name)) return state
        let args: Record<string, unknown>
        try {
          args = JSON.parse(event.data.arguments) as Record<string, unknown>
        } catch {
          // `tool/call` arguments are validated JSON at append; a parse failure
          // means a foreign writer, and a dropped touch beats a broken fold.
          return state
        }
        const path = touchedPath(event.data.name, args)
        if (path === undefined) return state
        return { ...state, touched: [...state.touched, { turn: event.data.turn, path }] }
      }
      case 'user/message': {
        // The obligation's own logged message is its dedupe record: read-time
        // pointers carry the same plugin source, so only the pinned head counts.
        const text = event.data.content.find(block => block.type === 'text')
        if (text?.type !== 'text' || !text.text.startsWith(OBLIGATION_HEAD) || state.steered) return state
        return { ...state, steered: true }
      }
      default:
        return state
    }
  },
} satisfies ProjectionDefinition<'knowledgeNotes'>

/**
 * Render the one pinned pointer line for a note's state. Each string must
 * stand alone: it names the file and tells the model how to fetch the note,
 * stripped of any transcript chrome around it.
 * @param displayPath - absolute path of the source file.
 * @param notePath - absolute path of the note file.
 * @param state - the note's display freshness.
 * @returns the pointer line.
 */
function renderPointer(displayPath: string, notePath: string, state: NoteState): string {
  switch (state) {
    case 'live': return `Note for ${displayPath} (current): ${notePath}`
    case 'stale': return `Note for ${displayPath} is stale — the file changed since this note was written. Read it with read_note before relying on it.`
    case 'orphaned': return `Note for ${displayPath} is orphaned — the file it describes is gone. Read it with read_note before relying on it.`
  }
}

/** Build `resolve` options without tripping `exactOptionalPropertyTypes` on an absent cwd. */
function resolveOpts(exec: ToolExecution): { cwd?: string; signal: AbortSignal } {
  const cwd = exec.agent?.session.header.cwd
  return cwd === undefined ? { signal: exec.signal } : { cwd, signal: exec.signal }
}

/** Prepend `ours` to an inherited context list without mutating the downstream decision. */
function prependContext(ours: UserMessage, theirs: UserMessage[] | undefined): UserMessage[] {
  return theirs === undefined ? [ours] : [ours, ...theirs]
}

/**
 * Compose the pointer message for a `read` of a noted file.
 * @param ctx - the plugin context carrying the `fs` capability.
 * @param store - the note store.
 * @param exec - the completed `read` execution.
 * @returns the pointer user message, or `undefined` when the read surfaces none.
 */
async function pointerMessage(ctx: Context, store: NoteStore, exec: ToolExecution): Promise<UserMessage | undefined> {
  if (exec.agent === undefined) return undefined
  const target = await ctx.fs.resolve((exec.arguments as { file_path: string }).file_path, resolveOpts(exec))
  const note = await store.forTarget(target, exec.signal)
  if (note === undefined) return undefined
  const state = await store.stateOf(target, note, exec.signal)
  return createUserMessage({
    content: [{ type: 'text', text: renderPointer(target.displayPath, store.notePathFor(target.displayPath), state) }],
    source: { ...PLUGIN_SOURCE, form: 'notice', summary: boundContextSummary(`file note: ${target.displayPath}`) },
  })
}

/**
 * Register the `read_note` and `upsert_note` tools — the whole authoring
 * surface. The model names only source-file paths; the store layout never
 * appears in an argument, a result, or the prompt.
 * @param ctx - the plugin context carrying the `fs` capability.
 * @param store - the note store.
 */
function registerNoteTools(ctx: Context, store: NoteStore): void {
  ctx.tools.register(defineTool({
    name: 'read_note',
    description: 'Read the durable note attached to a source file. Notes record one non-obvious fact '
      + 'worth knowing before changing the file, and report live, stale, or orphaned against the file\'s current content.',
    parameters: {
      target: {
        type: 'string',
        required: true,
        description: 'Path of the source file whose note to read — the same path you would pass to `read`.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          found: { type: 'boolean', required: true },
          state: { type: 'string', enum: ['live', 'stale', 'orphaned'] },
          claim: { type: 'string' },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: value.found ? `Note for ${args.target} (${value.state}): ${value.claim}` : `No note for ${args.target}.`,
      }],
    },
    async execute(args, exec) {
      const target = await ctx.fs.resolve(args.target, resolveOpts(exec))
      const note = await store.forTarget(target, exec.signal)
      if (note === undefined) return { found: false }
      return { found: true, state: await store.stateOf(target, note, exec.signal), claim: note.claim }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'upsert_note',
    description: 'Write, update, or remove the durable note for one source file. One note per file. '
      + 'State one fact worth knowing before changing the file; the harness stamps the note with the file\'s current '
      + 'content hash, so never compute or pass a hash. An empty `claim` removes the note.',
    parameters: {
      target: {
        type: 'string',
        required: true,
        description: 'Path of the source file the note describes — the same path you would pass to `read`.',
      },
      claim: {
        type: 'string',
        required: true,
        description: 'The one fact worth knowing, as prose that stands alone. The empty string removes the note.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          deleted: { type: 'boolean', required: true },
          target: { type: 'string', required: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: value.deleted ? `Removed the note for ${args.target}.` : `Note for ${args.target} affirmed.`,
      }],
    },
    async execute(args, exec) {
      const target = await ctx.fs.resolve(args.target, resolveOpts(exec))
      if (args.claim === '') {
        await store.remove(target, exec.signal)
        return { deleted: true, target: target.displayPath }
      }
      if (await ctx.fs.stat(target, exec.signal) === undefined) {
        throw new Error(`cannot affirm a note for "${target.displayPath}": the file does not exist`)
      }
      await store.put({
        target: target.displayPath,
        claim: args.claim,
        affirmedAgainst: sourceHash(await ctx.fs.readText(target, exec.signal)),
        hashScheme: HASH_SCHEME,
        author: 'agent',
      }, exec.signal)
      return { deleted: false, target: target.displayPath }
    },
  }))
}

/**
 * Mount the knowledge-notes plugin: the store, the two tools, the pointer
 * listener, the serial turn-boundary notice, and the one prompt section.
 * @param ctx - mounting context.
 * @param config - validated plugin configuration.
 */
export function attachPointer(ctx: Context, store: NoteStore) {
  return async (exec: ToolExecution, _result: ToolExecutionResult, next: () => Promise<PostToolDecision>): Promise<PostToolDecision> => {
    // Observe-and-enrich, never veto: delegate first so a later listener can
    // still block or replace, then fold the pointer onto whatever came back —
    // additionalContexts rides both decision variants, so a blocked call still
    // gets the pointer.
    const downstream = await next()
    if (exec.name !== 'read') return downstream
    let pointer: UserMessage | undefined
    try {
      pointer = await pointerMessage(ctx, store, exec)
    } catch {
      // A store read that throws must never fail the read that surfaced it; the
      // pointer is enrichment, not part of the result. Unreachable on the local
      // backend, which just resolved this same path.
      // v8 ignore next 2
      return downstream
    }
    if (pointer === undefined) return downstream
    if (downstream.kind === 'block') {
      return { kind: 'block', feedback: downstream.feedback, additionalContexts: prependContext(pointer, downstream.additionalContexts) }
    }
    return { ...downstream, additionalContexts: prependContext(pointer, downstream.additionalContexts) }
  }
}

/**
 * The serial turn-boundary notice. Both inputs — the touched set and the
 * dedupe — are read from the session log, never from plugin-private state.
 * @param ctx - the plugin context carrying the `fs` capability.
 * @param store - the note store.
 * @returns the `agent/turn-stopping` listener.
 */
export function noticeRefreshObligation(ctx: Context, store: NoteStore) {
  return async ({ agent, signal }: { agent: Agent; signal: AbortSignal }): Promise<void> => {
    const state = ctx.sessionProjections.stateOf(agent.session, 'knowledgeNotes')
    if (state === undefined || state.steered || state.touched.length === 0) return
    const cwd = agent.session.header.cwd
    const affected: string[] = []
    for (const path of new Set(state.touched.map(entry => entry.path))) {
      let target: FsTarget
      try {
        target = await ctx.fs.resolve(path, cwd === undefined ? { signal } : { cwd, signal })
      } catch {
        // v8 ignore next 2 -- a touched path the backend cannot resolve has no note to refresh.
        continue
      }
      if (await store.forTarget(target, signal) !== undefined) affected.push(target.displayPath)
    }
    if (affected.length === 0) return
    agent.steer(createUserMessage({
      content: [{ type: 'text', text: `${OBLIGATION_HEAD} ${affected.join(', ')}. Each file changed since its note was `
        + 'written. Re-read each and re-affirm or update its note with `upsert_note`, or knowingly leave it stale.' }],
      source: { ...PLUGIN_SOURCE, form: 'notice', summary: boundContextSummary(`notes to re-check: ${affected.length}`) },
    }))
  }
}

/**
 * Mount the knowledge-notes plugin: the store, the two tools, the pointer
 * listener, the serial turn-boundary notice, and the one prompt section.
 * @param ctx - mounting context.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const store = new NoteStore(ctx.fs, join(resolveDshHome(config.dshHome), 'knowledge', 'notes'))
  ctx.sessionProjections.register(knowledgeNotesProjection)
  registerNoteTools(ctx, store)
  ctx.on('tools/post-execute', attachPointer(ctx, store))
  ctx.on('agent/turn-stopping', noticeRefreshObligation(ctx, store))
  ctx.systemPrompt.section({ name: 'knowledge-notes', order: NOTE_SECTION_ORDER, text: SECTION_TEXT })
}
