/**
 * Stage one of this package's registration: what the `vscode` tab type IS.
 *
 * The type claims every `dsh-resource://file/<session>/<path>` address at the
 * `extension` band — one above the text editor's `builtin` — because when the
 * twin runs this IS the product's editor and any fallback must be out-bid.
 * The `canOpen` check only validates the address: readiness is a body
 * responsibility, so a claim never fails behind an asynchronous status poll.
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { basenameOf } from './name.ts'

/** The tab kind this package owns. */
export const VSCODE_KIND = 'vscode'

/** This implementation's identity in the tab system: the key its body registers under. */
export const VSCODE_ID = '@deepseek-ai/dsh-client-ui-vscode'

/**
 * The vscode tab type's registry definition.
 * @returns the definition to register.
 */
export function vscodeDefinition(): SidebarRightTabDefinition {
  return {
    id: VSCODE_ID,
    kind: VSCODE_KIND,
    patterns: ['dsh-resource://file/**'],
    priority: 'extension',
    canOpen: address => parseFileAddress(address)?.scope === 'session',
    title: basenameOf,
  }
}
