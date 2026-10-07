/**
 * Browser file-history plugin contributing one workspace snapshot timeline to
 * the conversation view slot without defining a service.
 *
 * @module ui-file-history
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type { } from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the 'conversation.view' SlotMap row and the ctx.remote merge must
// be in the program for the register and Remote calls below to type.
import type { } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { } from '@deepseek-ai/dsh-client-ui-session/client'
import type { } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: the checkpoint/scan SessionEventMap member and its row vocabulary.
import type { } from '@deepseek-ai/dsh-checkpoint/types'
import { FileHistoryView, type FileHistoryViewInjected } from './FileHistoryView.tsx'
import { EMPTY_FILE_HISTORY, foldFileHistory, type FileHistorySnapshot } from './fold.ts'
import { en, NS, zh } from './locales.ts'

export type { FileHistorySnapshot, FileStop, FileTimeline, UseFileHistory } from './fold.ts'
export { EMPTY_FILE_HISTORY, foldFileHistory, groupStopsByTurn } from './fold.ts'
export type { FileHistoryKey } from './locales.ts'
export { FileHistoryPanel, FileHistoryView } from './FileHistoryView.tsx'
export type { FileHistoryPanelProps, FileHistoryViewInjected } from './FileHistoryView.tsx'

/** Required services: the view slot, session bindings, hook registry, locale, and the checkpoint Remote. */
export const inject = ['slots', 'sessions', 'uiSession', 'locale', 'remote', 'remote.checkpoint']

/**
 * Client plugin body: register the file-history view tab. Both the dictionary
 * and the slot entry ride effect wrappers, so plugin unload removes them.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  // One memoized fold per binding: the view re-renders on every appended event,
  // and a revision check keeps each fold proportional to the events since the
  // last one rather than to the whole window.
  const sources = new WeakMap<SessionBinding, ObservableSnapshot<FileHistorySnapshot>>()
  const fileHistorySource = (binding: SessionBinding): ObservableSnapshot<FileHistorySnapshot> => {
    let source = sources.get(binding)
    if (source === undefined) {
      let foldedRevision = -1
      let folded: FileHistorySnapshot = EMPTY_FILE_HISTORY
      source = {
        getSnapshot: () => {
          const window = binding.eventSource.getSnapshot()
          if (window.revision !== foldedRevision) {
            folded = foldFileHistory(window.entries)
            foldedRevision = window.revision
          }
          return folded
        },
        subscribe: listener => binding.eventSource.subscribe(listener),
      }
      sources.set(binding, source)
    }
    return source
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-file-history: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.uiSession.provide({
    hooks: ['fileHistory'],
    resolve: binding => ({ hooks: { fileHistory: fileHistorySource(binding) } }),
  })
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'file-history',
    order: 20,
    locale: NS,
    label: () => t('view.files'),
    inject: (sessionId: SessionId): FileHistoryViewInjected => ({
      restore: async (path, digest) => {
        const result = await ctx.remote.checkpoint.restore(sessionId, path, digest)
        if (!result.ok) throw new Error(`checkpoint.restore failed: ${result.error.code}: ${result.error.message}`)
        return result.value
      },
      loadText: async (digest) => {
        const result = await ctx.remote.checkpoint.blob(sessionId, digest)
        if (!result.ok) throw new Error(`checkpoint.blob failed: ${result.error.code}: ${result.error.message}`)
        return result.value
      },
    }),
  }, FileHistoryView))
}
