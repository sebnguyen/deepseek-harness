/**
 * Browser half: register `vscode` as a right-Sidebar tab type that claims file
 * addresses ahead of the CodeMirror editor while the frame is ready, plus the
 * iframe body under the tab's seat. Readiness rides the `ide` event stream; the
 * registry's `canOpen` reads only the synchronous mirror, so a dead child drops
 * every backlogged claim to the fallback in the same session.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-host-ide/remote'
import { VSCODE_ID, vscodeDefinition } from './definition.ts'
import { en, zh } from './locales.ts'
import type { IdeClientFace } from './rpc.ts'
import { VscodeBody, type VscodeBodyProps } from './VscodeBody.tsx'

export { VSCODE_ID, VSCODE_KIND, vscodeDefinition } from './definition.ts'
export type { IdeClientFace, IdeWireStatus, SessionFileRef } from './rpc.ts'
export { sessionFileOf } from './rpc.ts'
export type { VscodeKey } from './locales.ts'
export { VscodeBody, type VscodeBodyProps } from './VscodeBody.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Frame tab copy: loading and degrade lines. */
    vscode: import('./locales.ts').VscodeKey
  }
}

/** Required browser services: the registry, slots, copy, and the Remote carrier's `ide` face. */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'remote', 'remote.ide']

/**
 * Client plugin body: register the type, its dictionaries, and its body.
 * @param ctx - client root context carrying the registry, slots, copy, and Remote face.
 */
export function apply(ctx: ClientContext): void {
  const ide = (ctx.remote as { ide: IdeClientFace }).ide
  let ready = false
  const controller = new AbortController()
  ctx.effect(() => {
    void (async () => {
      for await (const status of ide.events(controller.signal)) ready = status.ready
    })()
    return () => controller.abort()
  }, 'ui-vscode: readiness mirror')
  ctx.effect(() => ctx.locale.register('vscode', { zh, en }), 'ui-vscode: dictionaries')
  ctx.effect(() => ctx.sidebarRightTabs.register(vscodeDefinition(() => ready)), 'ui-vscode: frame tab type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    {
      name: 'sidebar.right.pane.tab',
      key: VSCODE_ID,
      locale: 'vscode',
      inject: (): Pick<VscodeBodyProps, 'ide'> => ({ ide }),
    },
    VscodeBody,
  )), 'ui-vscode: frame body')
}
