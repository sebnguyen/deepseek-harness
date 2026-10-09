/**
 * The manifest row and the twin digest dance: parse the pinned row, digest what
 * the cache or override offers, and refuse loud on any mismatch so a wrong twin
 * never spawns. The `DSH_IDE_TWIN_DIR` override is the prototype escape hatch
 * that consumes a digested Gitpod tarball; it verifies digests against the
 * manifest too unless `DSH_IDE_TWIN_NOVERIFY` unlatches the digest check.
 */
import { createHash } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { IdeArtifactError, type IdeManifestRow, type ResolvedTwin } from './types.ts'

const SHA1 = /^[0-9a-f]{40}$/
const SHA256 = /^[0-9a-f]{64}$/
const PLATFORM_KEY = /^[a-z0-9]+-[a-z0-9]+$/

/** The platform key this host would spawn for, matching the lane's artifact names. */
export function idePlatform(platform: string = process.platform, arch: string = process.arch): string {
  return `${platform === 'win32' ? 'win32' : platform}-${arch}`
}

/** The platform key of this process. */
export const IDE_PLATFORM = idePlatform()

/**
 * Parse and validate the manifest row text. Every refusal is a named
 * `ide/manifest-invalid` error; a row that parses but fails a shape check never
 * reaches the resolver.
 * @param text - the manifest JSON as carried in the repository.
 * @returns the validated row.
 */
export function parseManifest(text: string): IdeManifestRow {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new IdeArtifactError('ide/manifest-invalid', 'ide manifest is not valid JSON')
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new IdeArtifactError('ide/manifest-invalid', 'ide manifest must be a JSON object')
  const row = raw as Record<string, unknown>
  if (typeof row.upstreamSha !== 'string' || !SHA1.test(row.upstreamSha))
    throw new IdeArtifactError('ide/manifest-invalid', 'ide manifest upstreamSha must be a full 40-hex commit sha')
  if (typeof row.upstreamUrl !== 'string' || !row.upstreamUrl.startsWith('https://'))
    throw new IdeArtifactError('ide/manifest-invalid', 'ide manifest upstreamUrl must be an https remote')
  if (typeof row.twins !== 'object' || row.twins === null || Array.isArray(row.twins))
    throw new IdeArtifactError('ide/manifest-invalid', 'ide manifest twins must be an object of platform rows')
  const twins: Record<string, { readonly serverSha256: string; readonly clientSha256: string }> = {}
  for (const [platform, twin] of Object.entries(row.twins as Record<string, unknown>)) {
    if (!PLATFORM_KEY.test(platform))
      throw new IdeArtifactError('ide/manifest-invalid', `ide manifest platform key ${JSON.stringify(platform)} is not a platform key`)
    if (typeof twin !== 'object' || twin === null)
      throw new IdeArtifactError('ide/manifest-invalid', `ide manifest twin for ${platform} must be an object`)
    const { serverSha256, clientSha256 } = twin as Record<string, unknown>
    if (typeof serverSha256 !== 'string' || !SHA256.test(serverSha256) || typeof clientSha256 !== 'string' || !SHA256.test(clientSha256))
      throw new IdeArtifactError('ide/manifest-invalid', `ide manifest twin for ${platform} must carry sha256 digests`)
    twins[platform] = { serverSha256, clientSha256 }
  }
  return { upstreamSha: row.upstreamSha, upstreamUrl: row.upstreamUrl, twins }
}

/**
 * sha256 of one file, hex.
 * @param path - existing file to digest.
 * @returns the hex digest.
 */
export async function sha256OfFile(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Resolve the twin pair for this platform in mandate order: an explicit
 * `DSH_IDE_TWIN_DIR` override first, then the content-addressed cache
 * `<cacheDir>/<upstreamSha>/<platform>`. A directory naming itself but holding a
 * half twin refuses; a digest mismatch refuses unless the noverify latch is set
 * AND the directory is the override; a cache miss resolves `undefined`, the
 * frame-absent posture the M1 fallback rides.
 * @param row - the validated manifest row.
 * @param env - spawn environment, read for the override and latch only.
 * @param cacheDir - the artifact cache root the lane writes.
 * @returns the resolved twin, or undefined when no twin is present.
 */
export async function resolveTwin(
  row: IdeManifestRow,
  env: Readonly<Record<string, string | undefined>>,
  cacheDir: string,
): Promise<ResolvedTwin | undefined> {
  const override = env.DSH_IDE_TWIN_DIR
  const noverify = override !== undefined && env.DSH_IDE_TWIN_NOVERIFY !== undefined
  const dirs: Array<{ readonly dir: string; readonly isOverride: boolean }> = override === undefined
    ? [{ dir: join(cacheDir, row.upstreamSha, IDE_PLATFORM), isOverride: false }]
    : [{ dir: override, isOverride: true }]
  for (const { dir, isOverride } of dirs) {
    const serverPath = join(dir, 'reh-server')
    const clientPath = join(dir, 'web-client')
    const [hasServer, hasClient] = await Promise.all([exists(serverPath), exists(clientPath)])
    if (!hasServer && !hasClient) continue
    if (!hasServer || !hasClient)
      throw new IdeArtifactError('ide/twin-incomplete', `twin under ${dir} carries only one of server and client`)
    const want = row.twins[IDE_PLATFORM]
    if (want === undefined) {
      if (isOverride && noverify) return { serverPath, clientPath, platform: 'override' }
      throw new IdeArtifactError('ide/twin-unrecorded', `manifest records no ${IDE_PLATFORM} twin to verify against`)
    }
    const [serverSha256, clientSha256] = await Promise.all([sha256OfFile(serverPath), sha256OfFile(clientPath)])
    if (serverSha256 !== want.serverSha256 || clientSha256 !== want.clientSha256) {
      if (isOverride && noverify) return { serverPath, clientPath, platform: 'override' }
      throw new IdeArtifactError('ide/sha-mismatch', `twin under ${dir} does not match the manifest sha256 for ${IDE_PLATFORM}`)
    }
    return { serverPath, clientPath, platform: IDE_PLATFORM, serverSha256, clientSha256 }
  }
  return undefined
}
