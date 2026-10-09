/** Unpack seam: marker idempotence, layout refusals, and the real tar. */
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { sha256OfFile } from '../src/manifest.ts'
import { pickServerEntry, unpackTwin } from '../src/unpack.ts'
import type { IdeUnpackLike } from '../src/types.ts'

async function seedPair(root: string): Promise<{ server: string; client: string }> {
  await mkdir(root, { recursive: true })
  const server = join(root, 'reh-server')
  const client = join(root, 'web-client')
  await writeFile(server, 'server-bytes')
  await writeFile(client, 'client-bytes')
  return { server, client }
}

const entryPlacingUnpack: IdeUnpackLike = async (_command, args) => {
  const destination = args[args.indexOf('-C') + 1]!
  await mkdir(destination, { recursive: true })
  if (destination.endsWith('server')) await writeFile(join(destination, 'server.js'), '')
}

describe('pickServerEntry', () => {
  it('prefers the root server.js and falls back to bin/', async () => {
    const rootA = join(tmpdir(), `ide-entry-a-${process.pid}`)
    const rootB = join(rootA, 'alt')
    await mkdir(join(rootB, 'bin'), { recursive: true })
    await writeFile(join(rootA, 'server.js'), '')
    await writeFile(join(rootB, 'bin', 'server.js'), '')
    expect(pickServerEntry(rootA)).toBe(join(rootA, 'server.js'))
    expect(pickServerEntry(rootB)).toBe(join(rootB, 'bin', 'server.js'))
    await expect(async () => pickServerEntry(join(rootA, 'nothing'))).rejects.toMatchObject({ code: 'ide/twin-layout' })
  })
})

describe('unpackTwin', () => {
  it('extracts once and short-circuits on a matching marker', async () => {
    const root = join(tmpdir(), `ide-unpack-${process.pid}-${Date.now()}`)
    const { server, client } = await seedPair(root)
    let runs = 0
    const counting: IdeUnpackLike = async (command, args) => {
      runs += 1
      await entryPlacingUnpack(command, args)
    }
    const first = await unpackTwin({ serverPath: server, clientPath: client, platform: 'linux-x64' }, counting)
    expect(first.serverEntry).toContain('server.js')
    const again = await unpackTwin({ serverPath: server, clientPath: client, platform: 'linux-x64' }, counting)
    expect(again.unpackDir).toBe(first.unpackDir)
    expect(runs).toBe(2)
    const marker = await readFile(join(first.unpackDir, 'ok'), 'utf8')
    expect(marker).toContain(await sha256OfFile(server))
  })

  it('re-extracts when the tarball bytes change under the marker', async () => {
    const root = join(tmpdir(), `ide-unpack-re-${process.pid}-${Date.now()}`)
    const { server, client } = await seedPair(root)
    let runs = 0
    const counting: IdeUnpackLike = async (command, args) => {
      runs += 1
      await entryPlacingUnpack(command, args)
    }
    await unpackTwin({ serverPath: server, clientPath: client, platform: 'linux-x64' }, counting)
    await writeFile(server, 'other-bytes')
    await unpackTwin({ serverPath: server, clientPath: client, platform: 'linux-x64' }, counting)
    expect(runs).toBe(4)
  })

  it.runIf(process.platform !== 'win32')('runs the host tar over real gzip tarballs', async () => {
    const root = join(tmpdir(), `ide-unpack-real-${process.pid}-${Date.now()}`)
    const src = join(root, 'src')
    await mkdir(src, { recursive: true })
    await writeFile(join(src, 'server.js'), 'console.log(42)')
    const tar = promisify(execFile)
    const serverTar = join(root, 'reh-server')
    const clientTar = join(root, 'web-client')
    await tar('tar', ['-czf', serverTar, '-C', src, '.'])
    await tar('tar', ['-czf', clientTar, '-C', src, '.'])
    const unpacked = await unpackTwin({ serverPath: serverTar, clientPath: clientTar, platform: 'linux-x64' })
    expect(unpacked.serverEntry).toBe(join(unpacked.unpackDir, 'server', 'server.js'))
    await expect(readFile(unpacked.serverEntry, 'utf8')).resolves.toBe('console.log(42)')
  })
})
