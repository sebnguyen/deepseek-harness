/**
 * Browser Context Window plugin contributing one entry to the conversation
 * view slot without defining a service.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the 'conversation.view' SlotMap row (declared by the slot's
// owning package) must be in the program for the register call to type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import {
  EMPTY_CONTEXT_WINDOW_SNAPSHOT, registerContextWindowConversationView,
} from './context-window-snapshot-builder.ts'
import type { ContextWindowSnapshot } from './context-window-snapshot-builder.ts'
import { registerContextWindowContentDefinition } from './content-preview.ts'
import { registerContextWindowTurnDefinition } from './context-window-turn-definition.ts'
import { en, NS, zh } from './locales.ts'
import { ContextWindowView } from './ContextWindowView.tsx'
import type { ContextWindowViewInjected } from './ContextWindowView.tsx'

export type { ContextWindowKey } from './locales.ts'
export type { ContextWindowContentPreview } from './content-preview.ts'
export type { ContextWindowTurnUsage } from './context-window-turn-definition.ts'
export type { ContextWindowSnapshot, UseContextWindow } from './context-window-snapshot-builder.ts'
export type { CacheClass, ContextWindowSegment } from './timeline.ts'
export type { ContextWindowViewInjected } from './ContextWindowView.tsx'

/** Required services: the conversation slot, registries, and the locale service. */
export const inject = ['slots', 'sessions', 'uiSession', 'uiConversation', 'locale']

/**
 * Client plugin body: register the Context Window view tab. The registration
 * rides the slot service's effect wrapper, so plugin unload removes the tab.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  // Declaring `useContextWindow` in `SessionStandardProps` only satisfies the
  // type checker — the runtime value must be provided separately, the same
  // two-step ui-trajectory uses for `useTrajectory`.
  const sources = new WeakMap<SessionBinding, HostObservable<ContextWindowSnapshot>>()
  const contextWindowSource = (binding: SessionBinding): HostObservable<ContextWindowSnapshot> => {
    let source = sources.get(binding)
    if (source === undefined) {
      const target = ctx.uiConversation.binding(binding).target('context-window')
      source = {
        getSnapshot: () => target.getSnapshot() ?? EMPTY_CONTEXT_WINDOW_SNAPSHOT,
        subscribe: listener => target.subscribe(listener),
      }
      sources.set(binding, source)
    }
    return source
  }

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-context-window: dictionaries')
  const t = ctx.locale.bind(NS)
  registerContextWindowTurnDefinition(ctx)
  registerContextWindowContentDefinition(ctx)
  registerContextWindowConversationView(ctx)
  ctx.effect(() => ctx.uiSession.provide({
    hooks: ['contextWindow'],
    resolve: binding => ({ hooks: { contextWindow: contextWindowSource(binding) } }),
  }), 'ui-context-window: useContextWindow source')
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'context-window',
    order: 20,
    locale: NS,
    label: () => t('view.contextWindow'),
    inject: (sessionId: SessionId): ContextWindowViewInjected => {
      const session = ctx.sessions.binding(sessionId)?.session
      if (session === undefined) {
        throw new Error(`ui-context-window: session "${sessionId}" is unavailable`)
      }
      return {
        loadThrough: seq => session.loadThrough(SessionSeq(seq)),
      }
    },
  }, ContextWindowView))
}
