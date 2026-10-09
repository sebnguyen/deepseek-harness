/**
 * The off-loop walk runner against a real worker thread: one worker serves the
 * request queue, same-root walks share one round trip, refusals and worker
 * faults reject their caller, and the disposer fails what is queued.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import git from 'isomorphic-git'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { GitWalkRunner, workerExecArgv } from '../src/runner.ts'
import nodeFs from 'node:fs'

let root: string
let repo: string
let runner: GitWalkRunner

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-git-runner-'))
  repo = join(root, 'repo')
  await mkdir(repo, { recursive: true })
  runner = new GitWalkRunner()
})

afterEach(async () => {
  runner.dispose()
  await rm(root, { recursive: true, force: true })
})

it('launch flags follow the worker source and the engine', () => {
  expect(workerExecArgv('/x/worker.cjs', 'v24.14.1')).toEqual([])
  expect(workerExecArgv('/x/worker.ts', 'v24.14.1')).toEqual([])
  expect(workerExecArgv('/x/worker.ts', 'v22.19.0')).toEqual(['--experimental-strip-types'])
})

it('walks a repository through the worker and shares one round trip per root', async () => {
  await git.init({ fs: nodeFs, dir: repo })
  await writeFile(join(repo, 'a.txt'), 'a\n')
  const first = runner.walk(repo)
  const twin = runner.walk(repo)
  expect(twin).toBe(first)
  const [reply] = await Promise.all([first, twin])
  expect(reply).toMatchObject({ kind: 'status', head: null })
  if (reply.kind !== 'status') return
  expect(reply.rows.map(row => row[0])).toEqual(['a.txt'])
})

it('refusals cross like replies', async () => {
  await expect(runner.walk(root)).resolves.toEqual({ kind: 'not-repository' })
})

it('a fault no classification absorbs rejects the caller', async () => {
  await git.init({ fs: nodeFs, dir: repo })
  await writeFile(join(repo, 'a.txt'), 'a\n')
  await git.add({ fs: nodeFs, dir: repo, filepath: 'a.txt' })
  await writeFile(join(repo, '.git/index'), 'not an index at all\n')
  await expect(runner.walk(repo)).rejects.toThrow(/internal error/i)
  // The slot is free again: a live root walks on the same worker.
  await expect(runner.walk(root)).resolves.toEqual({ kind: 'not-repository' })
})

it('the disposer fails every queued walk', async () => {
  // A large walk keeps the worker busy so the second request is still
  // queued when the disposer fires: this repository's own worktree.
  const busy = runner.walk(process.cwd())
  const queued = runner.walk(root)
  runner.dispose()
  await expect(busy).rejects.toThrow('the git-walk worker was disposed')
  await expect(queued).rejects.toThrow('the git-walk worker was disposed')
  // A disposed runner serves the next walk with a fresh worker.
  await expect(runner.walk(root)).resolves.toEqual({ kind: 'not-repository' })
  runner.dispose()
})

it('a worker error fails the pending walk', async () => {
  const pending = runner.walk(process.cwd())
  const worker = (runner as unknown as { worker?: { emit: (event: string, error: Error) => boolean } }).worker
  expect(worker).toBeDefined()
  worker!.emit('error', new Error('the thread failed'))
  await expect(pending).rejects.toThrow('the thread failed')
})

it('a worker the thread lost fails its pending walk', async () => {
  const pending = runner.walk(process.cwd())
  // The worker object is private; the thread's own exit is the observed fault.
  const worker = (runner as unknown as { worker?: { terminate: () => Promise<number> } }).worker
  expect(worker).toBeDefined()
  await worker!.terminate()
  await expect(pending).rejects.toThrow(/the git-walk worker exited/)
})
