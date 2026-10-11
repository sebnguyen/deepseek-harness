/**
 * Browser half: register `vscode` as a right-Sidebar tab type.
 *
 * The type reaches the Sidebar through its public path only: the definition
 * into `ctx.sidebarRightTabs`, the body into the keyed
 * `sidebar.right.pane.tab` seat under the definition's `id`. The host face
 * contributes nothing; status reads run straight through the injected
 * `ideBridge` remote namespace.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { VscodeBody, type VscodeInjected } from './VscodeBody.tsx'
import { VSCODE_ID, VSCODE_KIND, vscodeDefinition } from './definition.ts'
import { en, zh } from './locales.ts'
import type { VscodeIdeRemote } from './rpc.ts'

export type { VscodeKey } from './locales.ts'
export type { VscodeBodyProps, VscodeInjected } from './VscodeBody.tsx'
export type { IdeBridgeStatus, VscodeIdeRemote } from './rpc.ts'
export { VSCODE_ID, VSCODE_KIND, vscodeDefinition } from './definition.ts'
export { basenameOf } from './name.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** VS Code mount-state lines. */
    vscode: import('./locales.ts').VscodeKey
  }
}

/**
 * Required browser services: the tab registry, the slots, copy, and the Remote
 * carrier with its `ideBridge` namespace.
 */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight', 'remote', 'remote.ideBridge']

/**
 * Client plugin body: register the type, its dictionaries, and its body.
 * @param ctx - client root context carrying the registry, the slots, copy, and the Remote face.
 */
export function apply(ctx: ClientContext): void {
  const remote = ctx.remote as unknown as VscodeIdeRemote
  const face: VscodeInjected = {
    status: (sessionId, signal) => remote.ideBridge.status(sessionId, signal),
  }
  ctx.effect(() => ctx.sidebarRightTabs.register(vscodeDefinition()), 'ui-vscode: vscode type')
  ctx.effect(() => ctx.locale.register('vscode', { zh, en }), 'ui-vscode: dictionaries')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    {
      name: 'sidebar.right.pane.tab',
      key: VSCODE_ID,
      locale: 'vscode',
      inject: (): VscodeInjected => face,
    },
    VscodeBody,
  )), 'ui-vscode: vscode body')

  // The twin is the harness's editor: mount it as soon as a session surface
  // exists rather than waiting for a file-row click. The session-scoped path
  // (`openTabIn`, not the mounted-session `openTab`) reaches every adopted
  // session, and pages deduplicate within their pane, so a re-adoption
  // opening twice is a no-op. A thrown claim (the type not registered yet)
  // simply loses to the next adoption.
  ctx.effect(() => ctx.sidebarRight.onSessionAdopted((sessionId) => {
    try {
      ;(ctx.sidebarRight as unknown as { openTabIn(sessionId: string, kind: string): void })
        .openTabIn(sessionId, VSCODE_KIND)
    } catch {
    }
  }), 'ui-vscode: auto-open twin on session adoption')
}
