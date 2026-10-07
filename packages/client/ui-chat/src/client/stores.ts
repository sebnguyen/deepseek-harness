/** Per-Session Chat view store. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { ChatStoreState } from './contract/store.ts'

type ChatActions = {
  setSpanOpen: (draft: ChatStoreState, span: string, open: boolean) => void
}

/**
 * Create the Chat view store handle.
 * @returns a handle instantiated once per rendered Session scope.
 */
export function createChatStore(): EngineStoreHandle<ChatStoreState, ChatActions> {
  return defineStore({
    init: (): ChatStoreState => ({ openSpans: [] }),
    actions: {
      setSpanOpen: (draft, span, open) => {
        const index = draft.openSpans.indexOf(span)
        if (!open) {
          if (index >= 0) draft.openSpans.splice(index, 1)
          return
        }
        if (index < 0) draft.openSpans.push(span)
      },
    },
  })
}
