/**
 * Orchestration layout mode: registers one choice card and one keyed
 * `layout.mode.entry` into the generic ui-layout-mode host. The mode projects
 * two pinned Sessions and their direct handoff relation.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout-mode/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { OrchestrationModeInjected } from './contract.ts'
import { en, zh, type OrchestrationKey } from './locales.ts'
import { OrchestrationMode } from './OrchestrationMode.tsx'
import { OrchestrationOption } from './OrchestrationOption.tsx'

export type { OrchestrationModeInjected } from './contract.ts'
export type { OrchestrationKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Orchestration mode shell copy. */
    orchestration: OrchestrationKey
  }
}

/** Services required by the mode plugin. */
export const inject = ['slots', 'sessions', 'locale']

const NS = 'orchestration'

/** Register the orchestration mode, its launch card, and its session callbacks. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-orchestration: dictionaries')

  const openSession = (id: Parameters<OrchestrationModeInjected['openSession']>[0]): void => {
    ctx.sessions.open(id)
  }
  const createSession = () => ctx.sessions.create({})
  const retainSession = (id: Parameters<OrchestrationModeInjected['retainSession']>[0]) => ctx.sessions.retain(id)
  const refreshSubagents = (parent: Parameters<OrchestrationModeInjected['refreshSubagents']>[0]): void => {
    ctx.sessions.refreshSubagents(parent)
  }

  ctx.slots.inject('layout.mode.entry', () => ctx.slots.register({
    name: 'layout.mode.entry',
    key: 'orchestration',
    locale: NS,
    inject: (): OrchestrationModeInjected => ({ openSession, createSession, retainSession, refreshSubagents }),
  }, OrchestrationMode))

  ctx.slots.inject('layout.mode.option', () => ctx.slots.register({
    name: 'layout.mode.option',
    id: 'orchestration',
    order: 20,
    locale: NS,
  }, OrchestrationOption))
}
