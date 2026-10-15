/** The host-side registry: route mounting discipline and the roster-scan contracts. */

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
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
  ctx.provide('webServer', {
    register(route: CapturedRoute): () => void {
      routes.push(route)
      return () => undefined
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
    manifest?.handler({}, {
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
    plane?.handler({}, {
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

const TESTS_DIR = fileURLToPath(new URL('.', import.meta.url))
const PLANE_BYTES = readFileSync(new URL('./fixtures/dsh-vscode-spec-plane/lib/vscode.js', import.meta.url))

function loaderRow(name: string) {
  return {
    options: { name },
    fiber: {},
    parent: { tree: { ctx: { baseUrl: TESTS_DIR } } },
  }
}

function registryWith(host: { names: string[] }) {
  const ctx = new Context()
  const warnings: string[] = []
  const routes: CapturedRoute[] = []
  ctx.provide('webServer', {
    register(route: CapturedRoute): () => void {
      routes.push(route)
      return () => undefined
    },
  })
  Object.assign(ctx, {
    loader: { entries: () => host.names.map(loaderRow) },
    logger: { warn: (message: string) => { warnings.push(message) } },
  })
  const registry = new VscodeModulesRegistry(ctx)
  return { ctx, registry, warnings, routes }
}

describe('VscodeModulesRegistry roster scan', () => {
  it('composes exactly the dsh.vscode packages into the manifest', () => {
    const { registry } = registryWith({ names: ['./fixtures/dsh-vscode-spec-plane', './fixtures/dsh-spec-host-only'] })
    const expectedRev = createHash('sha1').update(PLANE_BYTES).digest('hex').slice(0, 12)
    const graph = registry.graph()
    expect(graph.plugins).toEqual([{
      id: 'dsh-vscode-spec-plane',
      name: 'dsh-vscode-spec-plane',
      rev: expectedRev,
      url: '/vscode/plugin/dsh-vscode-spec-plane',
      inject: ['vscodeApi'],
      external: [],
      immediately: true,
    }])
    expect(graph.rev).toMatch(/^v1:/)
  })

  it('keeps the manifest bit-identical across recompositions of an unchanged roster', () => {
    const { registry } = registryWith({ names: ['./fixtures/dsh-vscode-spec-plane'] })
    expect(JSON.stringify(registry.graph())).toBe(JSON.stringify(registry.graph()))
  })

  it('serves the plane bytes at its manifest url', () => {
    const { routes } = registryWith({ names: ['./fixtures/dsh-vscode-spec-plane'] })
    const route = routes.find(({ path }) => path === '/vscode/plugin')
    let status = 0
    let body: Buffer | undefined
    route?.handler({ method: 'GET', url: '/vscode/plugin/dsh-vscode-spec-plane' }, {
      writeHead: (code: number) => { status = code },
      end: (chunk: Buffer) => { body = chunk },
    })
    expect(status).toBe(200)
    expect(body?.toString('utf8')).toBe(PLANE_BYTES.toString('utf8'))
  })

  it('drops a declared-but-unbuilt plane loudly', () => {
    const { registry, warnings } = registryWith({ names: ['./fixtures/dsh-vscode-unbuilt-plane'] })
    expect(registry.graph()).toEqual({ rev: 'empty', plugins: [] })
    expect(warnings.join('\n')).toContain('lib/vscode.js is missing')
  })

  it('logs a plane removal when the roster drops it', async () => {
    const names = ['./fixtures/dsh-vscode-spec-plane']
    const { ctx, registry, warnings } = registryWith({ names })
    expect(registry.graph().plugins).toHaveLength(1)
    names.length = 0
    ctx.emit('internal/plugin', {} as never)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(registry.graph()).toEqual({ rev: 'empty', plugins: [] })
    expect(warnings.join('\n')).toContain('dsh-vscode-spec-plane left the roster')
  })
})
