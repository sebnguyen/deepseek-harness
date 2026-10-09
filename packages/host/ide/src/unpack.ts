/**
 * Unpack a verified twin pair once, beside its tarballs, idempotent on the
 * digest marker. The spawn never execs a tarball: it runs the extracted REH
 * `server.js` under the Host's own node, and the extracted `vscode-web`
 * directory rides as the frame asset root. Default executive is the host's
 * `tar`; tests and exotic filesystems inject a seam.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { sha256OfFile } from './manifest.ts'
import { IdeArtifactError, type IdeUnpackLike, type ResolvedTwin, type UnpackedTwin } from './types.ts'

const runTar: IdeUnpackLike = async (command, args) => {
  await promisify(execFile)(command, [...args], { maxBuffer: 64 * 1024 * 1024 })
}

/**
 * Pick the REH entry of one extracted tree: the official package keeps
 * `server.js` at its root, alternate layouts under `bin/`.
 * @param serverDir - the extraction root of the server tarball.
 * @returns the entry path, refusing by `ide/twin-layout` when neither exists.
 */
export function pickServerEntry(serverDir: string): string {
  for (const candidate of ['server.js', join('bin', 'server.js')]) {
    if (existsSync(join(serverDir, candidate))) return join(serverDir, candidate)
  }
  throw new IdeArtifactError('ide/twin-layout', `no REH server entry under ${serverDir}`)
}

/**
 * Unpack the twin unless the marker already names these exact tarballs.
 * A different digest re-extracts from scratch, so a republished twin cannot
 * spawn from stale bytes under an unchanged sha.
 * @param twin - the verified tarball pair.
 * @param run - the tar executive; the host's `tar` when absent.
 * @returns the spawn-ready face of the twin.
 */
export async function unpackTwin(twin: ResolvedTwin, run: IdeUnpackLike = runTar): Promise<UnpackedTwin> {
  const unpackDir = join(twin.serverPath, '..', '.unpack')
  const marker = join(unpackDir, 'ok')
  const serverDigest = twin.serverSha256 ?? await sha256OfFile(twin.serverPath)
  const clientDigest = twin.clientSha256 ?? await sha256OfFile(twin.clientPath)
  const stamp = `${serverDigest} ${clientDigest}`
  let fresh: string | undefined
  try {
    fresh = (await readFile(marker, 'utf8')).trim()
  }
  catch {
    fresh = undefined
  }
  if (fresh !== stamp) {
    await rm(unpackDir, { recursive: true, force: true })
    await mkdir(join(unpackDir, 'server'), { recursive: true })
    await mkdir(join(unpackDir, 'web'), { recursive: true })
    await run('tar', ['-xzf', twin.serverPath, '-C', join(unpackDir, 'server')])
    await run('tar', ['-xzf', twin.clientPath, '-C', join(unpackDir, 'web')])
    await writeFile(marker, `${stamp}\n`)
  }
  return {
    serverEntry: pickServerEntry(join(unpackDir, 'server')),
    clientDir: join(unpackDir, 'web'),
    unpackDir,
  }
}
