/**
 * Twin dist discovery: the single machine-wide cache pipeline, the launcher
 * sentinel, and the config-beats-discovery rule — pinned against throwaway
 * layouts so the real machine's staging never leaks into the assertions.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { climbToRepoRoot, findTwinDist, resolveTwinDist, twinCacheDist, twinDistCandidates } from '../src/twin-dist.ts'

/** Lay out one absolute candidate slot with (or without) the twin launcher. */
async function stageAbs(path: string, armed: boolean): Promise<string> {
  await mkdir(join(path, 'bin'), { recursive: true })
  if (armed) await writeFile(join(path, 'bin', 'code-server-oss'), '#!stub\n')
  return path
}

const mounted: string[] = []

/** Harness home each case inherited, for restore during teardown. */
let prevDshHome: string | undefined

/**
 * One throwaway repo root per case: a `repo` child of a fresh base, so stray
 * repo-relative slots land inside the same base and teardown sweeps both —
 * cases cannot see each other's staging. DSH_HOME is rebound to an empty
 * child of the same base, so the machine's real harness-home cache never
 * leaks into the assertions.
 */
async function fakeRepo(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), 'ide-twin-dist-'))
  mounted.push(base)
  const root = join(base, 'repo')
  await mkdir(root, { recursive: true })
  prevDshHome = process.env.DSH_HOME
  process.env.DSH_HOME = join(base, 'dsh-home')
  return root
}

afterEach(async () => {
  if (prevDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = prevDshHome
  await Promise.all(mounted.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('twinDistCandidates', () => {
  it('resolves exactly the machine-wide cache slot, whatever the repo root', async () => {
    const root = await fakeRepo()
    expect(twinDistCandidates(root)).toEqual([twinCacheDist()])
    expect(twinDistCandidates()).toEqual([twinCacheDist()])
    expect(twinCacheDist()).toBe(join(process.env.DSH_HOME!, 'cache', 'vscode-twin', 'dist'))
  })
})

describe('findTwinDist', () => {
  it('answers null when the cache slot was not staged', async () => {
    expect(findTwinDist(await fakeRepo())).toBeNull()
  })

  it('finds the harness-home source-build cache slot', async () => {
    const root = await fakeRepo()
    const slot = await stageAbs(twinCacheDist(), true)
    expect(findTwinDist(root)).toBe(slot)
  })

  it('rejects a cache slot that lacks the twin launcher', async () => {
    const root = await fakeRepo()
    await stageAbs(twinCacheDist(), false)
    expect(findTwinDist(root)).toBeNull()
  })

  it('ignores repo-relative slots — they never shadow or reappear beside the checkout', async () => {
    const root = await fakeRepo()
    const slot = await stageAbs(twinCacheDist(), true)
    await stageAbs(join(root, '..', 'vscode-reh-web-placeholder'), true)
    await stageAbs(join(root, '..', '.vscode-twin', 'dist'), true)
    await stageAbs(join(root, '.vscode-twin', 'dist'), true)
    expect(findTwinDist(root)).toBe(slot)
  })
})

describe('climbToRepoRoot', () => {
  it('stops at the workspace marker from the built-package depth (lib/types)', async () => {
    const root = await fakeRepo()
    await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages: []\n')
    const deep = join(root, 'packages', 'api', 'ide', 'lib', 'types')
    await mkdir(deep, { recursive: true })
    expect(climbToRepoRoot(deep)).toBe(root)
  })

  it('stops at the workspace marker from the checked-out depth (src)', async () => {
    const root = await fakeRepo()
    await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages: []\n')
    const deep = join(root, 'packages', 'api', 'ide', 'src')
    await mkdir(deep, { recursive: true })
    expect(climbToRepoRoot(deep)).toBe(root)
  })

  it('falls back to the four-climb when no workspace marker exists above', async () => {
    const root = await fakeRepo()
    const deep = join(root, 'packages', 'api', 'ide', 'lib')
    await mkdir(deep, { recursive: true })
    // Without a marker anywhere, the fallback climbs exactly four levels:
    // the package's built face dir to the checkout root.
    expect(climbToRepoRoot(deep)).toBe(root)
  })
})

describe('resolveTwinDist', () => {
  it('never overrides an explicitly configured dist', async () => {
    const root = await fakeRepo()
    expect(resolveTwinDist('/pinned/twin', root)).toBe('/pinned/twin')
  })

  it('discovers the cache when the config is empty, and disables when it is unstaged', async () => {
    const root = await fakeRepo()
    expect(resolveTwinDist('', root)).toBe('')
    const slot = await stageAbs(twinCacheDist(), true)
    expect(resolveTwinDist('', root)).toBe(slot)
  })
})
