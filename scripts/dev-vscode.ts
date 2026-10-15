/**
 * Watch-build for the vscode dev loop (mirror of scripts/dev-web.ts): keeps
 * every artifact a vscode web client seat consumes rebuilt from source edits.
 *
 * Two compile lanes: `tsc -b tsconfig.vscode.json` emits the face type trees,
 * and `tsdown --env.DSH_BUILD_FACE vscode` re-bundles each plane's
 * `lib/vscode.js` plus the bridge extension's `dist-extension/extension.cjs`
 * — the two byte streams a seat reads (the plane manifest resolves rows
 * against `lib/vscode.js`; the REW extension host requires the staged
 * `extension.cjs` from the stateDir, refreshed per spawn by `postbuild`'s
 * vscode:twin lane).
 *
 * Hot rewire (the note's Layer 8 downlink `dsh/frame/vscodeModules/rebuild/*`
 * listener) is not this script's business: the seat re-reads the manifest on
 * its next boot, so a respawned twin picks up rebuilt planes. The live
 * dispose/recreate listener is tracked by the mirror note's dev-loop row.
 *
 * MUST NOT run concurrently with `pnpm run build` (same output trees).
 *
 * Usage: `pnpm exec tsx scripts/dev-vscode.ts [--poll[=ms]]`.
 */

import { execa } from 'execa'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

const TSC_WATCH = [
  'node_modules/typescript/bin/tsc',
  '-b', 'tsconfig.vscode.json',
  '--watch',
]

const TSDOWN_WATCH = [
  'tsdown',
  '--env.DSH_BUILD_FACE', 'vscode',
  '--watch',
]

const procs = [
  execa('node', TSC_WATCH, { cwd: repoRoot, stdout: 'inherit', stderr: 'inherit', preferLocal: true }),
  execa('pnpm', TSDOWN_WATCH, { cwd: repoRoot, stdout: 'inherit', stderr: 'inherit' }),
]

const shutdown = (): void => {
  for (const proc of procs) proc.kill('SIGTERM')
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

console.log('dev:vscode: watching tsconfig.vscode.json + tsdown vscode face')
await Promise.all(procs)
