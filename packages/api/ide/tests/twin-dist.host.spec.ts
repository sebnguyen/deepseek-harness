/**
 * Twin dist discovery: candidate order, the launcher sentinel, and the
 * config-beats-discovery rule — pinned against throwaway layouts so the
 * real machine's staging never leaks into the assertions.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findTwinDist, resolveTwinDist, twinDistCandidates } from '../src/twin-dist.ts'

/** Lay out one candidate slot with (or without) the twin launcher. */
async function stage(root: string, relative: string, armed: boolean): Promise<string> {
  const candidate = join(root, relative)
  await mkdir(join(candidate, 'bin'), { recursive: true })
  if (armed) await writeFile(join(candidate, 'bin', 'code-server-oss'), '#!stub\n')
  return candidate
}

const mounted: string[] = []

/**
 * One throwaway repo root per case: a `repo` child of a fresh base, so a
 * sibling `.vscode-twin` slot lands inside the same base and teardown
 * sweeps both — cases cannot see each other's staging.
 */
async function fakeRepo(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), 'ide-twin-dist-'))
  mounted.push(base)
  const root = join(base, 'repo')
  await mkdir(root, { recursive: true })
  return root
}

afterEach(async () => {
  await Promise.all(mounted.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('twinDistCandidates', () => {
  it('orders the shared sibling slot before the in-repo slot', async () => {
    const root = await fakeRepo()
    expect(twinDistCandidates(root)).toEqual([
      join(root, '..', '.vscode-twin', 'dist'),
      join(root, '.vscode-twin', 'dist'),
    ])
  })
})

describe('findTwinDist', () => {
  it('answers null when no candidate was staged', async () => {
    expect(findTwinDist(await fakeRepo())).toBeNull()
  })

  it('finds the sibling dist shared by every worktree of the clone', async () => {
    const root = await fakeRepo()
    const candidate = await stage(root, join('..', '.vscode-twin', 'dist'), true)
    expect(findTwinDist(root)).toBe(candidate)
  })

  it('finds the in-repo dist when only that slot was staged', async () => {
    const root = await fakeRepo()
    const candidate = await stage(root, join('.vscode-twin', 'dist'), true)
    expect(findTwinDist(root)).toBe(candidate)
  })

  it('prefers the sibling slot when both exist', async () => {
    const root = await fakeRepo()
    const sibling = await stage(root, join('..', '.vscode-twin', 'dist'), true)
    await stage(root, join('.vscode-twin', 'dist'), true)
    expect(findTwinDist(root)).toBe(sibling)
  })

  it('rejects a slot that lacks the twin launcher', async () => {
    const root = await fakeRepo()
    await stage(root, join('..', '.vscode-twin', 'dist'), false)
    expect(findTwinDist(root)).toBeNull()
  })
})

describe('resolveTwinDist', () => {
  it('never overrides an explicitly configured dist', async () => {
    const root = await fakeRepo()
    await stage(root, join('..', '.vscode-twin', 'dist'), true)
    expect(resolveTwinDist('/pinned/twin', root)).toBe('/pinned/twin')
  })

  it('discovers when the config is empty, and disables when nothing is staged', async () => {
    const root = await fakeRepo()
    expect(resolveTwinDist('', root)).toBe('')
    const candidate = await stage(root, join('..', '.vscode-twin', 'dist'), true)
    expect(resolveTwinDist('', root)).toBe(candidate)
  })
})
