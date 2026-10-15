import { defineConfig } from 'tsdown'
import { typertPlugin } from './packages/typert/generator/lib/types/tsdown-plugin.js'

type BuildFace = 'host' | 'client' | 'vscode' | undefined

function buildFace(value: unknown): BuildFace {
  if (value === undefined || value === 'host' || value === 'client' || value === 'vscode') return value
  throw new Error(`tsdown: --env.DSH_BUILD_FACE must be host, client, or vscode, received ${String(value)}`)
}

/**
 * The ordinary workspace build consumes JavaScript emitted by the face's own
 * aggregate tsc pass. The Host pass runs Typert; the Client pass selects
 * packages that declare a browser bundle; the vscode pass covers the vscode
 * web client's planes (packages/extensions/vscode-*), whose package-local
 * one-line configs carry every build fact.
 */
export default defineConfig(({ env }) => {
  const face = buildFace(env?.DSH_BUILD_FACE)
  if (face === 'vscode') {
    return {
      workspace: ['packages/extensions/vscode-*'],
      entry: '',
      outDir: 'lib',
      format: ['cjs'],
      platform: 'node',
      target: 'node20',
      fixedExtension: false,
      dts: false,
      clean: false,
      plugins: [],
    }
  }
  const client = face === 'client'
  return {
    workspace: client
      ? ['vendor/*', 'packages/*/*', 'apps/cli']
      : ['vendor/*', 'packages/*/*', 'apps/cli', 'apps/desktop', 'apps/desktop-host'],
    entry: client ? '' : ['lib/types/{index,invariant,startup}.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    plugins: client ? [] : [typertPlugin({ mode: 'workspace', faces: ['host'] })],
  }
})
