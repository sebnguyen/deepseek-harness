/**
 * Best-effort twin landing on `pnpm install`: developers with a network get
 * the verified tarballs AND their extraction, so the first editor open in a
 * session pays a marker read, not a tar run; hermetic CI, offline machines,
 * and any refusal print one line and leave the frame-absent posture, which
 * is not an error. Opt out with DSH_IDE_NO_FETCH=1 or CI=1.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { unpackTwin } from '../../packages/host/ide/src/unpack.ts'
import { defaultReleaseBase, fetchTwin, type FetchOptions, type FetchRow } from './fetch.ts'

export interface PostinstallOptions {
  readonly env: Readonly<Record<string, string | undefined>>
  /** Test seam; defaults to the repository's `manifest.default.json`. */
  readonly row?: FetchRow | undefined
  readonly download?: FetchOptions['download']
  readonly unpack?: Parameters<typeof unpackTwin>[1]
  readonly digests?: { readonly serverSha256: string; readonly clientSha256: string } | undefined
  readonly log?: (line: string) => void
}

/**
 * Fetch then unpack the pinned twin; every refusal is one printed line.
 * @param options - env plus network, tar, and row seams for tests.
 * @returns the line the install log shows.
 */
export async function runPostinstall(options: PostinstallOptions): Promise<string> {
  const log = options.log ?? ((line: string) => console.log(line))
  if (options.env.DSH_IDE_NO_FETCH !== undefined || options.env.CI !== undefined) return 'ide: fetch skipped by env'
  try {
    const row = options.row ?? JSON.parse(await readFile(join(import.meta.dirname, 'manifest.default.json'), 'utf8')) as FetchRow
    const platformKey = options.env.DSH_IDE_BUILD_PLATFORM ?? `${process.platform}-${process.arch}`
    const cacheDir = options.env.DSH_IDE_CACHE_DIR ?? join(options.env.HOME ?? '/tmp', '.cache', 'dsh', 'ide')
    const twinDir = join(cacheDir, row.upstreamSha, platformKey)
    const want = row.twins[platformKey]
    const fetched = await fetchTwin({
      row,
      platformKey,
      base: defaultReleaseBase(row.upstreamSha, options.env),
      twinDir,
      download: options.download,
    })
    const unpacked = await unpackTwin({
      serverPath: join(twinDir, 'reh-server'),
      clientPath: join(twinDir, 'web-client'),
      platform: platformKey,
      serverSha256: options.digests?.serverSha256 ?? want?.serverSha256,
      clientSha256: options.digests?.clientSha256 ?? want?.clientSha256,
    }, options.unpack)
    const line = fetched
      ? `ide: twin fetched and unpacked (${platformKey})`
      : `ide: twin already current (${platformKey})`
    log(`${line}: ${unpacked.serverEntry}`)
    return line
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const line = 'ide: twin not fetched (frame falls back to the editor lane)'
    log(`${line}: ${message}`)
    return line
  }
}

const fileBase = process.argv[1] !== undefined ? process.argv[1].split('/').at(-1) : undefined
if (fileBase === 'postinstall.ts') {
  void runPostinstall({ env: process.env })
}
