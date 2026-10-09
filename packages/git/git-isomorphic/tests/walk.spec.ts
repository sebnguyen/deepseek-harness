/**
 * The host-disk walk closure executed directly: real repositories walk their
 * changed rows, unborn heads resolve null, absent and malformed roots refuse,
 * and a mid-walk fault crosses to the caller.
 */
import nodeFs from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import git from 'isomorphic-git'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { faultMessageOf, hostRepoAt, walkRepository } from '../src/walk.ts'

let root: string
let repo: string

const AUTHOR = { author: { name: 't', email: 't@t' } }

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-git-walk-'))
  repo = join(root, 'repo')
  await mkdir(repo, { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function init(): Promise<void> {
  await git.init({ fs: nodeFs, dir: repo })
}

/** Stage every top-level worktree file and commit it. */
async function commitAll(message: string): Promise<string> {
  for (const entry of await readdir(repo)) {
    if (entry !== '.git') await git.add({ fs: nodeFs, dir: repo, filepath: entry })
  }
  return await git.commit({ fs: nodeFs, dir: repo, message, ...AUTHOR })
}

it('probes the root\'s .git/HEAD file', async () => {
  await expect(hostRepoAt(repo)).resolves.toBe(false)
  await init()
  await expect(hostRepoAt(repo)).resolves.toBe(true)
  const odd = join(root, 'odd')
  await mkdir(join(odd, '.git/HEAD'), { recursive: true })
  await expect(hostRepoAt(odd)).resolves.toBe(false)
})

it('walks changed rows with the resolved head oid', async () => {
  await init()
  await writeFile(join(repo, 'same.txt'), 'same\n')
  await writeFile(join(repo, 'mod.txt'), 'one\n')
  const head = await commitAll('base')
  await writeFile(join(repo, 'mod.txt'), 'two\n')
  await writeFile(join(repo, 'stray.txt'), 'stray\n')
  const reply = await walkRepository(repo)
  expect(reply.kind).toBe('status')
  if (reply.kind !== 'status') return
  expect(reply.head).toBe(head)
  expect(reply.rows.map(row => row[0])).toEqual(['mod.txt', 'same.txt', 'stray.txt'])
})

it('an unborn repository walks every file under a null head', async () => {
  await init()
  await writeFile(join(repo, 'a.txt'), 'a\n')
  const reply = await walkRepository(repo)
  expect(reply).toMatchObject({ kind: 'status', head: null })
  if (reply.kind !== 'status') return
  expect(reply.rows.map(row => row[0])).toEqual(['a.txt'])
})

it('a root without a .git/HEAD file refuses', async () => {
  await expect(walkRepository(root)).resolves.toEqual({ kind: 'not-repository' })
})

it('fault messages keep Error text and stringify the rest', () => {
  expect(faultMessageOf(new Error('boom'))).toBe('boom')
  expect(faultMessageOf('plain')).toBe('plain')
})

it('a reference fault that is not absence crosses to the caller', async () => {
  await mkdir(join(repo, '.git'), { recursive: true })
  // HEAD expands onto itself: an InternalError, not absence.
  await writeFile(join(repo, '.git/HEAD'), 'ref: HEAD\n')
  await expect(walkRepository(repo)).rejects.toMatchObject({ name: 'InternalError' })
})

it('a fault no classification absorbs crosses to the caller', async () => {
  await init()
  await writeFile(join(repo, 'a.txt'), 'a\n')
  await git.add({ fs: nodeFs, dir: repo, filepath: 'a.txt' })
  // The HEAD reference resolves, but the index no longer parses:
  // an InternalError no NotFound classification swallows.
  await writeFile(join(repo, '.git/index'), 'not an index at all\n')
  await expect(walkRepository(repo)).rejects.toMatchObject({ name: 'InternalError' })
})

it('an emptied object store folds into the not-repository refusal', async () => {
  await init()
  await writeFile(join(repo, 'a.txt'), 'a\n')
  await commitAll('base')
  await rm(join(repo, '.git/objects'), { recursive: true, force: true })
  await mkdir(join(repo, '.git/objects'), { recursive: true })
  await expect(walkRepository(repo)).resolves.toEqual({ kind: 'not-repository' })
})
