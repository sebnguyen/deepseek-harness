/**
 * Claim chip plugin, browser half: the per-Turn claim status in two
 * placements. While the session's claim is pending, a strip docked above the
 * composer shows it — visible while deep diving through a long turn. After
 * settlement the verdict chip sits in the finished Turn's icon action row,
 * between copy / Like / Dislike and the usage / time pills, and stays there,
 * so a failed claim remains visible on the finished Turn. Durable state
 * arrives through the `claim` Session projection; this plugin only reads it
 * and has no actions.
 * @module @deepseek-ai/dsh-client-ui-claim/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the assistant-actions and input.dock slot declarations.
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the Session standard useProjection seat.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the renderer-owned slots service.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { ClaimAction, ClaimDock } from './ClaimChip.tsx'
import { en, NS, zh, type ClaimKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The turn claim chip's copy. */
    claim: ClaimKey
  }
}

/** Required services: the slot registry and the copy. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: register the dictionaries, the action-row entry, and
 * the dock entry.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-claim: dictionaries')
  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions',
    id: 'claim',
    order: 10,
    locale: NS,
  }, ClaimAction))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'claim',
    order: 15,
    locale: NS,
  }, ClaimDock))
}
