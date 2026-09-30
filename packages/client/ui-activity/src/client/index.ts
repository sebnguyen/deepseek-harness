/**
 * Background-activity plugin, browser half: contributes one input-dock entry
 * that unifies this session's background jobs and subagent descendants into a
 * chip and drawer. The data arrives entirely through the `jobsBySession` and
 * `subagentsByParent` list mirrors plus the session summaries, so the plugin
 * issues no RPC of its own; the two callbacks it injects route through the
 * sessions service's existing catalog verbs.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { ActivityDock } from './ActivityDock.tsx'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { en, NS, zh, type ActivityKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Background-activity chip and drawer copy. */
    'activity': ActivityKey
  }
}

export type { ActivityDockInjected, ActivityDockProps } from './ActivityDock.tsx'

/** Required services for the dock entry, its session callbacks, and copy. */
export const inject = ['sessions', 'slots', 'locale']

/**
 * Client plugin body: register the dictionaries and the composer-stack dock entry.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-activity: dictionaries')
  const sessions = ctx.sessions
  ctx.slots.inject(
    'conversation.composer.dock',
    () => ctx.slots.register({
      name: 'conversation.composer.dock',
      id: 'activity',
      locale: NS,
      inject: sessionId => ({
        onRefresh() {
          void sessions.refreshSubagents(sessionId)
        },
        onOpenChild(childId) {
          // Prefer the exact-address route; a child the catalog has not
          // reached yet still opens straight into its own session.
          const address = sessions.subagentAddress(SessionId(childId))
          if (address !== undefined) sessions.openSubagent(address)
          else sessions.open(SessionId(childId))
        },
      }),
    }, ActivityDock),
  )
}
