/**
 * The stable twin token: minted once per workspaceKey, pinned beside the
 * port pin in the twin state dir, and reissued verbatim across respawns so
 * parked client iframes keep their bearer credentials through a twin death.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { stableTwinToken, twinTokenPinName } from '../src/twin-token.ts'

const mounted: string[] = []

/** One throwaway state dir per case, swept on teardown. */
async function stateDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ide-twin-token-'))
  mounted.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(mounted.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('stableTwinToken', () => {
  it('mints a base64url token, pins it, and reissues it on respawn', async () => {
    const dir = await stateDir()
    const first = await stableTwinToken(dir, '/repos/main')
    expect(first).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect((await readFile(join(dir, twinTokenPinName('/repos/main')), 'utf8')).trim()).toBe(first)
    // The respawn read is the byte-for-byte reissue clients depend on.
    expect(await stableTwinToken(dir, '/repos/main')).toBe(first)
  })

  it('keys pins per workspaceKey so sibling twins never share a token', async () => {
    const dir = await stateDir()
    const a = await stableTwinToken(dir, '/repos/a')
    const b = await stableTwinToken(dir, '/repos/b')
    expect(a).not.toBe(b)
    expect(await stableTwinToken(dir, '/repos/a')).toBe(a)
    expect(await stableTwinToken(dir, '/repos/b')).toBe(b)
  })

  it('regenerates past a corrupt pin and rewrites the pin', async () => {
    const dir = await stateDir()
    const pinFile = join(dir, twinTokenPinName('/repos/main'))
    await writeFile(pinFile, 'not-a-token\n', 'utf8')
    const token = await stableTwinToken(dir, '/repos/main')
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect((await readFile(pinFile, 'utf8')).trim()).toBe(token)
    expect(await stableTwinToken(dir, '/repos/main')).toBe(token)
  })
})
