/**
 * Unified Web `@` reference source. File and session discovery run through
 * the cancellable generated Remote namespaces in parallel with deterministic
 * ordering and labels; snapshot stops join from the checkpoint timeline so a
 * written file can be referenced at one frozen stop.
 *
 * Rows carry only what distinguishes them: a file names its parent directory
 * (nothing at the workspace root), a directory listing names none because its
 * breadcrumb already does, a session names its workspace only when that
 * workspace is not the current one, and a stop names its turn and tool. A
 * session is dated from the Host session list, so the `@` menu and the session
 * list never disagree about its age.
 *
 * @module @deepseek-ai/dsh-client-ui-reference/client
 */
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
// Type-only: the `file` params declaration (`display` / `stop`) the source passes to openResource.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
// Type-only: the checkpoint stop vocabulary the remote returns.
import type {} from '@deepseek-ai/dsh-checkpoint/types'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  findStop, parseNoteRef, parseSnapshotRef, rankByName, relativeTime,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { CheckpointSlotTimeline } from '@deepseek-ai/dsh-checkpoint/types'
import type {
  ClientSessionContext, InputTriggerCandidate, InputTriggerCrumb, InputTriggerServiceContract, InputTriggerSource,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { formatFileMention } from '@deepseek-ai/dsh-file-reference/grammar'
import type { FileReferenceCandidate } from '@deepseek-ai/dsh-file-reference/types'
import type { SessionReferenceMentionCandidate } from '@deepseek-ai/dsh-session-reference/types'
import { abbreviateHomePath, fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import { en, NS, zh, type ReferenceKey } from './locales.ts'

/** Required services: the trigger registry, the Remote namespaces, and the copy. */
export const inject = [
  'inputTriggers', 'locale', 'sessions', 'remote', 'remote.fileReferences',
  'remote.sessionReferenceResolver', 'remote.checkpoint', 'sidebarRight',
]

/**
 * Register the combined `@file` / `@session` / `@stop` source.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-reference: dictionaries')
  const t = ctx.locale.bind(NS)
  const sessions = ctx.get('sessions') as ISessions
  // The settled stop roll backs the synchronous lexicon scan; menu picks and
  // warms refresh it, connection resets drop it.
  const rolls = new Map<string, readonly StopRollEntry[]>()
  const lexiconListeners = new Map<string, Set<() => void>>()
  const notifyLexicon = (sessionId: string): void => {
    for (const listener of [...(lexiconListeners.get(sessionId) ?? [])]) listener()
  }
  const setRoll = (sessionId: string, roll: readonly StopRollEntry[]): void => {
    rolls.set(sessionId, roll)
    notifyLexicon(sessionId)
  }
  const fetchRoll = (sessionId: SessionId): Promise<readonly StopRollEntry[]> =>
    ctx.remote.checkpoint.stops(sessionId)
      .then(result => (result.ok ? result.value.flatMap(stopEntries) : []))
  const clearRolls = (): void => {
    const ids = [...rolls.keys()]
    rolls.clear()
    for (const id of ids) notifyLexicon(id)
  }
  ctx.on('connection/reset', clearRolls)
  const source: InputTriggerSource = {
    trigger: '@',
    name: 'reference',
    showGroupTitle: false,
    async candidates(session, { query, quoted, drilled, signal }) {
      const fileLookup = ctx.remote.fileReferences.list(session.sessionId, query, signal)
        .then(result => result.ok ? result.value : [])
      const sessionLookup = quoted === true
        ? Promise.resolve([] as SessionReferenceMentionCandidate[])
        : ctx.remote.sessionReferenceResolver.candidates(session.sessionId, query, signal)
          .then(result => result.ok ? result.value : [])
      const stopsLookup = quoted === true
        ? Promise.resolve([] as StopRollEntry[])
        : fetchRoll(session.sessionId)
      const notesLookup = quoted === true
        ? Promise.resolve([] as CheckpointSlotTimeline[])
        : ctx.remote.checkpoint.slots(session.sessionId)
          .then(result => (result.ok ? result.value : []))
      const [fileItems, sessionItems, stopItems, noteTimelines] = await Promise.all([
        fileLookup, sessionLookup, stopsLookup, notesLookup,
      ])
      if (signal.aborted) return []
      if (quoted !== true) setRoll(session.sessionId, stopItems)
      // The header already names the directory being listed; rows repeat it only
      // when there is no header to carry it.
      const withLocation = crumbsFor(query, quoted === true, drilled, t) === undefined
      const now = Date.now()
      const home = ctx.remote.$host.home
      const listed = sessions.list.getSnapshot().byId
      return [
        ...fileItems.flatMap(candidate => fileCandidate(candidate, quoted === true, withLocation, t)),
        ...rankByName(stopItems.map(entry => ({ ...entry, name: entry.mention })), query)
          .map(entry => stopCandidate(entry, withLocation, t)),
        ...rankByName(noteEntries(noteTimelines).map(entry => ({ ...entry, name: entry.mention })), query)
          .map(entry => noteCandidate(entry, t)),
        ...sessionItems.map(candidate => sessionCandidate(
          candidate,
          listed[candidate.sessionId]?.updatedAt ?? candidate.createdAt,
          now,
          home,
          t,
        )),
      ]
    },
    header(_session: ClientSessionContext, req) {
      return crumbsFor(req.query, req.quoted === true, req.drilled, t)
    },
    warm(session) {
      void fetchRoll(session.sessionId)
        .then(roll => setRoll(session.sessionId, roll))
        .catch(() => {})
    },
    lexicon(session) {
      return rolls.get(session.sessionId)?.map(entry => entry.mention)
    },
    subscribeLexicon(session, listener) {
      const key = session.sessionId
      const listeners = lexiconListeners.get(key) ?? new Set()
      listeners.add(listener)
      lexiconListeners.set(key, listeners)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) lexiconListeners.delete(key)
      }
    },
    onPick({ candidate, action }) {
      const value = parseCandidate(candidate.value)
      if (value?.kind === 'file') {
        // A directory row carries two verbs: the settling pick resolves the
        // folder itself as an atomic reference, while the drill action (Tab /
        // row chevron / a header crumb) keeps the literal descent text and
        // the open menu.
        if (value.fileKind === 'directory' && action === 'drill') {
          return { text: value.mention, continue: true }
        }
        return {
          insert: {
            source: 'reference',
            ref: value.mention,
            label: value.fileKind === 'directory' ? `${value.label}/` : value.label,
            appearance: value.fileKind === 'directory' ? 'folder' : 'file',
            clipboardText: value.mention,
          },
        }
      }
      if (value?.kind === 'session') {
        return {
          insert: {
            source: 'reference',
            ref: value.mention,
            label: value.label,
            appearance: 'session',
            clipboardText: value.mention,
          },
        }
      }
      if (value?.kind === 'stop') {
        return {
          insert: {
            source: 'reference',
            ref: value.mention,
            label: value.label,
            appearance: 'snapshot',
            clipboardText: value.mention,
          },
        }
      }
      if (value?.kind === 'note') {
        return {
          insert: {
            source: 'reference',
            ref: value.mention,
            label: value.label,
            appearance: 'note',
            clipboardText: value.mention,
          },
        }
      }
      return undefined
    },
    openReference(session, { ref, appearance }) {
      if (appearance !== 'file' && appearance !== 'snapshot' && appearance !== 'note') return false
      const raw = ref.startsWith('@"') ? ref.slice(2, -1) : ref.slice(1)
      const note = appearance === 'note' ? parseNoteRef(raw) : undefined
      const parsed = appearance === 'snapshot' ? parseSnapshotRef(raw) : undefined
      const path = note?.path ?? parsed?.path ?? raw
      const cwd = sessions.list.getSnapshot().byId[session.sessionId]?.cwd
      ctx.sidebarRight.openResource(
        fileAddressFor(session.sessionId, cwd, path),
        note !== undefined
          ? { params: { line: note.line } as const }
          : parsed !== undefined
            ? { params: { display: 'changes', stop: parsed.callId } as const }
            : undefined,
      )
      return true
    },
    codec: {
      clipboardText: ref => ref,
      serialize: async (session, ref, signal) => {
        const body = ref.startsWith('@') ? ref.slice(1) : ref
        const noteRef = parseNoteRef(body)
        if (noteRef !== undefined) {
          const timelines = await ctx.remote.checkpoint.slots(session.sessionId, noteRef.path)
          if (!timelines.ok) {
            throw new Error(`checkpoint.slots failed: ${timelines.error.code}: ${timelines.error.message}`)
          }
          const slot = (timelines.value.find(timeline => timeline.path === noteRef.path)?.slots ?? [])
            .find(candidate => candidate.slotId === noteRef.noteId)
          if (slot === undefined || slot.kind !== 'note') {
            throw new Error(`note ${ref} is not in this session's register`)
          }
          const detail = slot.detail as { text?: string }
          signal.throwIfAborted()
          if (slot.after === undefined) return `${ref}\n${detail.text ?? slot.label}`
          const blob = await ctx.remote.checkpoint.blob(session.sessionId, slot.after)
          if (!blob.ok || blob.value === null) {
            throw new Error(`note ${ref} was pruned from the checkpoint store`)
          }
          return `${ref}\n${detail.text ?? slot.label}\n\`\`\`\n${blob.value}\n\`\`\``
        }
        const parsed = parseSnapshotRef(body)
        if (parsed === undefined) return ref
        const timelines = await ctx.remote.checkpoint.stops(session.sessionId, parsed.path)
        if (!timelines.ok) {
          throw new Error(`checkpoint.stops failed: ${timelines.error.code}: ${timelines.error.message}`)
        }
        const stop = findStop(parsed, timelines.value.find(timeline => timeline.path === parsed.path)?.stops ?? [])
        if (stop === undefined || stop.after === undefined) {
          throw new Error(`snapshot ${ref} has no retained after text`)
        }
        signal.throwIfAborted()
        const blob = await ctx.remote.checkpoint.blob(session.sessionId, stop.after)
        if (!blob.ok || blob.value === null) {
          throw new Error(`snapshot ${ref} was pruned from the checkpoint store`)
        }
        return `${ref}\n\`\`\`\n${blob.value}\n\`\`\``
      },
    },
  }
  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract
  ctx.effect(() => {
    const unregister = inputTriggers.registerSource(source)
    return () => {
      unregister()
      rolls.clear()
      lexiconListeners.clear()
    }
  }, 'ui-reference: @ source')
}

type Translate = (key: ReferenceKey, params?: Record<string, unknown>) => string

type ReferenceCandidateValue =
  | { kind: 'file'; fileKind: FileReferenceCandidate['kind']; label: string; mention: string }
  | { kind: 'session'; label: string; mention: string }
  | { kind: 'stop'; label: string; mention: string }
  | { kind: 'note'; label: string; mention: string }

/** One serializable stop of one file, flattened for menu ranking and lexicon rolls. */
interface StopRollEntry {
  readonly path: string
  readonly mention: string
  readonly turn: number
  readonly tool: string
  readonly parent: string
}

/** Whether one stop can serialize: a turn key and a retained after text. */
function isSerializableStop(stop: { turn?: number | string; after?: string }): boolean {
  return typeof stop.turn === 'number' && stop.after !== undefined
}

/** One serializable note slot of one file, flattened for menu ranking. */
interface NoteRollEntry {
  readonly path: string
  readonly mention: string
  readonly line: number
  readonly label: string
}

/** Flatten one register's note slots into roll entries. */
function noteEntries(timelines: readonly CheckpointSlotTimeline[]): NoteRollEntry[] {
  const out: NoteRollEntry[] = []
  for (const timeline of timelines) {
    for (const slot of timeline.slots) {
      if (slot.kind !== 'note' || slot.line === undefined) continue
      out.push({
        path: timeline.path,
        mention: `${timeline.path}#L${slot.line}#${slot.slotId}`,
        line: slot.line,
        label: slot.label,
      })
    }
  }
  return out
}

/** One menu row per live note, ranked with the same name ranking as skills. */
function noteCandidate(entry: NoteRollEntry, t: Translate): InputTriggerCandidate {
  return {
    name: entry.mention,
    label: t('note.meta', { line: entry.line, text: entry.label }),
    icon: 'note' as const,
    section: t('section.notes'),
    value: JSON.stringify({ kind: 'note', label: entry.label, mention: entry.mention } satisfies ReferenceCandidateValue),
  }
}

/** One menu row per serializable stop, ranked with the same name ranking as skills. */
function stopCandidate(entry: StopRollEntry, withLocation: boolean, t: Translate): InputTriggerCandidate {
  const base = entry.path.slice(entry.path.lastIndexOf('/') + 1)
  return {
    name: entry.mention,
    label: t('stops.meta', { turn: entry.turn, tool: entry.tool }),
    ...(withLocation && entry.parent !== '' ? { description: entry.parent } : {}),
    icon: 'file' as const,
    section: t('section.stops'),
    value: JSON.stringify({ kind: 'stop', label: base, mention: entry.mention } satisfies ReferenceCandidateValue),
  }
}

/** One timeline's rows, narrowed to what the roll flattens. */
interface TimelineLike {
  readonly path: string
  readonly stops: readonly { callId: string; toolName: string; turn?: number | string; after?: string }[]
}

/** Flatten one timeline's serializable stops into roll entries. */
function stopEntries(timeline: TimelineLike): StopRollEntry[] {
  const slash = timeline.path.lastIndexOf('/')
  const parent = slash < 0 ? '' : timeline.path.slice(0, slash)
  return timeline.stops
    .filter(isSerializableStop)
    .map(stop => ({
      path: timeline.path,
      mention: `${timeline.path}#${stop.turn as number}#${stop.callId}`,
      turn: stop.turn as number,
      tool: stop.toolName,
      parent,
    }))
}

/**
 * The breadcrumb of a drilled directory listing, from the workspace root down
 * to the directory being listed.
 *
 * Only a drill produces one: a path the user typed carries its own context in
 * the draft, while a drill replaced the text they were reading with a deeper
 * one and owes them the way back.
 * @param query - the live query, path text following `@` or `@"`.
 * @param quoted - whether the active token is an open quoted path.
 * @param drilled - whether a drill pick, rather than typing, produced the query.
 * @param t - the reference dictionary.
 * @returns the crumbs, or undefined when this listing needs no header.
 */
function crumbsFor(
  query: string,
  quoted: boolean,
  drilled: boolean,
  t: Translate,
): readonly InputTriggerCrumb[] | undefined {
  if (!drilled) return undefined
  const slash = query.lastIndexOf('/')
  if (slash < 0) return undefined
  const segments = query.slice(0, slash).split('/').filter(segment => segment !== '')
  const crumbs: InputTriggerCrumb[] = [{
    label: t('crumb.root'),
    value: directoryValue(t('crumb.root'), quoted ? '@"' : '@'),
  }]
  for (const [index, segment] of segments.entries()) {
    const path = segments.slice(0, index + 1).join('/')
    const mention = formatFileMention({ path, kind: 'directory' }, quoted)
    // A trail whose steps cannot all be written back as mention text would
    // send the user somewhere they did not click; show no header instead.
    if (mention === undefined) return undefined
    crumbs.push({
      label: segment,
      value: directoryValue(segment, mention),
      ...(index === segments.length - 1 ? { current: true } : {}),
    })
  }
  return crumbs
}

/** Project one directory destination as the drill payload `onPick` already understands. */
function directoryValue(label: string, mention: string): string {
  const value: ReferenceCandidateValue = { kind: 'file', fileKind: 'directory', label, mention }
  return JSON.stringify(value)
}

function fileCandidate(
  candidate: FileReferenceCandidate,
  preserveQuote: boolean,
  withLocation: boolean,
  t: Translate,
) {
  const mention = formatFileMention(candidate, preserveQuote)
  if (mention === undefined) return []
  const slash = candidate.path.lastIndexOf('/')
  const name = candidate.path.slice(slash + 1)
  const parent = slash < 0 ? '' : candidate.path.slice(0, slash)
  const directory = candidate.kind === 'directory'
  const value: ReferenceCandidateValue = {
    kind: 'file',
    fileKind: candidate.kind,
    label: name,
    mention,
  }
  return [{
    name: `${name}${directory ? '/' : ''}`,
    // The location is the parent alone: repeating the name the row already
    // shows says nothing, and a workspace-root entry has no parent to name.
    ...(withLocation && parent !== '' ? { description: parent } : {}),
    icon: directory ? 'folder' as const : 'file' as const,
    section: t('section.files'),
    value: JSON.stringify(value),
    ...(directory ? { drill: true } : {}),
  }]
}

function sessionCandidate(
  candidate: SessionReferenceMentionCandidate,
  updatedAt: number,
  now: number,
  home: string | undefined,
  t: Translate,
) {
  const { unit, n } = relativeTime(updatedAt, now)
  const age = unit === 'now' ? t('time.now') : t(`time.${unit}`, { n })
  // Candidates are ranked by workspace affinity, so the location only tells
  // the user something when it is not the workspace they are already in.
  const location = candidate.sameWorkspace
    ? undefined
    : candidate.cwd === undefined ? t('candidate.noCwd') : abbreviateHomePath(candidate.cwd, home)
  const value: ReferenceCandidateValue = {
    kind: 'session',
    label: candidate.label,
    mention: candidate.mention,
  }
  return {
    name: candidate.label,
    description: location === undefined ? age : `${location} · ${age}`,
    icon: 'session' as const,
    section: t('section.sessions'),
    value: JSON.stringify(value),
  }
}

function parseCandidate(value: string | undefined): ReferenceCandidateValue | undefined {
  if (value === undefined) return undefined
  return JSON.parse(value) as ReferenceCandidateValue
}
