/**
 * Turn-scoped produced-file Definition and readers. Client-only and
 * model-free: the vocabulary comes from successful first-party mutation
 * calls, never presentation data or the closing prose.
 */
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'

import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PresentedFile } from '@deepseek-ai/dsh-tool-present/types'
import { basename, isPresentedData, isPresentedFile } from '../presented.ts'

/**
 * The backend-resolved absolute file paths a settled call's persisted `meta`
 * names: the tool-owned projections every fs tool stamps at return time
 * (`read`/`read_image` `path`, batched read/write `frames[].path`, write
 * `diffs[0].path`). A local value-copy of ui-tool's resolver — client
 * plugins may not import one another's values (bundle purity gate), and a
 * cordis service for one narrowing pass would be worse coupling.
 */
export function resolvedPathsFromMeta(meta: unknown): string[] {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return []
  const record = meta as Record<string, unknown>
  const paths: string[] = []
  const push = (value: unknown): void => {
    if (typeof value === 'string' && value !== '' && !paths.includes(value)) paths.push(value)
  }
  push(record.path)
  const frames = record.frames
  if (Array.isArray(frames)) {
    for (const frame of frames) {
      if (typeof frame !== 'object' || frame === null || Array.isArray(frame)) continue
      const entry = frame as Record<string, unknown>
      push(entry.path)
      const frameDiffs = entry.diffs
      if (Array.isArray(frameDiffs)) push((frameDiffs[0] as Record<string, unknown> | undefined)?.path)
    }
  }
  const diffs = record.diffs
  if (Array.isArray(diffs)) push((diffs[0] as Record<string, unknown> | undefined)?.path)
  return paths
}

/** A declared file with its authorized open coordinates. */
export interface PresentedPath extends PresentedFile {
  readonly seq: number
  readonly index: number
}

/** A path a successful call resolved or committed, stamped with its event seq. */
export interface ProducedPath {
  readonly seq: number
  readonly path: string
}

/** Immutable produced-file facts published against one Turn. */
export interface DeliverablesTurnData {
  readonly produced: readonly ProducedPath[]
  /**
   * Resolved absolute paths of files the turn's successful tools observed
   * (read, listed, imaged), lifted from each `tool/result` `meta` — never
   * treated as produce data: reads do not enter the turn-tail chips.
   */
  readonly observed?: readonly ProducedPath[]
  readonly presented?: readonly PresentedPath[]
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** Successful mutation paths accumulated in this Turn. */
    deliverables: DeliverablesTurnData
  }
}

interface DeliverablesState extends DeliverablesTurnData {
  readonly turn: number
  readonly calls: ReadonlyMap<string, readonly string[]>
  readonly observed: readonly ProducedPath[]
}

/**
 * Extract the paths a supported first-party mutation call produces. Session
 * `tool/call` events are root calls; Code Dispatch children do not enter this
 * Definition independently. The shipped faces batch (`write_array`), so one
 * call may name several files; the legacy singular faces stay supported for
 * recorded-session replay.
 * @param name - wire tool name.
 * @param argsRaw - model-produced JSON arguments.
 * @returns the mutation paths in written order; empty when the call mutates nothing.
 */
function mutationPaths(name: string, argsRaw: string): readonly string[] {
  let args: unknown
  try {
    args = JSON.parse(argsRaw) as unknown
  } catch {
    return []
  }
  if (!isRecord(args)) return []
  switch (name) {
    case 'write': {
      const path = typeof args.content === 'string' ? pathValue(args.file_path) : null
      return path === null ? [] : [path]
    }
    case 'edit': {
      const path = validEditArgs(args) ? pathValue(args.file_path) : null
      return path === null ? [] : [path]
    }
    case 'multi_write':
      return batchWritePaths(args.write_array)
    case 'str_replace_editor': {
      const path = editorMutationPath(args)
      return path === null ? [] : [path]
    }
    default:
      return []
  }
}

/**
 * Paths one `write_array` batch commits: every element naming a path and either
 * content or edits, in written order. A `dry_run` element previews only, so it
 * produces nothing.
 * @param value - the call's raw `write_array` argument.
 * @returns the committed paths; empty for a malformed or preview-only batch.
 */
function batchWritePaths(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  const paths: string[] = []
  for (const element of value) {
    if (!isRecord(element) || element.dry_run === true) continue
    const path = pathValue(element.path)
    if (path === null) continue
    if (typeof element.content !== 'string' && !Array.isArray(element.edits)) continue
    paths.push(path)
  }
  return paths
}

/** Validate the fields that an `edit` execution requires. */
function validEditArgs(args: Readonly<Record<string, unknown>>): boolean {
  return typeof args.old_string === 'string'
    && args.old_string.length > 0
    && typeof args.new_string === 'string'
    && args.old_string !== args.new_string
    && (args.replace_all === undefined || typeof args.replace_all === 'boolean')
}

/** Extract a path only from a complete mutating editor command. */
function editorMutationPath(args: Readonly<Record<string, unknown>>): string | null {
  const path = pathValue(args.path)
  if (path === null) return null
  switch (args.command) {
    case 'create':
      return typeof args.file_text === 'string' ? path : null
    case 'str_replace':
      return typeof args.old_str === 'string'
        && args.old_str.length > 0
        && (args.new_str === undefined || typeof args.new_str === 'string')
        ? path
        : null
    case 'insert':
      return typeof args.insert_line === 'number'
        && Number.isInteger(args.insert_line)
        && args.insert_line >= 0
        && typeof args.new_str === 'string'
        ? path
        : null
    default:
      return null
  }
}

/** A non-blank path preserves the exact spelling supplied to the tool. */
function pathValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/** Narrow parsed JSON to an argument object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Files produced by one Turn data value.
 *
 * The source is the arguments of successful `multi_write`, `write`, `edit`, and
 * mutating `str_replace_editor` calls, not the closing prose: a produced file must be
 * listed whether or not the model remembered to name it. Reads, unsupported
 * tools, malformed calls, and failed results contribute nothing. Paths keep
 * first-seen order and appear once, so a file written and then edited in the
 * same turn is one entry.
 *
 * The Conversation Location index owns turn membership before this function
 * runs, so paths cannot spill across turns and this derivation does not infer
 * boundaries from neighboring presentation Nodes.
 * @param data - engine-published Deliverables data for one Turn.
 * @param seq - closing Assistant seq; later Tool settlements are excluded.
 * @returns Produced paths in first-seen order; empty when the turn wrote nothing.
 */
export function producedForClosing(
  data: Readonly<DeliverablesTurnData> | undefined,
  seq = Number.POSITIVE_INFINITY,
): readonly string[] {
  if (data === undefined) return []
  const paths: string[] = []
  const seen = new Set<string>()
  for (const produced of data.produced) {
    if (produced.seq > seq || seen.has(produced.path)) continue
    seen.add(produced.path)
    paths.push(produced.path)
  }
  return paths
}

/**
 * Claim the turn-tail chain only when its closing turn produced files.
 * @param owner - Turn-tail owner currency for the closing assistant.
 * @returns Produced paths as the component's match, or null to decline before mount.
 */
export function selectProducedFiles(owner: TurnTailOwnerProps): readonly string[] | null {
  const paths = producedForClosing(owner.turn.data.get('deliverables'), owner.seq)
  return paths.length === 0 ? null : paths
}

/**
 * Resolved read-file paths named by the closing turn's settled tool results.
 * Always returns a list so the mention vocabulary merges produced, observed,
 * and presented uniformly; emptiness is the usual state.
 * @param owner - Turn-tail owner currency for the closing assistant.
 * @returns Resolved absolute paths of read-observed files, in first-seen order.
 */
export function selectObservedFiles(owner: TurnTailOwnerProps): readonly string[] {
  const data = owner.turn.data.get('deliverables')
  const observed = data?.observed ?? []
  const paths: string[] = []
  const seen = new Set<string>()
  for (const entry of observed) {
    if (entry.seq > owner.seq || seen.has(entry.path)) continue
    seen.add(entry.path)
    paths.push(entry.path)
  }
  return paths
}

/** Turn-local successful mutation accumulator; it publishes no view Node. */
export const deliverablesDefinition: ConversationNodeDefinition<DeliverablesState> = {
  kind: 'deliverables',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
    if (event.type === 'deliverables/presented') return isPresentedData(event.data) ? { id: String(event.data.turn), role: 'update' } : null
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) {
      return { id: String(event.data.turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('deliverables start requires turn/start')
    return { turn: match.event.data.turn, calls: new Map(), produced: [], observed: [] }
  },
  update: (context, match) => {
    if (match.event.type === 'deliverables/presented') {
      const { files } = match.event.data
      const seq = match.event.seq
      const presented: PresentedPath[] = []
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]
        if (isPresentedFile(file)) presented.push({ ...file, seq, index })
      }
      if (presented.length === 0) return context.state
      return { ...context.state, presented: [...context.state.presented ?? [], ...presented] }
    }
    if (match.event.type === 'tool/call') {
      const calls = new Map(context.state.calls)
      calls.set(
        String(match.event.data.callId),
        mutationPaths(match.event.data.name, match.event.data.arguments),
      )
      return { ...context.state, calls }
    }
    if (match.event.type !== 'tool/result') return context.state
    const result = match.event.data.message.content[0]
    if (result.isError === true) return context.state
    // Every settled fs call names the real file it resolved: read/write
    // `meta.path`, batched `frames[].path`, write `diffs[].path`.
    const observedPaths = resolvedPathsFromMeta(match.event.data.meta)
    const observed = observedPaths.length === 0
      ? context.state.observed
      : [
        ...context.state.observed,
        ...observedPaths.map(observedPath => ({ seq: match.event.seq, path: observedPath })),
      ]
    const callId = String(match.event.data.message.source.callId)
    const paths = context.state.calls.get(callId) ?? []
    const produced = paths.length === 0
      ? context.state.produced
      : [...context.state.produced, ...paths.map(path => ({ seq: match.event.seq, path }))]
    return produced === context.state.produced && observed === context.state.observed
      ? context.state
      : { ...context.state, produced, observed }
  },
  buildLocationData: (context, scope, previous) => {
    if (scope !== 'turn' || context.state === undefined) return null
    if (previous?.kind === 'turn'
      && previous.turn === context.state.turn
      && previous.key === 'deliverables'
      && previous.value.produced === context.state.produced
      && previous.value.observed === context.state.observed
      && previous.value.presented === context.state.presented) return previous
    return {
      kind: 'turn',
      turn: context.state.turn,
      key: 'deliverables',
      value: {
        produced: context.state.produced,
        observed: context.state.observed,
        ...context.state.presented === undefined ? {} : { presented: context.state.presented },
      },
    }
  },
}

/**
 * Select the latest declaration of each path before the closing reply.
 * @param owner - closing turn and sequence.
 * @returns replayable deliveries in first-seen path order.
 */
export function presentedForClosing(owner: TurnTailOwnerProps): PresentedPath[] {
  const files = new Map<string, PresentedPath>()
  for (const file of owner.turn.data.get('deliverables')?.presented ?? []) {
    if (file.seq < owner.seq) files.set(file.path, file)
  }
  return [...files.values()]
}

export { basename } from '../presented.ts'

/**
 * Resolves inline-code references against one turn's produced or delivered
 * paths. Exact paths resolve directly; a basename resolves only when exactly
 * one supplied path has that basename. Ambiguous and unknown tokens stay inert.
 * @param paths - The turn's produced or delivered paths, already deduplicated.
 * @param openFile - The chat view's file opener.
 * @param label - Localizes the accessible open-label for a resolved path.
 * @returns The resolver MarkdownText consumes; the full path rides `title`,
 * the same disambiguator the row's chips carry.
 */
export function producedFileMentions(
  paths: readonly string[],
  openFile: (path: string) => void,
  label: (path: string) => string,
): MarkdownFileMentions {
  return {
    resolve(value) {
      const path = paths.includes(value) ? value
        : onlyPathWithBasename(paths, value)
        ?? onlyPathWithTailSuffix(paths, value)
      if (path === undefined) return undefined
      return { open: () => { openFile(path) }, label: label(path), title: path }
    },
  }
}

/** The single supplied path whose basename is exactly `value`, else undefined. */
function onlyPathWithBasename(paths: readonly string[], value: string): string | undefined {
  const matches = paths.filter(path => basename(path) === value)
  return matches.length === 1 ? matches[0] : undefined
}

/**
 * The single supplied path ending at the mention, else undefined. A mention
 * spelled `~/.dsh/x.yaml` or `dev/foo/x.yaml` names the one candidate whose
 * absolute path carries that tail; abbreviations stay ambiguity-safe, a bare
 * basename keeps riding the basename rule instead.
 */
function onlyPathWithTailSuffix(paths: readonly string[], value: string): string | undefined {
  const relative = value.startsWith('~/') ? value.slice(2) : value
  if (relative === '' || relative.startsWith('/') || !relative.includes('/')) return undefined
  const needle = `/${relative}`
  const matches = paths.filter(path => path.endsWith(needle))
  return matches.length === 1 ? matches[0] : undefined
}
