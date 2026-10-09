/**
 * The manifest row and twin digest dance: every refusal named, every happy
 * path resolved, and the override escape hatch held to the latch's letter.
 */
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { idePlatform, IDE_PLATFORM, parseManifest, resolveTwin, sha256OfFile } from '../src/manifest.ts'
import { IdeArtifactError, type IdeManifestRow } from '../src/types.ts'

function catchOf(fn: () => unknown): unknown {
  try {
    fn()
    return undefined
  }
  catch (error) {
    return error
  }
}

const SHA = 'f'.repeat(40)
const S_GOOD = 'a'.repeat(64)
const C_GOOD = 'b'.repeat(64)
const S_BAD = 'c'.repeat(64)

function row(twins: Record<string, unknown> = {}): IdeManifestRow {
  return parseManifest(JSON.stringify({ upstreamSha: SHA, upstreamUrl: 'https://github.com/microsoft/vscode.git', twins }))
}

describe('parseManifest', () => {
  it('accepts a well-formed row', () => {
    const parsed = row({ [IDE_PLATFORM]: { serverSha256: S_GOOD, clientSha256: C_GOOD } })
    expect(parsed.twins[IDE_PLATFORM]).toEqual({ serverSha256: S_GOOD, clientSha256: C_GOOD })
  })
  it.each([
    ['not json', '{'],
    ['non-object', '"str"'],
    ['array', '[]'],
    ['bad sha', JSON.stringify({ upstreamSha: 'xyz', upstreamUrl: 'https://x', twins: {} })],
    ['bad url', JSON.stringify({ upstreamSha: SHA, upstreamUrl: 'http://x', twins: {} })],
    ['twins non-object', JSON.stringify({ upstreamSha: SHA, upstreamUrl: 'https://x', twins: [] })],
    ['bad platform key', JSON.stringify({ upstreamSha: SHA, upstreamUrl: 'https://x', twins: { 'Nope!': { serverSha256: S_GOOD, clientSha256: C_GOOD } } })],
    ['twin non-object', JSON.stringify({ upstreamSha: SHA, upstreamUrl: 'https://x', twins: { 'linux-x64': null } })],
    ['bad digests', JSON.stringify({ upstreamSha: SHA, upstreamUrl: 'https://x', twins: { 'linux-x64': { serverSha256: 'x', clientSha256: C_GOOD } } })],
  ])('refuses %s with ide/manifest-invalid', (_name, text) => {
    const thrown = catchOf(() => parseManifest(text))
    expect(thrown).toBeInstanceOf(IdeArtifactError)
    expect((thrown as IdeArtifactError).code).toBe('ide/manifest-invalid')
  })
})

describe('resolveTwin', () => {
  let cache: string
  beforeEach(async () => {
    cache = await mkdtemp(join(tmpdir(), 'ide-cache-'))
  })

  async function seed(dir: string, server: boolean, client: boolean, serverDigest = 'srv', clientDigest = 'cli'): Promise<void> {
    const { mkdir } = await import('node:fs/promises')
    await mkdir(dir, { recursive: true })
    if (server) await writeFile(join(dir, 'reh-server'), serverDigest)
    if (client) await writeFile(join(dir, 'web-client'), clientDigest)
  }

  it('resolves undefined on a cold cache and a cold override', async () => {
    expect(await resolveTwin(row(), {}, cache)).toBeUndefined()
    expect(await resolveTwin(row(), { DSH_IDE_TWIN_DIR: join(cache, 'elsewhere') }, cache)).toBeUndefined()
  })

  it('refuses a half twin in the cache', async () => {
    await seed(join(cache, SHA, IDE_PLATFORM), true, false)
    await expect(resolveTwin(row(), {}, cache)).rejects.toMatchObject({ code: 'ide/twin-incomplete' })
  })

  it('refuses an unrecorded verified twin and an unverified verified twin in the cache', async () => {
    const dir = join(cache, SHA, IDE_PLATFORM)
    await seed(dir, true, true)
    await expect(resolveTwin(row(), {}, cache)).rejects.toMatchObject({ code: 'ide/twin-unrecorded' })
    // noverify only unlatches the OVERRIDE, never the cache.
    await expect(resolveTwin(row(), { DSH_IDE_TWIN_NOVERIFY: '1' }, cache)).rejects.toMatchObject({ code: 'ide/twin-unrecorded' })
  })

  it('refuses a digest mismatch in the cache', async () => {
    const dir = join(cache, SHA, IDE_PLATFORM)
    await seed(dir, true, true)
    await expect(resolveTwin(row({ [IDE_PLATFORM]: { serverSha256: S_GOOD, clientSha256: C_GOOD } }), {}, cache)).rejects.toMatchObject({ code: 'ide/sha-mismatch' })
  })

  it('resolves a matching cache twin', async () => {
    const dir = join(cache, SHA, IDE_PLATFORM)
    await seed(dir, true, true)
    const serverSha256 = await sha256OfFile(join(dir, 'reh-server'))
    const clientSha256 = await sha256OfFile(join(dir, 'web-client'))
    const twin = await resolveTwin(row({ [IDE_PLATFORM]: { serverSha256, clientSha256 } }), {}, cache)
    expect(twin).toEqual({ serverPath: join(dir, 'reh-server'), clientPath: join(dir, 'web-client'), platform: IDE_PLATFORM })
  })

  it('holds the override to the same digests without the latch', async () => {
    const dir = join(cache, 'override')
    await seed(dir, true, true)
    await expect(resolveTwin(row({ [IDE_PLATFORM]: { serverSha256: S_GOOD, clientSha256: C_GOOD } }), { DSH_IDE_TWIN_DIR: dir }, cache)).rejects.toMatchObject({ code: 'ide/sha-mismatch' })
    await expect(resolveTwin(row(), { DSH_IDE_TWIN_DIR: dir }, cache)).rejects.toMatchObject({ code: 'ide/twin-unrecorded' })
  })

  it('unlatches the override with DSH_IDE_TWIN_NOVERIFY', async () => {
    const dir = join(cache, 'override')
    await seed(dir, true, true)
    const env = { DSH_IDE_TWIN_DIR: dir, DSH_IDE_TWIN_NOVERIFY: '1' }
    const mismatched = await resolveTwin(row({ [IDE_PLATFORM]: { serverSha256: S_BAD, clientSha256: C_GOOD } }), env, cache)
    expect(mismatched?.platform).toBe('override')
    const unrecorded = await resolveTwin(row(), env, cache)
    expect(unrecorded?.platform).toBe('override')
  })

  it('refuses a half override', async () => {
    const dir = join(cache, 'half')
    await seed(dir, false, true)
    await expect(resolveTwin(row(), { DSH_IDE_TWIN_DIR: dir, DSH_IDE_TWIN_NOVERIFY: '1' }, cache)).rejects.toMatchObject({ code: 'ide/twin-incomplete' })
  })

  it('verifies a recorded override against the manifest', async () => {
    const dir = join(cache, 'verified')
    await seed(dir, true, true)
    const serverSha256 = await sha256OfFile(join(dir, 'reh-server'))
    const clientSha256 = await sha256OfFile(join(dir, 'web-client'))
    const twin = await resolveTwin(row({ [IDE_PLATFORM]: { serverSha256, clientSha256 } }), { DSH_IDE_TWIN_DIR: dir }, cache)
    expect(twin?.platform).toBe(IDE_PLATFORM)
  })

  it('names the platform key per OS convention', () => {
    expect(idePlatform('win32', 'x64')).toBe('win32-x64')
    expect(idePlatform('linux', 'arm64')).toBe('linux-arm64')
    expect(idePlatform('darwin', 'x64')).toBe('darwin-x64')
  })
})
