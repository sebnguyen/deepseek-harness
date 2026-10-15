import { defineConfig } from 'tsdown'

/**
 * The vscode web client's seat bundle: one self-contained CJS file the REH
 * extension host `require`s. `vscode` stays external by contract — the
 * extension host supplies it (see `src/vscode-ambient.d.ts`); every workspace
 * dependency (client connection, gateway client, registry, and the api/ide
 * `/remote` artifact) is inlined, so the staged twin needs no node_modules of
 * its own. The bundle builds only on the vscode face — the host and client
 * workspace passes skip it.
 */
export default defineConfig(({ env }) => {
  if (env?.DSH_BUILD_FACE !== 'vscode') return [{ entry: '' }]
  return [
    {
      name: '@deepseek-ai/dsh-vscode-cordis/seat',
      entry: { extension: 'src/vscode-main.ts' },
      outDir: 'dist-extension',
      format: ['cjs'],
      platform: 'node',
      target: 'es2024',
      deps: {
        alwaysBundle: [/^@deepseek-ai\//],
        neverBundle: ['vscode'],
      },
      fixedExtension: false,
      dts: false,
      sourcemap: false,
      clean: false,
    },
  ]
})
