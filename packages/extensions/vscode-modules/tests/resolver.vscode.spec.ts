/** Seat-side resolver: manifest fetch, row lookup, byte fetch, and evaluation. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchVscodePlanes, vscodeModulesResolver, type VscodeBearer } from '../src/vscode/index.ts'

const MANIFEST = {
  rev: 'v1:deadbeef',
  plugins: [{
    id: 'dsh-vscode-timeline',
    name: '@deepseek-ai/dsh-vscode-timeline',
    rev: '4d2u',
    url: '/vscode/plugin/dsh-vscode-timeline',
    inject: ['vscodeApi', 'remote.timeline'],
    external: [],
    immediately: true,
  }],
}

const IDENTITY: VscodeBearer = { dshOrigin: 'http://127.0.0.1:4455' }

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('fetchVscodePlanes', () => {
  it('reads the manifest off the seat\'s host origin', async () => {
    let fetched = ''
    vi.stubGlobal('fetch', async (input: string) => {
      fetched = input
      return Response.json(MANIFEST)
    })
    const graph = await fetchVscodePlanes(IDENTITY.dshOrigin)
    expect(fetched).toBe('http://127.0.0.1:4455/vscode/manifest')
    expect(graph).toEqual(MANIFEST)
  })

  it('fails loudly when the host refuses the manifest fetch', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 404 }))
    await expect(fetchVscodePlanes(IDENTITY.dshOrigin))
      .rejects.toThrow('vscode-modules: manifest fetch failed (404)')
  })
})

describe('vscodeModulesResolver', () => {
  it('fetches the row\'s bundled CJS at its declared URL and evaluates it', async () => {
    let fetched = ''
    vi.stubGlobal('fetch', async (input: string) => {
      fetched = input
      return new Response('module.exports.name = "timeline"')
    })
    const resolve = vscodeModulesResolver(IDENTITY, MANIFEST)
    await expect(resolve('dsh-vscode-timeline')).resolves.toMatchObject({ name: 'timeline' })
    expect(fetched).toBe('http://127.0.0.1:4455/vscode/plugin/dsh-vscode-timeline')
  })

  it('refuses names the manifest never declared', async () => {
    const resolve = vscodeModulesResolver(IDENTITY, MANIFEST)
    await expect(resolve('dsh-vscode-unknown')).rejects.toThrow('dsh-vscode-unknown not declared')
  })

  it('fails loudly when a row\'s bytes do not arrive', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 500 }))
    const resolve = vscodeModulesResolver(IDENTITY, MANIFEST)
    await expect(resolve('dsh-vscode-timeline'))
      .rejects.toThrow('vscode-modules: fetch /vscode/plugin/dsh-vscode-timeline failed (500)')
  })
})
