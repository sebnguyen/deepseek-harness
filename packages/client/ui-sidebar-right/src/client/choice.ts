/**
 * The remembered open/closed choice for the right column.
 *
 * The surface itself is memory-only: a reload returns every session to the
 * default page. The one fact worth carrying across reloads is whether the user
 * wants the column open, so it lives in its own browser-local store, keyed by
 * session id, and never enters the layout or the session log.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** Browser storage identity; versioned because the persisted shape is a storage contract. */
export const SIDEBAR_RIGHT_CHOICE_KEY = 'dsh.sidebar-right.choice.v1'

/** Each session's remembered choice; a missing entry means the open default. */
export interface SidebarRightChoiceState {
  bySession: Record<string, boolean>
}

/** Declared write set for the remembered choice. */
type SidebarRightChoiceActions = {
  set: (draft: SidebarRightChoiceState, sessionId: string, expanded: boolean) => void
}

/**
 * Create the remembered open/closed choice store handle.
 * @returns the store handle; one root-scoped instance serves every session.
 */
export function createSidebarRightChoiceStore(): EngineStoreHandle<SidebarRightChoiceState, SidebarRightChoiceActions> {
  return defineStore({
    init: (): SidebarRightChoiceState => ({ bySession: {} }),
    persist: SIDEBAR_RIGHT_CHOICE_KEY,
    actions: {
      set: (d, sessionId: string, expanded: boolean) => { d.bySession[sessionId] = expanded },
    },
  })
}
