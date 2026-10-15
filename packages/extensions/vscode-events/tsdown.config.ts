import { defineConfig } from 'tsdown'
import { vscodeBundle } from '../tsdown.vscode.ts'

/**
 * Face-aware like the neighboring plane packages: the vscode pass bundles
 * src/vscode/index.ts to lib/vscode.js; the client pass skips; every other
 * pass defers to the root workspace defaults (host lib repackage).
 */
export default defineConfig(({ env }) => {
  const face = env?.DSH_BUILD_FACE
  if (face === 'vscode') return vscodeBundle('@deepseek-ai/dsh-vscode-events')({ env })
  if (face === 'client') return [{ entry: '' }]
  return []
})
