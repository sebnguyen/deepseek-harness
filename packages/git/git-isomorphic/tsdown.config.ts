import { defineConfig } from 'tsdown'

/**
 * Build the index and the walk worker as separate single-entry bundles. The
 * sibling `worker.cjs` is loaded by file from `lib/` and must be CommonJS for
 * plain-Node worker launch; a multi-entry build would emit a shared chunk the
 * package's exact `files` whitelist omits, so the builds stay separate.
 */
export default defineConfig([
  {
    entry: ['lib/types/index.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    entry: ['lib/types/worker.js'],
    outDir: 'lib',
    format: ['cjs'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
])
