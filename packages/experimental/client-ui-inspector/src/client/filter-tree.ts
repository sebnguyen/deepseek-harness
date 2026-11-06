/** Display-only filtering of detached Cordis runtime trees. */

import type {
  CordisRuntimeContext,
  CordisRuntimeFiber,
  CordisRuntimeRealm,
  CordisRuntimeTree,
} from '@deepseek-ai/dsh-experimental-inspector/client'

/** Runtime realms shown by the panel. */
export type CordisRealmFilter = 'all' | 'host' | 'client'

/**
 * Select one realm and optionally prune Fibers that expose no nested Fibers,
 * inject declarations, cached services, or provided services. Context layers
 * left without any surviving Fiber also disappear; ancestors remain whenever
 * any descendant survives. The source tree is never mutated.
 * @param tree - Current detached runtime snapshot.
 * @param realm - Realm section to retain; `all` shows every source.
 * @param hideEmpty - Whether inert leaf Fibers should disappear.
 * @returns The unmodified tree, or a filtered copy when requested.
 */
export function filterCordisRuntimeTree(
  tree: CordisRuntimeTree,
  realm: CordisRealmFilter,
  hideEmpty: boolean,
): CordisRuntimeTree {
  if (realm === 'all' && !hideEmpty) return tree
  const projectRealm = (item: CordisRuntimeRealm): CordisRuntimeRealm => hideEmpty
    ? { ...item, root: filterContext(item.root).root }
    : item
  return {
    ...tree,
    host: realm === 'client' || tree.host === null ? null : projectRealm(tree.host),
    clients: realm === 'host' ? [] : tree.clients.map(projectRealm),
  }
}

interface FilteredContext {
  readonly root: CordisRuntimeContext
  readonly hasFibers: boolean
}

function filterContext(context: CordisRuntimeContext): FilteredContext {
  const children = []
  let hasFibers = false
  for (const node of context.children) {
    if (node.kind === 'context') {
      const nested = filterContext(node)
      if (nested.hasFibers) children.push(nested.root)
      hasFibers ||= nested.hasFibers
      continue
    }
    const owned = filterContext(node.children[0])
    if (!owned.hasFibers && !hasServiceFacts(node)) continue
    children.push({ ...node, children: [owned.root] as const })
    hasFibers = true
  }
  return { root: { ...context, children }, hasFibers }
}

function hasServiceFacts(node: CordisRuntimeFiber): boolean {
  return node.inject.length > 0 || node.provides.length > 0 || (node.store?.length ?? 0) > 0
}
