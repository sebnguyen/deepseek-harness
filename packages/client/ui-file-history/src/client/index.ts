/**
 * Browser file-history plugin contributing the `useFileHistory` selector hook
 * as a projection of the checkpoint slot register, without defining a service.
 * The retired Files conversation view's surfaces now read the same register
 * through this hook until the `stops` Remote retires.
 *
 * @module ui-file-history
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
// Type-only: the ctx.remote merge must be in the program for the checkpoint
// Remote calls below to type.
import type { } from '@deepseek-ai/dsh-api-remotes/client'
import type { } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { } from '@deepseek-ai/dsh-client-ui-session/client'
import { EMPTY_FILE_HISTORY, foldSlotTimelines, type FileHistorySnapshot } from './fold.ts'

export type { FileHistorySnapshot, FileStop, FileTimeline, UseFileHistory } from './fold.ts'
export { coalesceStops, EMPTY_FILE_HISTORY, foldSlotTimelines, groupStopsByTurn } from './fold.ts'

/** Required services: the view slot registry, session bindings, hook registry, locale, and the checkpoint Remote. */
export const inject = ['slots', 'sessions', 'uiSession', 'locale', 'remote', 'remote.checkpoint']

/**
 * Client plugin body: provide the `fileHistory` hook as one memoized register
 * projection per session binding. The register rides no session event, so each
 * binding revision re-fetches `remote.checkpoint.slots` and the snapshot bumps
 * its listeners when the fetch settles.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  // One memoized projection per binding: the fold re-keys on the binding
  // revision, so streaming re-renders only re-fetch when the revision or the
  // working directory actually moves.
  const sources = new WeakMap<SessionBinding, ObservableSnapshot<FileHistorySnapshot>>()
  /**
   * Memoize the per-binding register projection.
   * @param binding - the session binding whose register the hook reads.
   * @returns the observable snapshot source backing `useFileHistory`.
   */
  const fileHistorySource = (binding: SessionBinding): ObservableSnapshot<FileHistorySnapshot> => {
    let source = sources.get(binding)
    if (source === undefined) {
      let folded: FileHistorySnapshot = EMPTY_FILE_HISTORY
      let fetchKey = ''
      let fetching = false
      const listeners = new Set<() => void>()
      /** Refetch the register for `key`, coalescing bursts into one round trip. */
      const fetchFor = (key: string): void => {
        fetchKey = key
        fetching = true
        void ctx.remote.checkpoint.slots(binding.sessionId, undefined).then((result) => {
          fetching = false
          // A failed read keeps the last folded register in place.
          if (!result.ok) return
          const next = foldSlotTimelines(result.value, binding.session.getSnapshot().cwd)
          // Streaming bumps the binding revision per event while the register
          // moves only on checkpoint writes: an unchanged fold keeps its
          // identity so hook consumers do not re-render on unrelated events.
          if (sameFolded(folded, next)) return
          folded = next
          for (const listener of listeners) listener()
        }, () => {
          // Transport failure: the next revision bump refetches.
          fetching = false
        })
      }
      source = {
        getSnapshot: () => {
          const window = binding.eventSource.getSnapshot()
          const cwd = binding.session.getSnapshot().cwd
          const key = `${String(window.revision)}\u0000${cwd ?? ''}`
          if (key !== fetchKey && !fetching) fetchFor(key)
          return folded
        },
        subscribe: (listener) => {
          listeners.add(listener)
          const unsubscribe = binding.eventSource.subscribe(listener)
          return () => {
            listeners.delete(listener)
            unsubscribe()
          }
        },
      }
      sources.set(binding, source)
    }
    return source
  }
  ctx.uiSession.provide({
    hooks: ['fileHistory'],
    resolve: binding => ({ hooks: { fileHistory: fileHistorySource(binding) } }),
  })
}

/**
 * Whether two folds name identical stops in identical order. The fold is a
 * plain-data projection, so one serialization decides; a differing key
 * order with equal content costs one harmless extra bump.
 * @param left - the fold currently served.
 * @param right - the fold of the freshest register read.
 * @returns true when both folds carry the same stops.
 */
function sameFolded(left: FileHistorySnapshot, right: FileHistorySnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
