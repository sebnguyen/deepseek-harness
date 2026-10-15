/** The host-side registry: route mounting discipline and today's empty-graph contract. */

import { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { VscodeModulesRegistry } from '../src/registry.ts'

interface CapturedRoute {
  kind?: string
  path?: string
  handler: (req: unknown, res: Record<string, unknown>) => void
}

function registryWithWebServer(): { registry: VscodeModulesRegistry; routes: CapturedRoute[] } {
  const ctx = new Context()
  const routes: CapturedRoute[] = []
  Object.assign(ctx, {
    webServer: {
      register(route: CapturedRoute): void {
        routes.push(route)
      },
    },
  })
  return { registry: new VscodeModulesRegistry(ctx), routes }
}

describe('VscodeModulesRegistry', () => {
  it('mounts the manifest and plugin prefix routes when a webServer face exists', () => {
    const { routes } = registryWithWebServer()
    expect(routes.map(({ path }) => path)).toEqual(['/vscode/manifest', '/vscode/plugin'])
  })

  it('registers nothing against a bare seat context (no webServer face)', () => {
    const registry = new VscodeModulesRegistry(new Context())
    expect(registry.graph()).toEqual({ rev: 'empty', plugins: [] })
  })

  it('serves the empty manifest until the roster scan lands', async () => {
    const { routes } = registryWithWebServer()
    const manifest = routes.find(({ path }) => path === '/vscode/manifest')
    expect(manifest).toBeDefined()
    const chunks: string[] = []
    manifest?.handler({} as IncomingMessage, {
      writeHead: () => undefined,
      end: (body: string) => { chunks.push(body) },
    })
    expect(JSON.parse(chunks.join(''))).toEqual({ rev: 'empty', plugins: [] })
  })

  it('answers 404 for a plane fetch while no plane is composed', async () => {
    const { routes } = registryWithWebServer()
    const plane = routes.find(({ path }) => path === '/vscode/plugin')
    expect(plane).toBeDefined()
    let status = 0
    let body = ''
    plane?.handler({} as IncomingMessage, {
      writeHead: (code: number) => { status = code },
      end: (chunk: string) => { body = chunk },
    })
    expect(status).toBe(404)
    expect(JSON.parse(body)).toEqual({ error: 'no vscode plane composed' })
  })

  it('resolves stageToSpawn as a no-op on the empty graph', async () => {
    const registry = new VscodeModulesRegistry(new Context())
    await expect(registry.stageToSpawn('/tmp/dsh-vscode-modules-spec')).resolves.toBeUndefined()
  })
})
