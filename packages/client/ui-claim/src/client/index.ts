/**
 * Claim chip plugin, browser half: the claim status in two placements.
 * The owning turn's icon action row lists its claims — pending or settled,
 * scoped to the turn that declared them — and the composer's accessory row
 * carries a compact Claims trigger whose dropdown menu lists the latest
 * turn's claims with an aggregate status dot. Durable state arrives through
 * the `claim` Session projection; this plugin only reads it and has no
 * actions.
 * @module @deepseek-ai/dsh-client-ui-claim/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the assistant-actions slot declaration.
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: pulls the input.right slot declaration.
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
 * the composer-seat entry.
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
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'claim',
    order: 15,
    locale: NS,
  }, ClaimDock))
}
