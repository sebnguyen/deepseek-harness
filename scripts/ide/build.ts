/**
 * The IDE build lane: materialize the pinned VS Code seat into the shared
 * content-addressed cache, verify the seat's node engine against the host's,
 * apply the overlay, and drive the two gulp lanes that emit the twin pair at
 * their real output paths, recording sha256s back into the manifest row.
 *
 * Run with --dry-run to print the exact command plan without touching disk or
 * network; the real run shells git and gulp exactly as a CI runner would, so a
 * human machine and CI share one code path. The seat's own `.nvmrc` names the
 * node engine; the runner (human shell or workflow) provides it, and the lane
 * refuses by code when the host's node differs.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface ManifestRow {
  upstreamSha: string
  upstreamUrl: string
  twins: Record<string, { serverSha256: string; clientSha256: string }>
}

export interface LaneOptions {
  readonly cacheDir: string
  /** Directory of this script and the overlay. */
  readonly scriptsDir: string
  /** Node the runner provides for the seat's gulp lanes, without the v. */
  readonly hostNode: string
  /** Platform key the gulp task names ride, `linux-x64` shape. */
  readonly platformKey: string
  /** Test seam in place of a real process launch log. */
  readonly launch?: (command: string, args: string[]) => void
  readonly manifestPath?: string
}

export class LaneError extends Error {
  constructor(readonly code: 'ide/seat-node-invalid' | 'ide/seat-node-mismatch' | 'ide/seat-platform-unsupported', message: string) {
    super(message)
    this.name = 'LaneError'
  }
}

/** The platform key of this process, matching the lane's artifact names. */
export function lanePlatformKey(platform: string, arch: string): string {
  return `${platform === 'win32' ? 'win32' : platform}-${arch}`
}

/** The seat content-addressed under the cache root. */
export function seatPath(cacheDir: string, upstreamSha: string): string {
  return join(cacheDir, upstreamSha)
}

/** Node the seat's `.nvmrc` pins; the gulp lanes compile with that engine. */
export function seatNodeVersion(nvmrcBody: string): string {
  const version = nvmrcBody.trim()
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new LaneError('ide/seat-node-invalid', `seat .nvmrc pins ${JSON.stringify(version)}`)
  return version
}

/**
 * The exact command plan the lane executes, in order, grounded in the pinned
 * tree's gulp targets (`vscode-reh-<platform>-min`, `vscode-web-min`).
 * @param seat - the content-addressed seat directory.
 * @param upstreamSha - the pinned microsoft/vscode commit.
 * @param platformKey - the gulp task platform suffix.
 * @param scriptsDir - locates the overlay within the plan.
 * @returns the plan lines, first token the command.
 */
export function lanePlan(seat: string, upstreamSha: string, platformKey: string, scriptsDir: string): string[] {
  return [
    `git init --quiet ${seat}`,
    `git -C ${seat} fetch --depth 1 https://github.com/microsoft/vscode.git ${upstreamSha}`,
    `git -C ${seat} checkout --detach ${upstreamSha}`,
    `git -C ${seat} apply ${join(scriptsDir, 'overlay', 'workbench.patch')}`,
    `npm --prefix ${seat} ci`,
    `npm --prefix ${seat} run gulp -- vscode-reh-${platformKey}-min`,
    `npm --prefix ${seat} run gulp -- vscode-web-min`,
  ]
}

/**
 * The artifact paths the pinned gulp tasks write: the REH package task drops
 * the server under `.build/vscode-reh-<platform>` and the web package task under
 * `.build/vscode-web`, per build/gulpfile.reh.ts and gulpfile.vscode.web.ts.
 * @param seat - the content-addressed seat directory.
 * @param platformKey - the gulp task platform suffix.
 * @returns the server entry and client directory paths.
 */
export function artifactPaths(seat: string, platformKey: string): { serverEntry: string; clientWorkbench: string } {
  return {
    serverEntry: join(seat, '.build', `vscode-reh-${platformKey}`, 'bin', 'server.js'),
    clientWorkbench: join(seat, '.build', 'vscode-web', 'workbench', 'index.html'),
  }
}

async function sha256OfFile(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

/**
 * Execute the lane over a live seat, recording the twin digests. The launch
 * seam stands in for execFileSync under tests; production passes nothing.
 * @param options - cache root, platform, host node, and seams.
 * @param dryRun - print the plan instead of executing.
 * @returns the plan lines.
 */
export async function runLane(options: LaneOptions, dryRun: boolean): Promise<string[]> {
  const manifestPath = options.manifestPath ?? join(options.scriptsDir, 'manifest.default.json')
  const row = JSON.parse(await readFile(manifestPath, 'utf8')) as ManifestRow
  const seat = seatPath(options.cacheDir, row.upstreamSha)
  const plan = lanePlan(seat, row.upstreamSha, options.platformKey, options.scriptsDir)
  if (dryRun) {
    for (const line of plan) console.log(`$ ${line}`)
    console.log('dry run complete')
    return plan
  }
  const launch = options.launch ?? ((command: string, args: string[]) => {
    execFileSync(command, args, { cwd: seat, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  })
  await mkdir(seat, { recursive: true })
  for (const line of plan) {
    const [command, ...args] = line.split(' ').filter(part => part.length > 0)
    if (command === 'git' || command === 'npm') launch(command, args)
  }
  const wanted = seatNodeVersion(await readFile(join(seat, '.nvmrc'), 'utf8'))
  if (wanted !== options.hostNode) {
    throw new LaneError('ide/seat-node-mismatch', `seat wants node ${wanted}, host has ${options.hostNode}; rerun with node ${wanted} on PATH`)
  }
  const artifacts = artifactPaths(seat, options.platformKey)
  row.twins[options.platformKey] = {
    serverSha256: await sha256OfFile(artifacts.serverEntry),
    clientSha256: await sha256OfFile(artifacts.clientWorkbench),
  }
  await writeFile(manifestPath, `${JSON.stringify(row, undefined, 2)}\n`)
  console.log(`twins recorded: ${options.platformKey}`)
  return plan
}

const fileBase = process.argv[1] !== undefined ? process.argv[1].split('/').at(-1) : undefined
const launchedAsScript = fileBase !== undefined && import.meta.url.endsWith(`/${fileBase}`)
if (launchedAsScript) {
  const platformKey = process.env.DSH_IDE_BUILD_PLATFORM ?? lanePlatformKey(process.platform, process.arch)
  const dryRun = process.argv.includes('--dry-run')
  if (platformKey.startsWith('win32') || platformKey.startsWith('alpine')) {
    console.error(new LaneError('ide/seat-platform-unsupported', `the lane builds linux-* and darwin-* seats; got ${platformKey}`).message)
    process.exit(1)
  }
  void runLane({
    cacheDir: process.env.DSH_IDE_CACHE_DIR ?? join(process.env.HOME ?? '/tmp', '.cache', 'dsh', 'ide'),
    scriptsDir: import.meta.dirname,
    hostNode: process.version.slice(1),
    platformKey,
  }, dryRun)
}
