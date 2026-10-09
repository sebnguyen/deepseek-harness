/**
 * The plugin registers the isomorphic provider under the configured id
 * and the default cap; a second context without configuration still
 * auto-selects it as the single usable provider.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { apply, inject, name } from '../src/index.ts'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-iso-git-plugin-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

it('exposes its identity and injection list', () => {
  expect(name).toBe('git-isomorphic')
  expect(inject).toEqual(['git', 'fs'])
})

it('registers the provider and serves a clean repository through the seam', async () => {
  const repo = join(root, 'repo')
  await mkdir(repo, { recursive: true })
  const nodeFs = await import('node:fs')
  const isogit = (await import('isomorphic-git')).default
  await isogit.init({ fs: nodeFs.default, dir: repo })
  await writeFile(join(repo, 'a.txt'), 'a\n')
  await isogit.add({ fs: nodeFs.default, dir: repo, filepath: 'a.txt' })
  await isogit.commit({ fs: nodeFs.default, dir: repo, message: 'base', author: { name: 't', email: 't@t' } })
  const ctx = new Context()
  const fsFiber = await ctx.plugin(LocalFileSystem, { cwd: repo })
  const { GitRuntime } = await import('@deepseek-ai/dsh-git')
  const git = new GitRuntime(ctx)
  const fiber = await ctx.plugin({ inject: ['git', 'fs'], apply }, { id: 'custom' } as never)
  // The configured-less selection now finds exactly this provider.
  const status = await git.status({ workspaceRoot: repo })
  expect(status.entries).toEqual([])
  expect(status.head).not.toBeNull()
  await fiber.dispose()
  await fsFiber.dispose()
})

it('a non-repository workspace refuses through the seam', async () => {
  const ctx = new Context()
  const fsFiber = await ctx.plugin(LocalFileSystem, { cwd: root })
  const { GitRuntime } = await import('@deepseek-ai/dsh-git')
  const git = new GitRuntime(ctx)
  const fiber = await ctx.plugin({ inject: ['git', 'fs'], apply }, {})
  await expect(git.status({ workspaceRoot: root })).rejects.toMatchObject({ code: 'GIT_NOT_REPOSITORY' })
  await fiber.dispose()
  await fsFiber.dispose()
})
