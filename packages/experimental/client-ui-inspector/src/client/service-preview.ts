/** On-demand service-value previews with stale-response protection. */

import type { CordisServicePreview } from '@deepseek-ai/dsh-experimental-inspector/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { cordisServiceQuery, type CordisServiceSelection } from './service-selection.ts'

/** One visible preview request and its state. */
export type CordisServicePreviewState =
  | { readonly status: 'loading'; readonly selection: CordisServiceSelection }
  | {
    readonly status: 'ready'
    readonly selection: CordisServiceSelection
    readonly preview: CordisServicePreview
  }
  | {
    readonly status: 'error'
    readonly selection: CordisServiceSelection
    readonly message: string
  }
  | null

/** Observable on-demand preview source plus selection and teardown controls. */
export interface CordisServicePreviewController extends HostObservable<CordisServicePreviewState> {
  select(selection: CordisServiceSelection): void
  clear(): void
  dispose(): void
}

/**
 * Create a preview controller. Only a fresh explicit selection evaluates a
 * service. Closing the pane or plugin ignores outstanding results.
 * @param read - Scoped single-shot Worker value query.
 * @returns Observable preview state and lifecycle controls.
 */
export function createServicePreview(
  read: (query: ReturnType<typeof cordisServiceQuery>) => Promise<CordisServicePreview>,
): CordisServicePreviewController {
  const listeners = new Set<() => void>()
  let state: CordisServicePreviewState = null
  let generation = 0

  const publish = (next: CordisServicePreviewState): void => {
    state = next
    for (const listener of [...listeners]) listener()
  }
  const clear = (): void => {
    generation += 1
    publish(null)
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    select: (selection) => {
      const issued = ++generation
      publish({ status: 'loading', selection })
      void read(cordisServiceQuery(selection)).then(
        (preview) => {
          if (issued === generation) publish({ status: 'ready', selection, preview })
        },
        (error: unknown) => {
          if (issued !== generation) return
          publish({ status: 'error', selection, message: error instanceof Error ? error.message : String(error) })
        },
      )
    },
    clear,
    dispose: () => {
      generation += 1
      state = null
      listeners.clear()
    },
  }
}
