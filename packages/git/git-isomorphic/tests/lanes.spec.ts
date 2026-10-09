/**
 * The provider's walk-lane selection: a backend that mirrors the session root
 * onto a host path gets the off-loop walk; one that reports no mirror keeps
 * the composed-filesystem walk.
 */
import nodeFs from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import git from 'isomorphic-git'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { IsomorphicGitProvider } from '../src/provider.ts'
import { GitWalkRunner } from '../src/runner.ts'

let root: string
let repo: string
let runner: GitWalkRunner

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-git-lanes-'))
  repo = join(root, 'repo')
  await mkdir(repo, { recursive: true })
  await git.init({ fs: nodeFs, dir: repo })
  await writeFile(join(repo, 'a.txt'), 'one\n')
  runner = new GitWalkRunner()
})

afterEach(async () => {
  runner.dispose()
  await rm(root, { recursive: true, force: true })
})

/** One context whose `fs` mirrors the host disk, like a local backend. */
function hostMirroringCtx(): Context {
  const ctx = new Context()
  ctx.provide('fs', {
    resolve: async (path: string) => ({ path }),
    processPath: (target: { path: string }) => target.path,
    processPathFromHostPath: (hostPath: string) => hostPath,
  } as never)
  return ctx
}

/** One context whose `fs` reports no host mirror; reads still hit the host disk. */
function remoteCtx(): Context {
  const ctx = new Context()
  const onDisk = (target: { path: string }) => target.path
  ctx.provide('fs', {
    resolve: async (path: string) => ({ path }),
    processPath: onDisk,
    processPathFromHostPath: () => undefined,
    stat: async (target: { path: string }) => {
      const info = await stat(onDisk(target)).catch(() => undefined)
      return info === undefined ? undefined : { type: info.isFile() ? 'file' : 'directory', size: info.size }
    },
    lstat: async (value: string | { path: string }) => {
      const raw = typeof value === 'string' ? value : onDisk(value)
      const info = await stat(isAbsolute(raw) ? raw : join(repo, raw)).catch(() => undefined)
      return info === undefined ? undefined : { type: info.isFile() ? 'file' : 'directory', size: info.size }
    },
    readBytes: async (target: { path: string }) => new Uint8Array(await readFile(onDisk(target))),
    listDir: async (target: { path: string }) => (await readdir(onDisk(target), { withFileTypes: true }))
      .map(entry => ({ name: entry.name })),
  } as never)
  return ctx
}

it('host-pathed roots walk off the loop', async () => {
  await writeFile(join(repo, 'b.txt'), 'stray\n')
  const provider = new IsomorphicGitProvider(hostMirroringCtx(), 'id', 1024 * 1024, runner)
  const result = await provider.status({ workspaceRoot: repo })
  expect(result.head).toBeNull()
  expect(result.entries.map(entry => entry.path)).toEqual(['a.txt', 'b.txt'])
})

it('host-pathed roots without a repository refuse through the seam code', async () => {
  const provider = new IsomorphicGitProvider(hostMirroringCtx(), 'id', 1024 * 1024, runner)
  await expect(provider.status({ workspaceRoot: root })).rejects.toMatchObject({ code: 'GIT_NOT_REPOSITORY' })
})

it('mirror-less backends keep the composed walk', async () => {
  const provider = new IsomorphicGitProvider(remoteCtx(), 'id', 1024 * 1024, runner)
  const result = await provider.status({ workspaceRoot: repo })
  expect(result.head).toBeNull()
  expect(result.entries.map(entry => entry.path)).toEqual(['a.txt'])
})

it('mirror-less roots without a repository refuse through the seam code', async () => {
  const provider = new IsomorphicGitProvider(remoteCtx(), 'id', 1024 * 1024, runner)
  await expect(provider.status({ workspaceRoot: root })).rejects.toMatchObject({ code: 'GIT_NOT_REPOSITORY' })
})
