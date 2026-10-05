/**
 * Stage one of this package's registration: what the `editor` tab type IS.
 *
 * The type claims every `dsh-resource://file/session/<sessionId>/<path>`
 * address at the `builtin` band: it IS the product's editor for files, the
 * position VS Code's text editor holds among its viewers, so any conflicting
 * registration must ask for the `extension` band to win. `canOpen` refuses an
 * address `parseFileAddress` rejects or that has no Session at claim time,
 * where an unclaimed address is the documented wiring error.
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'

/** The tab kind this package owns. */
export const EDITOR_KIND = 'editor'

/** This implementation's identity in the tab system: the key its body registers under. */
export const EDITOR_ID = '@deepseek-ai/dsh-client-ui-editor'

/**
 * The tab title for one `file:` address: its decoded basename.
 *
 * The whole address stays the content identity, so two files with one name in
 * different directories are two tabs; only the chip text is shortened. Decoding
 * is per segment, matching how the address was built, so a name carrying `#`,
 * `?`, or a space reads as itself.
 * @param address - a `file:`-shaped address.
 * @returns the decoded last path segment, or the address itself when it has none.
 */
export function basenameOf(address: string): string {
  const name = address.slice(address.lastIndexOf('/') + 1)
  if (name === '') return address
  try {
    return decodeURIComponent(name)
  } catch {
    // A malformed percent sequence is still a name; showing it raw beats refusing the address.
    return name
  }
}

/**
 * The editor type's registry definition.
 * @returns the definition to register.
 */
export function editorDefinition(): SidebarRightTabDefinition {
  return {
    id: EDITOR_ID,
    kind: EDITOR_KIND,
    patterns: ['dsh-resource://file/**'],
    priority: 'builtin',
    canOpen: address => parseFileAddress(address)?.scope === 'session',
    title: basenameOf,
  }
}
