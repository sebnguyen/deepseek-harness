/**
 * Shared tsdown preset for vscode-plane packages — the vscode-mirror of the
 * web's `clientBundle()`. A plane builds only on the vscode face and emits
 * one self-contained CJS file at lib/vscode.js; the seat's loader evaluates
 * that file inside the extension host, which supplies `vscode` as the only
 * external import a plane may ever leave unresolved.
 */
import { basename } from 'node:path'
import type { UserConfig } from 'tsdown'

/**
 * An explicit falsey entry removes the package from its current workspace
 * pass; an empty config array would instead fall back to the root defaults.
 */
const SKIP_WORKSPACE_BUILD: UserConfig = { entry: '' }

type BuildFace = 'host' | 'client' | 'vscode' | undefined

type BuildFaceConfig = (inlineConfig: Pick<UserConfig, 'env'>) => UserConfig[]

function buildFace(value: unknown): BuildFace {
  if (value === undefined || value === 'host' || value === 'client' || value === 'vscode') return value
  throw new Error(`tsdown: --env.DSH_BUILD_FACE must be host, client, or vscode, received ${String(value)}`)
}

/**
 * Build the face-gated tsdown config for one vscode-plane package. Host and
 * client passes skip the package entirely; the vscode pass bundles
 * `src/vscode/index.ts` (plus any extra entries) into lib/. Everything imports
 * inline except the `vscode` module, which the extension host provides at
 * activation — a plane's bundle must require nothing else at runtime, because
 * the seat's resolver evaluates the file without a module table.
 * @param id - package name, stamped onto the config for tsdown diagnostics.
 * @param extraEntries - additional vscode-side entry source paths; each emits
 *   beside lib/vscode.js under its own basename.
 * @returns ENV-selected tsdown config for the current build face.
 */
export function vscodeBundle(id: string, extraEntries: readonly string[] = []): BuildFaceConfig {
  return ({ env }) => {
    if (buildFace(env?.DSH_BUILD_FACE) !== 'vscode') return [SKIP_WORKSPACE_BUILD]
    const entry: Record<string, string> = { vscode: 'src/vscode/index.ts' }
    for (const extra of extraEntries) {
      entry[basename(extra, '.ts')] = extra
    }
    return [{
      name: `${id}/vscode`,
      entry,
      outDir: 'lib',
      format: ['cjs'],
      platform: 'node',
      target: 'node20',
      // The plane artifact convention is lib/vscode.js exactly — the
      // manifest row's url and each package's ./vscode export name it.
      outputOptions: { entryFileNames: '[name].js' },
      fixedExtension: false,
      dts: false,
      clean: false,
      deps: {
        // The extension host answers `require('vscode')`; every other
        // specifier — workspace package or npm dep — inlines into the plane.
        neverBundle: ['vscode'],
        alwaysBundle: (specifier: string) => specifier !== 'vscode',
      },
    }]
  }
}
