import { defineConfig } from 'tsdown'

/**
 * The twin's extension bundle: one self-contained CJS file the REH
 * extension host `require`s. `vscode` stays external by contract — the
 * extension host supplies it (see `src/vscode-ambient.d.ts`); every
 * workspace dependency (client connection, gateway client, registry, and
 * the api/ide `/remote` artifact) is inlined, so the staged twin needs no
 * node_modules of its own.
 */
export default defineConfig([
  {
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
])
