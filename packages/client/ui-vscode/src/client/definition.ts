/**
 * Stage one of this package's registration: what the `vscode` tab type IS.
 *
 * The type claims every `dsh-resource://file/session/<sessionId>/<path>`
 * address at the same `builtin` band the CodeMirror editor holds; the roster
 * order places this registration ahead of it, so while the frame is ready
 * this type wins every claim the editor would have won, and the moment
 * readiness drops the editor's claim returns untouched.
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'

/** The tab kind this package owns. */
export const VSCODE_KIND = 'vscode'

/** This implementation's identity in the tab system: the key its body registers under. */
export const VSCODE_ID = '@deepseek-ai/dsh-client-ui-vscode'

/**
 * The tab title for one `file:` address: its decoded basename, matching the
 * fallback editor's chip so the two seats read as peers in the registry.
 * @param address - a `file:`-shaped address.
 * @returns the decoded last path segment, or the address itself when it has none.
 */
export function basenameOf(address: string): string {
  const name = address.slice(address.lastIndexOf('/') + 1)
  if (name === '') return address
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

/**
 * The frame tab's registry definition.
 * `canOpen` is the degrade contract: it reads live readiness, never probes the
 * iframe, because the Host that spawned the child is the authority on liveness.
 * @param isReady - synchronous readiness reader fed by the `ide` event stream.
 * @returns the definition to register.
 */
export function vscodeDefinition(isReady: () => boolean): SidebarRightTabDefinition {
  return {
    id: VSCODE_ID,
    kind: VSCODE_KIND,
    patterns: ['dsh-resource://file/**'],
    priority: 'builtin',
    canOpen: address => parseFileAddress(address)?.scope === 'session' && isReady(),
    title: basenameOf,
  }
}
