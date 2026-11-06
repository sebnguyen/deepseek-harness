/** Visibility-driven reads of the Worker's detached Cordis runtime snapshots. */

import type { CordisRuntimeTree } from '@deepseek-ai/dsh-experimental-inspector/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/** Latest query result; failed reads retain the last successful tree. */
export interface InspectorTreeSnapshot {
  readonly tree: CordisRuntimeTree | null
  /** False until the first read succeeds. */
  readonly read: boolean
  readonly error?: string
}

/** Runtime-tree observable plus its explicit read and lifecycle controls. */
export interface InspectorTreeSource extends HostObservable<InspectorTreeSnapshot> {
  /** Read once unless a query is already in flight. */
  refresh(): void
  /** Stop future reads and ignore the outstanding result. */
  dispose(): void
}

/**
 * Create a single-flight polling source. The first subscriber reads immediately;
 * the last unsubscribe stops polling and invalidates the outstanding read. Reused
 * snapshots keep their identity when the detached tree has not changed.
 * @param read - Consumer-neutral Inspector query.
 * @param intervalMs - Delay between one settlement and the next read.
 * @returns Disposable runtime-tree source.
 */
export function createInspectorTreeSource(
  read: () => Promise<CordisRuntimeTree>,
  intervalMs: number,
): InspectorTreeSource {
  const listeners = new Set<() => void>()
  let snapshot: InspectorTreeSnapshot = { tree: null, read: false }
  let timer: ReturnType<typeof setTimeout> | undefined
  let generation = 0
  let inFlight = false
  let disposed = false

  const publish = (next: InspectorTreeSnapshot): void => {
    snapshot = next
    for (const listener of [...listeners]) listener()
  }

  const schedule = (): void => {
    if (disposed || timer !== undefined || listeners.size === 0 || inFlight) return
    timer = setTimeout(() => {
      timer = undefined
      refresh()
    }, intervalMs)
  }

  const refresh = (): void => {
    if (disposed || inFlight) return
    const issued = generation
    inFlight = true
    void Promise.resolve().then(read).then(
      (tree) => {
        if (issued !== generation) return
        if (snapshot.read && snapshot.error === undefined
          && JSON.stringify(snapshot.tree) === JSON.stringify(tree)) return
        publish({ tree, read: true })
      },
      (error: unknown) => {
        if (issued !== generation) return
        publish({ ...snapshot, error: error instanceof Error ? error.message : String(error) })
      },
    ).then(() => {
      if (issued !== generation) return
      inFlight = false
      schedule()
    })
  }

  const stop = (): void => {
    generation += 1
    inFlight = false
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      if (listeners.size === 1) refresh()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) stop()
      }
    },
    refresh,
    dispose: () => {
      if (disposed) return
      disposed = true
      listeners.clear()
      stop()
    },
  }
}
