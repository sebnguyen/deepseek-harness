/**
 * The stable twin port: deterministic per dist, de-collided within the
 * harness band, and pinned so later boots keep the same origin.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { pickStablePort } from '../src/twin-port.ts'

const mounted: string[] = []
const servers: Server[] = []

/** One throwaway state dir per case, swept on teardown. */
async function stateDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ide-twin-port-'))
  mounted.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(mounted.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => {
    server.close(() => resolve())
  })))
})

/** Occupy a loopback port until teardown. */
async function occupy(port: number): Promise<void> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve())
  })
  servers.push(server)
}

describe('pickStablePort', () => {
  it('is deterministic for one dist and pins its choice', async () => {
    const dir = await stateDir()
    const first = await pickStablePort(dir, '/repos/main')
    expect(first).not.toBeNull()
    expect(await pickStablePort(dir, '/repos/main')).toBe(first)
    expect((await readFile(join(dir, 'port'), 'utf8')).trim()).toBe(String(first))
  })

  it('lands in the harness band and seeds differ across dist paths', async () => {
    const ports = new Set<number>()
    for (const dist of ['/repos/a', '/repos/b', '/repos/c', '/repos/d']) {
      const port = await pickStablePort(await stateDir(), dist)
      expect(port).not.toBeNull()
      if (port !== null) {
        expect(port).toBeGreaterThanOrEqual(45961)
        expect(port).toBeLessThan(45961 + 420)
        ports.add(port)
      }
    }
    expect(ports.size).toBeGreaterThanOrEqual(2)
  })

  it('walks past a collision instead of binding it', async () => {
    const dir = await stateDir()
    const { createHash } = await import('node:crypto')
    const base = 45961 + (createHash('sha1').update('/repos/collide').digest().readUInt32BE(0) % 420)
    await occupy(base)
    const port = await pickStablePort(dir, '/repos/collide')
    expect(port).not.toBeNull()
    expect(port).not.toBe(base)
  })

  it('keeps the pin when it stays free across boots', async () => {
    const dir = await stateDir()
    const first = await pickStablePort(dir, '/repos/pinned')
    const second = await pickStablePort(dir, '/repos/somewhere-else')
    expect(second).toBe(first)
  })
})
