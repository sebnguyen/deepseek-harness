/** Postinstall vehicle: env latches, fetch+unpack landing, refusal lines. */
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runPostinstall } from './postinstall.ts'
import type { IdeUnpackLike } from '../../packages/host/ide/src/types.ts'
import type { FetchRow } from './fetch.ts'

const entryUnpack: IdeUnpackLike = async (_command, args) => {
  const destination = args[args.indexOf('-C') + 1]!
  await mkdir(destination, { recursive: true })
  if (destination.endsWith('server')) await writeFile(join(destination, 'server.js'), '')
}

describe('runPostinstall', () => {
  const serverBytes = new TextEncoder().encode('server-tar')
  const clientBytes = new TextEncoder().encode('client-tar')
  const row: FetchRow = {
    upstreamSha: 'b'.repeat(40),
    twins: {
      'linux-x64': {
        serverSha256: createHash('sha256').update(serverBytes).digest('hex'),
        clientSha256: createHash('sha256').update(clientBytes).digest('hex'),
      },
    },
  }

  it('latches on CI and DSH_IDE_NO_FETCH before any work', async () => {
    expect(await runPostinstall({ env: { CI: '1' } })).toBe('ide: fetch skipped by env')
    expect(await runPostinstall({ env: { DSH_IDE_NO_FETCH: '1' } })).toBe('ide: fetch skipped by env')
  })

  it('fetches, verifies, unpacks, and reports the spawn entry', async () => {
    const cacheDir = join(tmpdir(), `ide-post-${process.pid}-${Date.now()}`)
    const lines: string[] = []
    let tars = 0
    const line = await runPostinstall({
      env: { DSH_IDE_CACHE_DIR: cacheDir, DSH_IDE_BUILD_PLATFORM: 'linux-x64' },
      row,
      download: async url => (url.includes('vscode-reh') ? serverBytes : clientBytes),
      unpack: async (command, args) => {
        tars += 1
        await entryUnpack(command, args)
      },
      log: l => lines.push(l),
    })
    expect(line).toBe('ide: twin fetched and unpacked (linux-x64)')
    expect(lines[0]).toContain('server.js')
    expect(tars).toBe(2)
    // Second run: digests already current, marker already matched, no tars.
    const again = await runPostinstall({
      env: { DSH_IDE_CACHE_DIR: cacheDir, DSH_IDE_BUILD_PLATFORM: 'linux-x64' },
      row,
      download: async () => serverBytes,
      unpack: async (command, args) => {
        tars += 1
        await entryUnpack(command, args)
      },
      log: () => {},
    })
    expect(again).toBe('ide: twin already current (linux-x64)')
    expect(tars).toBe(2)
  })

  it('refuses unrecorded platforms before any download', async () => {
    const cacheDir = join(tmpdir(), `ide-post-none-${process.pid}-${Date.now()}`)
    const line = await runPostinstall({
      env: { DSH_IDE_CACHE_DIR: cacheDir, DSH_IDE_BUILD_PLATFORM: 'darwin-arm64' },
      row,
      download: async () => serverBytes,
      unpack: entryUnpack,
    })
    expect(line).toBe('ide: twin not fetched (frame falls back to the editor lane)')
  })

  it('prints the fallback line when the network refuses', async () => {
    const cacheDir = join(tmpdir(), `ide-post-fail-${process.pid}-${Date.now()}`)
    const line = await runPostinstall({
      env: { DSH_IDE_CACHE_DIR: cacheDir, DSH_IDE_BUILD_PLATFORM: 'linux-x64' },
      row,
      download: async () => {
        throw new Error('boom 503')
      },
      unpack: entryUnpack,
    })
    expect(line).toBe('ide: twin not fetched (frame falls back to the editor lane)')
  })
})
