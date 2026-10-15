/**
 * vscode-modules builds two faces: on the vscode pass the seat-side resolver
 * bundles to lib/vscode.js; on the host pass (and the unspecified default)
 * the empty array falls back to the root workspace defaults, which emit the
 * ordinary lib/index.js library from the tsc pass.
 */
import { defineConfig } from 'tsdown'
import { vscodeBundle } from '../tsdown.vscode.ts'

export default defineConfig(({ env }) => {
  const face = env?.DSH_BUILD_FACE
  if (face === 'vscode') return vscodeBundle('@deepseek-ai/dsh-vscode-modules')({ env })
  if (face === 'client') return [{ entry: '' }]
  return []
})
