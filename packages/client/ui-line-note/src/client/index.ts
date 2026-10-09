/**
 * Browser half: the line-note gutter composes into the editor's
 * `editor.cm.extension` hole; the register read rides a session-standard
 * `lineNotes` hook so every session component may see the notes.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-checkpoint/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-editor/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { CheckpointSlot, CheckpointSlotTimeline } from '@deepseek-ai/dsh-checkpoint/types'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { EditorCmEntryInjected } from '@deepseek-ai/dsh-client-ui-editor/client'
import { LineNoteGutter } from './LineNoteGutter.tsx'
import { en, zh } from './locales.ts'
import { lineNotesSource, type LineNotesRemote, type LineNotesSnapshot } from './source.ts'

/** The session-standard hook the plugin provides. */
export type UseLineNotes = (selector: (snapshot: LineNotesSnapshot) => unknown) => unknown

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SessionStandardProps {
    /** The session's live note slots, grouped by path. */
    useLineNotes: <S>(selector: (snapshot: LineNotesSnapshot) => S) => S
  }
  interface LocaleNamespaceMap {
    /** Line-note gutter and popover copy. */
    lineNote: import('./locales.ts').LineNoteKey
  }
}

export type { LineNotesSnapshot } from './source.ts'
export { EMPTY_LINE_NOTES, mintNoteId } from './source.ts'

/**
 * Required browser services: the slots, the session hook seam, copy, and the
 * checkpoint namespace on the Remote carrier.
 */
export const inject = ['slots', 'uiSession', 'locale', 'remote', 'remote.checkpoint']

/**
 * Client plugin body: dictionaries, the session hook, and the gutter entry.
 * @param ctx - client root context carrying the registries and the Remote face.
 */
/** The checkpoint namespace face with its Remoteraw unwrapped result types. */
interface CheckpointRemoteFace {
  /** The register as a file-to-slot-array map; `path` narrows to one key. */
  readonly slots: (sessionId: string, path?: string) => Promise<RemoteResult<CheckpointSlotTimeline[]>>
  /** Put one producer-minted slot into this session's register. */
  readonly slotPut: (sessionId: string, slot: {
    readonly slotId: string
    readonly kind: 'note'
    readonly path: string
    readonly label: string
    readonly line: number
    readonly retained: string
    readonly detail: { readonly text: string }
  }) => Promise<RemoteResult<CheckpointSlot>>
}

export function apply(ctx: ClientContext): void {
  const remote = ctx.remote as unknown as { checkpoint: CheckpointRemoteFace }
  const notesRemote: LineNotesRemote = {
    slots: sessionId => remote.checkpoint.slots(sessionId, undefined).then(result => (result.ok ? result.value : [])),
  }
  const sources = new WeakMap<SessionBinding, ObservableSnapshot<LineNotesSnapshot>>()
  const sourceFor = (binding: SessionBinding): ObservableSnapshot<LineNotesSnapshot> => {
    let source = sources.get(binding)
    if (source === undefined) {
      source = lineNotesSource(binding, notesRemote)
      sources.set(binding, source)
    }
    return source
  }
  ctx.effect(() => ctx.locale.register('lineNote', { zh, en }), 'ui-line-note: dictionaries')
  ctx.effect(() => ctx.uiSession.provide({
    hooks: ['lineNotes'],
    resolve: binding => ({ hooks: { lineNotes: sourceFor(binding) } }),
  }), 'ui-line-note: lineNotes hook')
  ctx.effect(() => ctx.slots.inject('editor.cm.extension', () => ctx.slots.register(
    {
      name: 'editor.cm.extension',
      id: 'line-note',
      order: 20,
      locale: 'lineNote',
      inject: (sessionId: string): EditorCmEntryInjected => ({
        putSlot: slot => remote.checkpoint.slotPut(sessionId, slot),
        slots: () => remote.checkpoint.slots(sessionId, undefined).then(result => (result.ok ? result.value : [])),
      }),
    },
    LineNoteGutter,
  )), 'ui-line-note: gutter')
}
