/**
 * vscodeModulesResolver — seat side. The seat fetches its manifest from the
 * host's webServer over HTTP, then fetches each plane's bundled CJS through
 * the URL its row names and evaluates it into the seat's Loader.
 */

import type { VscodeModulesGraph, VscodeModulesPlugin } from '../manifest.ts'

export interface VscodeBearer {
  readonly dshOrigin: string
}

/**
 * Fetch the manifest the host composed for this seat's spawn.
 * @param dshOrigin - the seat's host origin from bridge.json.
 * @returns the declared plane rows, or the empty declaration.
 */
export async function fetchVscodePlanes(dshOrigin: string): Promise<VscodeModulesGraph> {
  const res = await fetch(`${dshOrigin}/vscode/manifest`)
  if (!res.ok) throw new Error(`vscode-modules: manifest fetch failed (${res.status})`)
  return (await res.json()) as unknown as VscodeModulesGraph
}

/**
 * Vend a `loader.internal` resolver over the manifest: a row's `url` names
 * the plane's bundled CJS, which `evaluate` executes into its exports. The
 * default evaluator supplies exactly `module`/`exports` — plane bundles must
 * be self-contained (every dependency inlined, `vscode` the only external).
 * @param identity - spawn facts carrying the host origin.
 * @param graph - the fetched manifest.
 * @param evaluate - test seam over the CJS evaluator.
 * @returns the resolver sitting behind `Loader.create({ name })`.
 */
export function vscodeModulesResolver(
  identity: VscodeBearer,
  graph: VscodeModulesGraph,
  evaluate?: (code: string) => unknown,
): (name: string) => Promise<unknown> {
  const evaluateFn = evaluate ?? ((code: string): unknown => {
    const mod = { exports: {} }
    new Function('module', 'exports', code)(mod, mod.exports)
    return mod.exports
  })
  const table = new Map<string, VscodeModulesPlugin>(graph.plugins.map(p => [p.id, p]))
  return async function resolve(name: string): Promise<unknown> {
    const row = table.get(name)
    if (row === undefined) throw new Error(`vscode-modules: ${name} not declared in the vscode manifest`)
    const res = await fetch(`${identity.dshOrigin}${row.url}`)
    if (!res.ok) throw new Error(`vscode-modules: fetch ${row.url} failed (${res.status})`)
    return evaluateFn(await res.text())
  }
}
