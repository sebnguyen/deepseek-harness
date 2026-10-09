/**
 * The only IDE artifact vehicle in this repository: download the twin pair a
 * `dsh-ide-<sha>` tag of the forked IDE-source repository publishes onto its
 * GitHub release, verify every byte against the manifest row this repository
 * carries, and install it under the content-addressed cache the host
 * resolver already reads. The build of those artifacts lives entirely on the
 * fork; here there is nothing to compile, only to fetch and verify.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sha256OfFile } from '../../packages/host/ide/src/manifest.ts'

export class FetchError extends Error {
  constructor(readonly code: 'ide/twin-unrecorded' | 'ide/twin-fetch-mismatch' | 'ide/twin-fetch-failed', message: string) {
    super(message)
    this.name = 'FetchError'
  }
}

export interface FetchRow {
  readonly upstreamSha: string
  readonly twins: Readonly<Record<string, { readonly serverSha256: string; readonly clientSha256: string }>>
}

export interface FetchOptions {
  readonly row: FetchRow
  readonly platformKey: string
  /** Release base ending in the tag, e.g. .../releases/download/dsh-ide-<sha>. */
  readonly base: string
  readonly twinDir: string
  /** Test seam standing in for the network. */
  readonly download?: ((url: string) => Promise<Uint8Array>) | undefined
}

/** Release asset names the fork uploads and this vehicle downloads. */
export function assetNames(platformKey: string): { server: string; client: string } {
  return { server: `vscode-reh-${platformKey}.tar.gz`, client: 'vscode-web.tar.gz' }
}

const downloadBytes = async (url: string): Promise<Uint8Array> => {
  const response = await fetch(url)
  if (!response.ok) throw new FetchError('ide/twin-fetch-failed', `GET ${url} answered ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

/**
 * Default release base: the IDE-source fork tags `dsh-ide-<sha>` per upstream
 * pin; the repo variable DSH_IDE_RELEASE_REPO retargets the fork slug.
 * @param upstreamSha - the pinned microsoft/vscode commit.
 * @param env - read for the release repo override.
 * @returns the asset base url.
 */
export function defaultReleaseBase(upstreamSha: string, env: Readonly<Record<string, string | undefined>> = process.env): string {
  const repo = env.DSH_IDE_RELEASE_REPO ?? 'deepseek-ai/vscode-dsh'
  return `https://github.com/${repo}/releases/download/dsh-ide-${upstreamSha}`
}

async function land(name: string, bytes: Uint8Array, want: string, target: string): Promise<void> {
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== want) throw new FetchError('ide/twin-fetch-mismatch', `${name}: sha256 ${actual.slice(0, 12)} is not the row's ${want.slice(0, 12)}`)
  const partial = `${target}.part`
  await writeFile(partial, bytes)
  await rename(partial, target)
}

/**
 * Fetch and install the twin pair idempotently: digests already on disk that
 * match the row short-circuit the network entirely. Any failure leaves no
 * partial file behind, so the frame stays frame-absent and the fallback
 * posture holds.
 * @param options - row, platform, base, cache target, and seams.
 * @returns true when bytes were fetched, false when already present.
 */
export async function fetchTwin(options: FetchOptions): Promise<boolean> {
  const want = options.row.twins[options.platformKey]
  if (want === undefined) throw new FetchError('ide/twin-unrecorded', `the row records no ${options.platformKey} twin to fetch`)
  const serverTarget = join(options.twinDir, 'reh-server')
  const clientTarget = join(options.twinDir, 'web-client')
  const present = async (path: string, digest: string): Promise<boolean> => {
    try {
      await stat(path)
      return (await sha256OfFile(path)) === digest
    }
    catch {
      return false
    }
  }
  const haveServer = await present(serverTarget, want.serverSha256)
  const haveClient = await present(clientTarget, want.clientSha256)
  if (haveServer && haveClient) return false
  const download = options.download ?? downloadBytes
  const names = assetNames(options.platformKey)
  await mkdir(options.twinDir, { recursive: true })
  const cleanup = async (): Promise<void> => {
    await rm(`${serverTarget}.part`, { force: true })
    await rm(`${clientTarget}.part`, { force: true })
  }
  try {
    if (!haveServer) await land(names.server, await download(`${options.base}/${names.server}`), want.serverSha256, serverTarget)
    if (!haveClient) await land(names.client, await download(`${options.base}/${names.client}`), want.clientSha256, clientTarget)
  }
  catch (error) {
    await cleanup()
    throw error
  }
  return true
}

const fileBase = process.argv[1] !== undefined ? process.argv[1].split('/').at(-1) : undefined
if (fileBase === 'fetch.ts') {
  const args = process.argv.slice(2)
  const baseFlag = args.indexOf('--base')
  void (async () => {
    const row = JSON.parse(await readFile(join(import.meta.dirname, 'manifest.default.json'), 'utf8')) as FetchRow
    const platformKey = process.env.DSH_IDE_BUILD_PLATFORM ?? `${process.platform}-${process.arch}`
    const cacheDir = process.env.DSH_IDE_CACHE_DIR ?? join(process.env.HOME ?? '/tmp', '.cache', 'dsh', 'ide')
    const flagValue = args[baseFlag + 1]
    const base = baseFlag >= 0 && flagValue !== undefined ? flagValue : defaultReleaseBase(row.upstreamSha)
    const twinDir = join(cacheDir, row.upstreamSha, platformKey)
    const fetched = await fetchTwin({ row, platformKey, base, twinDir })
    console.log(fetched ? `fetched ${platformKey} twin into ${twinDir}` : `${platformKey} twin already matches the row`)
  })()
}
