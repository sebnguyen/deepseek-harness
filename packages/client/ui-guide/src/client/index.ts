/**
 * Harness-guide plugin, browser half — a sidebar trigger that opens the
 * capability roster in a floating launch dialog. The shell (ui-sidebar)
 * declares the `sidebar.guide` seat and supplies the stack site plus its
 * column state; this plugin owns the seat's copy, roster, and dialog.
 * The session list stays in the browsing region.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { en, zh } from './locales.ts'
import { GuideHome } from './GuideHome.tsx'

/** Dictionary namespace owned by this plugin. */
const NS = 'sidebar.guide'

/** Required services: the locale and the slot registry. */
export const inject = ['locale', 'slots']

/**
 * Client plugin body: register the guide dictionaries, then register the
 * guide seat over the shell's `sidebar.guide` hole.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-guide: dictionaries')
  ctx.effect(() => ctx.slots.inject('sidebar.guide', () => ctx.slots.register({
    name: 'sidebar.guide',
    locale: NS,
  }, GuideHome)), 'ui-guide: sidebar guide seat')
}
