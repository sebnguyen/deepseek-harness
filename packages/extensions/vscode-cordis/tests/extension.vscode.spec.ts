/**
 * spawnBridgeSeat: the Loader milestone contract — rows from the host's
 * vscode manifest compose onto the seat one apiece, a failing plane is
 * dropped without stranding its siblings, and a host that serves no
 * manifest leaves the seat bridge-only.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { spawnBridgeSeat } from '../src/extension.ts'

const ORIGIN = 'http://127.0.0.1:4455'
const IDENTITY = { dshOrigin: ORIGIN, token: 'tkn-1', workspaceKey: 'ws-1' } as const
const WORKBENCH = {
  workspaceRoot: null,
  showTextDocument: async () => undefined,
}

const FLAG = '__SEAT_SPEC_PLANES__'

function manifestFor(rows: Array<Record<string, unknown>>) {
  return {
    rev: 'v1:spec',
    plugins: rows.map(row => ({
      rev: 'x',
      external: [],
      immediately: true,
      inject: [],
      ...row,
    })),
  }
}

function planeBundle(name: string, apply: string): string {
  const key = JSON.stringify(name)
  return `const f = (globalThis.${FLAG} ??= {}); f[${key}] = (f[${key}] ?? 0) + 1; module.exports = { ${apply} }`
}

async function bootSeat(manifest: unknown, planes: Record<string, string>): Promise<{
  counts: Record<string, number>
  seat: Awaited<ReturnType<typeof spawnBridgeSeat>>
}> {
  const priorFetch = globalThis.fetch
  globalThis.fetch = async (input: unknown) => {
    const url = typeof input === 'string' ? input : (input as { href: string }).href
    if (url === `${ORIGIN}/vscode/manifest`) {
      if (manifest === null) return new Response('nope', { status: 404 })
      return new Response(JSON.stringify(manifest), { status: 200 })
    }
    for (const [id, bytes] of Object.entries(planes)) {
      if (url === `${ORIGIN}/vscode/plugin/${id}`) return new Response(bytes, { status: 200 })
    }
    return new Response('unmatched', { status: 501 })
  }
  const fetchLike = async () => new Response('')
  try {
    const seat = await spawnBridgeSeat({ identity: IDENTITY, workbench: WORKBENCH, fetchLike })
    const counts = ((globalThis as unknown as Record<string, Record<string, number>>)[FLAG] ??= {})
    return { counts, seat }
  } finally {
    globalThis.fetch = priorFetch
  }
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, FLAG)
})

describe('spawnBridgeSeat (Loader milestone)', () => {
  it('composes every manifest row onto the seat', async () => {
    const manifest = manifestFor([
      { id: 'plane-a', name: 'plane-a', url: '/vscode/plugin/plane-a' },
      { id: 'plane-b', name: 'plane-b', url: '/vscode/plugin/plane-b' },
    ])
    const planes = {
      'plane-a': planeBundle('plane-a', 'apply() {}'),
      'plane-b': planeBundle('plane-b', 'apply() {}'),
    }
    const { counts, seat } = await bootSeat(manifest, planes)
    expect(counts['plane-a']).toBe(1)
    expect(counts['plane-b']).toBe(1)
    await seat.stop()
  }, 15000)

  it('drops a plane whose apply fails and mounts the rest', async () => {
    const manifest = manifestFor([
      { id: 'plane-bad', name: 'plane-bad', url: '/vscode/plugin/plane-bad' },
      { id: 'plane-good', name: 'plane-good', url: '/vscode/plugin/plane-good' },
    ])
    const planes = {
      'plane-bad': 'module.exports = { apply() { throw new Error("boom") } }',
      'plane-good': planeBundle('plane-good', 'apply() {}'),
    }
    const { counts, seat } = await bootSeat(manifest, planes)
    expect(counts['plane-good']).toBe(1)
    expect(counts['plane-bad']).toBeUndefined()
    await seat.stop()
  }, 15000)

  it('stays bridge-only when the host serves no manifest', async () => {
    const { seat } = await bootSeat(null, {})
    await seat.stop()
  }, 15000)
})
