/** The fetch vehicle: asset naming, verification, idempotence, refusal paths. */
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assetNames, defaultReleaseBase, FetchError, fetchTwin, type FetchOptions } from './fetch.ts'

const row = {
  upstreamSha: 'a'.repeat(40),
  twins: {
    'linux-x64': {
      serverSha256: '0'.repeat(64),
      clientSha256: '1'.repeat(64),
    },
  },
}

const options = (twinDir: string, download?: FetchOptions['download']): FetchOptions => ({
  row,
  platformKey: 'linux-x64',
  base: 'https://example.test/dl',
  twinDir,
  download,
})

describe('assetNames', () => {
  it('names release assets per platform with the shared web twin', () => {
    expect(assetNames('linux-x64')).toEqual({ server: 'vscode-reh-linux-x64.tar.gz', client: 'vscode-web.tar.gz' })
    expect(assetNames('darwin-arm64')).toEqual({ server: 'vscode-reh-darwin-arm64.tar.gz', client: 'vscode-web.tar.gz' })
  })
})

describe('defaultReleaseBase', () => {
  it('names the default base off the release fork and the pin tag', () => {
    expect(defaultReleaseBase('abc', { DSH_IDE_RELEASE_REPO: 'me/vscode' })).toBe('https://github.com/me/vscode/releases/download/dsh-ide-abc')
    expect(defaultReleaseBase('abc', {})).toContain('deepseek-ai/vscode-dsh')
  })
})

describe('fetchTwin', () => {
  it('verifies downloaded bytes against the row and installs both files', async () => {
    const serverBytes = new TextEncoder().encode('server-tar')
    const clientBytes = new TextEncoder().encode('client-tar')
    const twinDir = join(tmpdir(), `ide-fetch-ok-${process.pid}-${Date.now()}`)
    const seen: string[] = []
    const good: FetchOptions = {
      row: {
        upstreamSha: row.upstreamSha,
        twins: {
          'linux-x64': {
            serverSha256: createHash('sha256').update(serverBytes).digest('hex'),
            clientSha256: createHash('sha256').update(clientBytes).digest('hex'),
          },
        },
      },
      platformKey: 'linux-x64',
      base: 'https://example.test/dl',
      twinDir,
      download: async (url) => {
        seen.push(url)
        return url.includes('vscode-reh') ? serverBytes : clientBytes
      },
    }
    expect(await fetchTwin(good)).toBe(true)
    expect(seen).toEqual([
      'https://example.test/dl/vscode-reh-linux-x64.tar.gz',
      'https://example.test/dl/vscode-web.tar.gz',
    ])
    expect(await readFile(join(twinDir, 'reh-server'), 'utf8')).toBe('server-tar')
    expect(await readFile(join(twinDir, 'web-client'), 'utf8')).toBe('client-tar')
  })

  it('short-circuits the network when the digests already match', async () => {
    const serverBytes = new TextEncoder().encode('server-tar')
    const clientBytes = new TextEncoder().encode('client-tar')
    const twinDir = join(tmpdir(), `ide-fetch-idem-${process.pid}-${Date.now()}`)
    const base: FetchOptions = {
      row: {
        upstreamSha: row.upstreamSha,
        twins: {
          'linux-x64': {
            serverSha256: createHash('sha256').update(serverBytes).digest('hex'),
            clientSha256: createHash('sha256').update(clientBytes).digest('hex'),
          },
        },
      },
      platformKey: 'linux-x64',
      base: 'https://example.test/dl',
      twinDir,
      download: async url => (url.includes('vscode-reh') ? serverBytes : clientBytes),
    }
    expect(await fetchTwin(base)).toBe(true)
    let calls = 0
    expect(await fetchTwin({ ...base, download: async () => {
      calls += 1
      return serverBytes
    } })).toBe(false)
    expect(calls).toBe(0)
  })

  it('refuses mismatched bytes by code and leaves no partials', async () => {
    const serverBytes = new TextEncoder().encode('server-tar')
    const twinDir = join(tmpdir(), `ide-fetch-bad-${process.pid}-${Date.now()}`, 'twin')
    const bad: FetchOptions = {
      row: {
        upstreamSha: row.upstreamSha,
        twins: {
          'linux-x64': {
            serverSha256: createHash('sha256').update('other').digest('hex'),
            clientSha256: '1'.repeat(64),
          },
        },
      },
      platformKey: 'linux-x64',
      base: 'https://example.test/dl',
      twinDir,
      download: async () => serverBytes,
    }
    await expect(fetchTwin(bad)).rejects.toMatchObject({ code: 'ide/twin-fetch-mismatch' })
    const entries = await readdir(twinDir).catch(() => [])
    expect(entries).toEqual([])
  })

  it('refuses unrecorded platforms before any download', async () => {
    const twinDir = join(tmpdir(), `ide-fetch-none-${process.pid}-${Date.now()}`)
    await expect(fetchTwin({
      ...options(twinDir, async () => new Uint8Array()),
      platformKey: 'darwin-arm64',
    })).rejects.toMatchObject({ code: 'ide/twin-unrecorded' })
  })

  it('surfaces unreachable releases by code', async () => {
    const twinDir = join(tmpdir(), `ide-fetch-down-${process.pid}-${Date.now()}`)
    const failing = options(twinDir, async () => {
      throw new FetchError('ide/twin-fetch-failed', 'GET nope answered 503')
    })
    await expect(fetchTwin({
      ...failing,
      row: { upstreamSha: row.upstreamSha, twins: { 'linux-x64': { serverSha256: '0'.repeat(64), clientSha256: '1'.repeat(64) } } },
    })).rejects.toMatchObject({ code: 'ide/twin-fetch-failed' })
  })

  expect(FetchError).toBeTypeOf('function')
})
