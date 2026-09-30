/**
 * The guide tab's identity, the page-address scheme, and default page selection.
 *
 * These live in the contract because two sides need them and neither may read
 * the other: the store seeds new panes from the registry, and the guide
 * domain registers the type under the same kind.
 *
 * The docking kit treats `kind` as opaque, so these strings mean something only
 * here and in the registry. Both types go through the same two stages any other
 * type would use — the guide is not special in the machinery, only in being
 * always available.
 */
import type { SidebarRightTabRegistry } from '../tab-registry.ts'

/** One pane's initial page, resolved from the current registered guide entries. */
export interface SidebarRightSeed {
  readonly kind: string
  readonly title: string
}

/**
 * Resolve the default page: the guide, whatever is registered.
 *
 * The explorer column owns the session's always-visible file tree, so an
 * emptied pane returns to the guide's overview rather than to a second tree.
 * @param tabs - current tab registry.
 * @returns the guide's kind and title.
 */
export function defaultSeed(tabs: SidebarRightTabRegistry): SidebarRightSeed {
  const definition = tabs.get(GUIDE_KIND)
  if (definition === undefined) throw new Error(`sidebarRight: default tab kind "${GUIDE_KIND}" is not registered`)
  return { kind: GUIDE_KIND, title: definition.title(pageAddress(GUIDE_KIND)) }
}

/** The guide tab's kind. */
export const GUIDE_KIND = 'guide'

/**
 * The address a page tab is recorded under: `sidebar://<kind>`. The scheme is
 * this package's bookkeeping for `openTab`, spelled here and nowhere else; a
 * caller names the kind and never sees or composes the address.
 * @param kind - the page type's kind.
 * @returns the page's address.
 */
export function pageAddress(kind: string): string {
  return `sidebar://${kind}`
}
