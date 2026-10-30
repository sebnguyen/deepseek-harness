/**
 * Turbo layout mode: registers one choice card and one keyed
 * `layout.mode.entry` into the generic ui-layout-mode host. The mode is pinned
 * for the window by the chooser; this package owns the Turbo composition and
 * the session callbacks its cells use.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout-mode/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { createTarget, type TurboModeInjected } from './contract.ts'
import { en, zh, type TurboKey } from './locales.ts'
import { TurboMode } from './TurboMode.tsx'
import { TurboOption } from './TurboOption.tsx'

export type { TurboModeInjected, TurboSessionTarget } from './contract.ts'
export type { TurboKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Turbo shell copy. */
    turbo: TurboKey
  }
}

/** Services required by the mode plugin. */
export const inject = ['slots', 'sessions', 'workspaces', 'uiWorkspace', 'locale']

const NS = 'turbo'

/** Register the Turbo mode, its launch card, and its session callbacks. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-turbo: dictionaries')

  const createSession = (target?: Parameters<TurboModeInjected['createSession']>[0]) => ctx.sessions.create(
    createTarget(
      ctx.workspaces.list.getSnapshot().items,
      target,
      ctx.uiWorkspace.defaultWorkspaceId(),
    ) ?? {},
  )
  const openSession = (id: Parameters<TurboModeInjected['openSession']>[0]): void => { ctx.sessions.open(id) }
  const clearSession = (): void => { ctx.sessions.clear() }
  const retainSession = (id: Parameters<TurboModeInjected['retainSession']>[0]) => ctx.sessions.retain(id)

  ctx.slots.inject('layout.mode.entry', () => ctx.slots.register({
    name: 'layout.mode.entry',
    key: 'turbo',
    locale: NS,
    inject: (): TurboModeInjected => ({ createSession, openSession, clearSession, retainSession }),
  }, TurboMode))

  ctx.slots.inject('layout.mode.option', () => ctx.slots.register({
    name: 'layout.mode.option',
    id: 'turbo',
    order: 10,
    locale: NS,
  }, TurboOption))
}
