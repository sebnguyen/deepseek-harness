/**
 * The isomorphic provider over a real repository in a temp directory:
 * matrix rows become the five-state vocabulary, unborn HEAD resolves null,
 * non-repositories refuse, caps refuse, and one file's two sides come back
 * text-or-null.
 */
import nodeFs from 'node:fs'
import { mkdtemp, mkdir, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import git from 'isomorphic-git'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { IsomorphicGitProvider } from '../src/provider.ts'

let root: string
let repo: string
let ctx: Context
let fiber: Awaited<ReturnType<Context['plugin']>> | undefined

const AUTHOR = { author: { name: 't', email: 't@t' } }

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-iso-git-'))
  repo = join(root, 'repo')
  await mkdir(repo, { recursive: true })
  ctx = new Context()
  fiber = undefined
})

/** Mount the local backend AFTER the repository exists, so its stats see it. */
async function mountLocal(): Promise<void> {
  fiber = await ctx.plugin(LocalFileSystem, { cwd: repo })
}

afterEach(async () => {
  await fiber?.dispose()
  await rm(root, { recursive: true, force: true })
})

async function init(): Promise<void> {
  await git.init({ fs: nodeFs, dir: repo })
}

/** Stage every top-level worktree file; `listFiles` is empty before the first commit. */
async function commitAll(message: string): Promise<string> {
  for (const entry of await readdir(repo)) {
    if (entry !== '.git') await git.add({ fs: nodeFs, dir: repo, filepath: entry })
  }
  return await git.commit({ fs: nodeFs, dir: repo, message, ...AUTHOR })
}

it('statuses map onto the vocabulary in matrix order', async () => {
  await init()
  await writeFile(join(repo, 'same.txt'), 'same\n')
  await writeFile(join(repo, 'mod.txt'), 'one\n')
  await writeFile(join(repo, 'del.txt'), 'bye\n')
  await writeFile(join(repo, 'staged.txt'), 's\n')
  await commitAll('base')
  // modified: content moved; deleted: gone from the worktree; untracked:
  // never added; added: staged after the base; same stays out.
  await writeFile(join(repo, 'mod.txt'), 'two\n')
  await rm(join(repo, 'del.txt'))
  await writeFile(join(repo, 'stray.txt'), 'stray\n')
  await writeFile(join(repo, 'staged.txt'), 's2\n')
  await git.add({ fs: nodeFs, dir: repo, filepath: 'staged.txt' })
  await mountLocal()
  const provider = new IsomorphicGitProvider(ctx, 'iso', 1024 * 1024)
  const status = await provider.status({ workspaceRoot: repo })
  expect(status.head).not.toBeNull()
  const byPath = Object.fromEntries(status.entries.map(entry => [entry.path, entry.status]))
  expect(byPath).toMatchObject({
    'del.txt': 'deleted',
    'mod.txt': 'modified',
    'staged.txt': 'modified',
    'stray.txt': 'untracked',
  })
  expect(byPath['same.txt']).toBeUndefined()
  // Staging a brand-new file reports added on the next walk.
  await writeFile(join(repo, 'brand.txt'), 'b\n')
  await git.add({ fs: nodeFs, dir: repo, filepath: 'brand.txt' })
  const second = await provider.status({ workspaceRoot: repo })
  const added = Object.fromEntries(second.entries.map(entry => [entry.path, entry.status]))
  expect(added['brand.txt']).toBe('added')
})

it('a file removed from the index but alive in the worktree reads as other', async () => {
  await init()
  await writeFile(join(repo, 'kept.txt'), 'keep\n')
  await commitAll('base')
  // Staging a deletion while the worktree keeps the file yields a row no
  // named state owns: head present, workdir present, stage absent.
  await git.remove({ fs: nodeFs, dir: repo, filepath: 'kept.txt' })
  await writeFile(join(repo, 'kept.txt'), 'keep\n')
  await mountLocal()
  const provider = new IsomorphicGitProvider(ctx, 'iso', 1024 * 1024)
  const status = await provider.status({ workspaceRoot: repo })
  const byPath = Object.fromEntries(status.entries.map(entry => [entry.path, entry.status]))
  expect(byPath['kept.txt']).toBe('other')
})

it('an unknown resolve code folds into GIT_NOT_REPOSITORY from both reads', async () => {
  await init()
  await commitAll('base')
  // A refusal the translator does not recognize still dies inside
  // isomorphic-git's swallowing reads, so both consumers see the fold.
  const denied = scriptFs({ resolve: async (): Promise<never> => { throw Object.assign(new Error('denied'), { code: 'FS_DENIED' }) } })
  await expect(denied.status({ workspaceRoot: repo })).rejects.toMatchObject({ code: 'GIT_NOT_REPOSITORY' })
  await expect(denied.diff({ workspaceRoot: repo, path: 'a.txt' })).rejects.toMatchObject({ code: 'GIT_NOT_REPOSITORY' })
})

it('a corrupt object crosses the walk refusal untouched', async () => {
  await init()
  await writeFile(join(repo, 'a.txt'), 'one\n')
  const headOid = await commitAll('base')
  // Not absent, but unparseable: the walk's non-absent arm rethrows it.
  await writeFile(join(repo, '.git', 'objects', headOid.slice(0, 2), headOid.slice(2)), 'garbage\n')
  await mountLocal()
  const corrupt = new IsomorphicGitProvider(ctx, 'iso', 1024 * 1024)
  await expect(corrupt.status({ workspaceRoot: repo })).rejects.toSatisfy((error: unknown) => {
    return (error as { code?: string }).code !== 'GIT_NOT_REPOSITORY'
  })
})

it('an object store emptied after the walk starts folds into GIT_NOT_REPOSITORY', async () => {
  await init()
  await writeFile(join(repo, 'a.txt'), 'one\n')
  await commitAll('base')
  // Refs survive but every loose object vanishes: resolveRef still
  // resolves, the walk's TREE side fails NotFound, and the provider folds.
  await rm(join(repo, '.git', 'objects'), { recursive: true, force: true })
  await mkdir(join(repo, '.git', 'objects'), { recursive: true })
  await mountLocal()
  const storeless = new IsomorphicGitProvider(ctx, 'iso', 1024 * 1024)
  await expect(storeless.status({ workspaceRoot: repo })).rejects.toMatchObject({ code: 'GIT_NOT_REPOSITORY' })
})

it('a non-absent head refusal crosses untouched and a broken object store reads one-sided', async () => {
  await init()
  await writeFile(join(repo, 'a.txt'), 'one\n')
  await commitAll('base')
  // Malformed HEAD bytes: the ref parse folds the refusal into an internal
  // error that neither read swallows further, so the provider passes it
  // through both arms untouched.
  const malformed = scriptFs({})
  await expect(malformed.status({ workspaceRoot: repo })).rejects.toThrow('Circular reference')
  await expect(malformed.diff({ workspaceRoot: repo, path: 'a.txt' })).rejects.toThrow('Circular reference')
  // An object-store fault under the HEAD side is swallowed by
  // isomorphic-git's blob read, so the file reads as one-sided.
  const brokenStore = scriptFs({
    readBytes: async (target: { path: string }) => {
      if (target.path.endsWith('/HEAD')) return new Uint8Array(Buffer.from('ref: refs/heads/master\n'))
      if (target.path.includes('refs/')) return new Uint8Array(Buffer.from('a'.repeat(40)))
      if (target.path.includes('objects/')) throw Object.assign(new Error('oldboom'), { code: 'FS_NOT_FOUND' })
      return new Uint8Array(Buffer.from('work\n'))
    },
  })
  const oneSided = await brokenStore.diff({ workspaceRoot: repo, path: 'a.txt' })
  expect(oneSided).toEqual({ path: 'a.txt', oldText: null, newText: 'work\n' })
})

/** A scripted fs over the real repo layout: reads pass, the named member fails. */
function scriptFs(overrides: Partial<{
  resolve: (path: string) => Promise<unknown>
  stat: (target: { path: string }) => Promise<unknown>
  readBytes: (target: { path: string }) => Promise<Uint8Array>
  listDir: (target: { path: string }) => Promise<{ name: string }[]>
}>): IsomorphicGitProvider {
  const ctx2 = new Context()
  ctx2.provide('fs', {
    resolve: overrides.resolve ?? (async (path: string) => ({ path })),
    stat: overrides.stat ?? (async () => ({ type: 'file', size: 23 })),
    lstat: async () => ({ type: 'file', size: 23 }),
    readBytes: overrides.readBytes ?? (async () => new Uint8Array([1])),
    listDir: overrides.listDir ?? (async () => [{ name: 'a' }]),
    processPathFromHostPath: () => undefined,
  } as never)
  return new IsomorphicGitProvider(ctx2, 'iso', 1024 * 1024)
}


// A composed filesystem that reads the real disk but reports no host
// mirror, like a remote backend: every read crosses the adapter.
function composedCtx(): Context {
  const remote = new Context()
  remote.provide('fs', {
    resolve: async (path: string) => ({ path }),
    processPath: (target: { path: string }) => target.path,
    processPathFromHostPath: () => undefined,
    stat: async (target: { path: string }) => {
      const info = await stat(target.path).catch(() => undefined)
      return info === undefined ? undefined : { type: info.isFile() ? 'file' : 'directory', size: info.size }
    },
    lstat: async (path: string) => {
      const info = await stat(path).catch(() => undefined)
      return info === undefined ? undefined : { type: info.isFile() ? 'file' : 'directory', size: info.size }
    },
    readBytes: async (target: { path: string }) => new Uint8Array(await readFile(target.path)),
    listDir: async (target: { path: string }) =>
      (await readdir(target.path, { withFileTypes: true })).map(dirent => ({ name: dirent.name })),
  } as never)
  return remote
}

it('the composed walk serves a clean repository without a host mirror', async () => {
  await init()
  await writeFile(join(repo, 'c.txt'), 'c\n')
  await commitAll('base')
  const provider = new IsomorphicGitProvider(composedCtx(), 'iso', 1024 * 1024)
  const status = await provider.status({ workspaceRoot: repo })
  expect(status.head).not.toBeNull()
  expect(status.entries).toEqual([])
})

it('an emptied object store under the composed walk refuses GIT_NOT_REPOSITORY', async () => {
  await init()
  await writeFile(join(repo, 'c.txt'), 'c\n')
  await commitAll('base')
  await rm(join(repo, '.git/objects'), { recursive: true, force: true })
  await mkdir(join(repo, '.git/objects'), { recursive: true })
  const provider = new IsomorphicGitProvider(composedCtx(), 'iso', 1024 * 1024)
  await expect(provider.status({ workspaceRoot: repo })).rejects.toMatchObject({ code: 'GIT_NOT_REPOSITORY' })
})

it('a composed statusMatrix fault that is not absence crosses untouched', async () => {
  const boom = scriptFs({
    readBytes: async (target: { path: string }) => {
      if (target.path.endsWith('/HEAD')) return new Uint8Array(Buffer.from('ref: refs/heads/master\n'))
      if (target.path.includes('refs/')) return new Uint8Array(Buffer.from('a'.repeat(40)))
      if (target.path.includes('index')) throw new Error('index boom')
      return new Uint8Array([1])
    },
  })
  await expect(boom.status({ workspaceRoot: repo })).rejects.toThrow(/SHA check failed/)
})

it('an unborn HEAD resolves null and every file reads as added or untracked', async () => {
  await init()
  await writeFile(join(repo, 'first.txt'), 'one\n')
  await git.add({ fs: nodeFs, dir: repo, filepath: 'first.txt' })
  await mountLocal()
  const provider = new IsomorphicGitProvider(ctx, 'iso', 1024 * 1024)
  const status = await provider.status({ workspaceRoot: repo })
  expect(status.head).toBeNull()
  expect(status.entries).toEqual([{ path: 'first.txt', status: 'added' }])
  // Diff treats the unborn repository as having no HEAD side.
  const diff = await provider.diff({ workspaceRoot: repo, path: 'first.txt' })
  expect(diff).toEqual({ path: 'first.txt', oldText: null, newText: 'one\n' })
})

it('a non-repository root refuses GIT_NOT_REPOSITORY from both reads', async () => {
  await mountLocal()
  const provider = new IsomorphicGitProvider(ctx, 'iso', 1024 * 1024)
  await expect(provider.status({ workspaceRoot: root })).rejects.toMatchObject({ code: 'GIT_NOT_REPOSITORY' })
  await expect(provider.diff({ workspaceRoot: root, path: 'a.txt' })).rejects.toMatchObject({ code: 'GIT_NOT_REPOSITORY' })
})

it('the provider cap binds diff alone; a fat worktree file walks unbounded', async () => {
  await init()
  await writeFile(join(repo, 'small.txt'), 'one\n')
  await writeFile(join(repo, 'fat.txt'), 'x'.repeat(64))
  await commitAll('base')
  await writeFile(join(repo, 'fat.txt'), 'y'.repeat(64))
  await writeFile(join(repo, 'stray-fat.bin'), 'z'.repeat(64))
  await mountLocal()
  const provider = new IsomorphicGitProvider(ctx, 'iso', 8)
  const status = await provider.status({ workspaceRoot: repo })
  const byPath = Object.fromEntries(status.entries.map(entry => [entry.path, entry.status]))
  expect(byPath['fat.txt']).toBe('modified')
  expect(byPath['stray-fat.bin']).toBe('untracked')
  // The same provider still enforces its cap on diff sides.
  await expect(provider.diff({ workspaceRoot: repo, path: 'fat.txt' })).rejects.toMatchObject({ code: 'GIT_TOO_LARGE' })
})

it('diff returns both sides, one side, and refuses an absent pair', async () => {
  await init()
  await writeFile(join(repo, 'moved.txt'), 'head\n')
  await writeFile(join(repo, 'gone.txt'), 'head\n')
  await writeFile(join(repo, 'binary.txt'), 'head\n')
  await commitAll('base')
  await writeFile(join(repo, 'moved.txt'), 'work\n')
  await rm(join(repo, 'gone.txt'))
  await writeFile(join(repo, 'binary.txt'), 'head\u0000\n')
  await mountLocal()
  const provider = new IsomorphicGitProvider(ctx, 'iso', 1024 * 1024)
  const moved = await provider.diff({ workspaceRoot: repo, path: 'moved.txt' })
  expect(moved).toEqual({ path: 'moved.txt', oldText: 'head\n', newText: 'work\n' })
  const gone = await provider.diff({ workspaceRoot: repo, path: 'gone.txt' })
  expect(gone.newText).toBeNull()
  expect(gone.oldText).toBe('head\n')
  await expect(provider.diff({ workspaceRoot: repo, path: 'nowhere.txt' })).rejects.toMatchObject({ code: 'GIT_NOT_FOUND' })
  // A worktree-side binary file refuses on the new side.
  await writeFile(join(repo, 'binwork.txt'), 'w\u0000\n')
  await expect(provider.diff({ workspaceRoot: repo, path: 'binwork.txt' })).rejects.toMatchObject({ code: 'GIT_NOT_TEXT' })
  // A trailing slash on the repository root joins paths unchanged.
  await expect(provider.diff({ workspaceRoot: `${repo}/`, path: 'moved.txt' })).resolves.toMatchObject({ newText: 'work\n' })
  await expect(provider.diff({ workspaceRoot: repo, path: 'binary.txt' })).rejects.toMatchObject({ code: 'GIT_NOT_TEXT' })
})

it('diff caps each side and reports one-sided absence', async () => {
  await init()
  await writeFile(join(repo, 'big.txt'), 'y'.repeat(64))
  await commitAll('base')
  await mountLocal()
  const provider = new IsomorphicGitProvider(ctx, 'iso', 8)
  await expect(provider.diff({ workspaceRoot: repo, path: 'big.txt' })).rejects.toMatchObject({ code: 'GIT_TOO_LARGE' })
  // Narrowing from the request beats the provider default.
  const wide = new IsomorphicGitProvider(ctx, 'iso', 8)
  const text = await wide.diff({ workspaceRoot: repo, path: 'big.txt', maxFileBytes: 1024 })
  expect(text.newText).toBe('y'.repeat(64))
  // The inverse: HEAD small, worktree large trips the new-side cap.
  await writeFile(join(repo, 'big.txt'), 'z\n')
  await commitAll('small')
  await writeFile(join(repo, 'big.txt'), 'w'.repeat(64))
  await expect(provider.diff({ workspaceRoot: repo, path: 'big.txt' })).rejects.toMatchObject({ code: 'GIT_TOO_LARGE' })
  // A refusal on the new side that is neither absence nor cap crosses.
  const rareCtx = new Context()
  rareCtx.provide('fs', {
    resolve: async (path: string) => ({ path }),
    stat: async (target: { path: string }) => ({ type: target.path.endsWith('.git') ? 'directory' : 'file', size: 4 }),
    lstat: async (target: { path: string }) => ({ type: target.path.endsWith('.git') ? 'directory' : 'file', size: 4 }),
    readBytes: async (target: { path: string }) => {
      if (target.path.endsWith('.git/HEAD')) return new Uint8Array(Buffer.from('ref: refs/heads/master\n'))
      if (target.path.includes('.git/refs/')) return new Uint8Array(Buffer.from('a'.repeat(40)))
      if (target.path.includes('.git/objects/')) throw Object.assign(new Error('no object'), { code: 'NotFoundError' })
      throw new Error('rareside')
    },
    listDir: async () => [],
    processPathFromHostPath: () => undefined,
  } as never)
  const rare = new IsomorphicGitProvider(rareCtx, 'iso', 1024 * 1024)
  await expect(rare.diff({ workspaceRoot: repo, path: 'big.txt' })).rejects.toMatchObject({ message: 'rareside' })
})

it('a symlinked path is skipped as a non-regular read and the adapter mutations refuse EROFS', async () => {
  await init()
  await writeFile(join(repo, 'target.txt'), 't\n')
  await commitAll('base')
  await symlink(join(repo, 'target.txt'), join(repo, 'link.txt'))
  await mountLocal()
  const provider = new IsomorphicGitProvider(ctx, 'iso', 1024 * 1024)
  // The link never enters the status vocabulary as a tracked change.
  const status = await provider.status({ workspaceRoot: repo })
  const paths = status.entries.map(entry => entry.path)
  expect(paths).toContain('link.txt')
})

it('available follows the composed filesystem mount', async () => {
  await mountLocal()
  const provider = new IsomorphicGitProvider(ctx, 'iso', 1024 * 1024)
  expect(provider.available()).toBe(true)
  const bare = new Context()
  const unmounted = new IsomorphicGitProvider(bare, 'iso', 1024 * 1024)
  expect(unmounted.available()).toBe(false)
})
