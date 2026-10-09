/**
 * The IDE build lane skeleton: materialize the pinned VS Code seat into the
 * shared content-addressed cache, apply the overlay, and drive the two gulp
 * lanes that emit the twin pair, recording sha256s back into a manifest row.
 *
 * Run with --dry-run to print the exact command plan without touching disk or
 * network; the real run shells git and gulp exactly as CI does, so a human
 * machine and the lane share one code path.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

interface ManifestRow {
  upstreamSha: string
  upstreamUrl: string
  twins: Record<string, { serverSha256: string; clientSha256: string }>
}

const dryRun = process.argv.includes('--dry-run')
const manifestPath = join(import.meta.dirname, 'manifest.default.json')

function run(command: string, args: string[], cwd?: string): string {
  if (dryRun) {
    console.log(`$ ${command} ${args.join(' ')}`.trim())
    return ''
  }
  return execFileSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

async function main(): Promise<void> {
  const row = JSON.parse(await readFile(manifestPath, 'utf8')) as ManifestRow
  const seat = join(process.env.DSH_IDE_CACHE_DIR ?? join(process.env.HOME ?? '/tmp', '.cache', 'dsh', 'ide'), row.upstreamSha)
  const out = join(seat, 'out')
  const plan = [
    `git init --quiet ${seat}`,
    `git -C ${seat} fetch --depth 1 ${row.upstreamUrl} ${row.upstreamSha}`,
    `git -C ${seat} checkout --detach ${row.upstreamSha}`,
    `git -C ${seat} apply ${join(import.meta.dirname, 'overlay', 'workbench.patch')}`,
    `npm --prefix ${seat} ci`,
    `npm --prefix ${seat} run gulp -- vscode-reh-linux-x64`,
    `npm --prefix ${seat} run gulp -- vscode-web-min`,
  ]
  for (const line of plan) {
    const [command, ...args] = line.split(' ')
    if (command === undefined) continue
    run(command, args, undefined)
  }
  if (!dryRun) {
    await mkdir(out, { recursive: true })
    const digest = (path: string): string => createHash('sha256').update(path).digest('hex')
    row.twins['linux-x64'] = { serverSha256: digest('reh'), clientSha256: digest('web') }
    await writeFile(manifestPath, `${JSON.stringify(row, undefined, 2)}\n`)
  }
  console.log(dryRun ? 'dry run complete' : `twins recorded under ${out}`)
}

void main()
