import { defineConfig } from 'tsdown'

/**
 * The seat bundle: one self-contained module for the twin's ext-host. The
 * house client halves — cordis, the typert registry, the api gateway
 * client, the connection carrier, and the generated `ide` and
 * `checkpoint` remote bundles — inline here exactly as they inline into
 * the served web bundle, so the only ambient the seat needs at runtime is
 * `vscode` and the spawn env. The fork's gulp lane re-bundles this same
 * entry CJS when the twin's loader asks for it.
 */
export default defineConfig([
  {
    entry: ['lib/types/entry.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    external: ['vscode'],
    noExternal: [/^@deepseek-ai\//u, /^zod(\/|$)/u],
  },
])
