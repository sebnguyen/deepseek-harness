/**
 * The worker entry loaded in-process behind a parent port the spec injects:
 * its message handler answers walks with replies, faults with messages, and
 * the entry refuses a main-thread load.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import nodeFs from 'node:fs'
import git from 'isomorphic-git'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

/** Posted messages the fake port records for the spec to assert. */
interface Posted {
  readonly id: number
  readonly reply?: { kind: string }
  readonly error?: string
}

let root: string
let repo: string
let handler: ((message: { id: number; dir: string }) => void) | undefined
let posted: Posted[]
let parentPort: unknown

vi.mock('node:worker_threads', () => ({
  get parentPort() {
    return parentPort
  },
}))

const fakePort = {
  on: (_event: never, cb: (message: { id: number; dir: string }) => void) => {
    handler = cb
  },
  postMessage: (message: Posted) => {
    posted.push(message)
  },
}

/** Load the entry once against the currently injected parent port. */
async function loadEntry(): Promise<void> {
  vi.resetModules()
  vi.doMock('node:worker_threads', () => ({ parentPort }))
  await import('../src/worker.ts')
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-git-worker-entry-'))
  repo = join(root, 'repo')
  await mkdir(repo, { recursive: true })
  handler = undefined
  posted = []
  parentPort = fakePort
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

it('answers one walk per request with the reply', async () => {
  await git.init({ fs: nodeFs, dir: repo })
  await loadEntry()
  expect(handler).toBeDefined()
  handler!({ id: 7, dir: repo })
  await vi.waitFor(() => { expect(posted).toHaveLength(1) })
  expect(posted[0]).toMatchObject({ id: 7 })
  expect(posted[0]!.reply?.kind).toBe('status')
})

it('answers a walk fault with its message', async () => {
  await git.init({ fs: nodeFs, dir: repo })
  await writeFile(join(repo, 'a.txt'), 'a\n')
  await git.add({ fs: nodeFs, dir: repo, filepath: 'a.txt' })
  await writeFile(join(repo, '.git/index'), 'not an index at all\n')
  await loadEntry()
  handler!({ id: 9, dir: repo })
  await vi.waitFor(() => { expect(posted).toHaveLength(1) })
  expect(posted[0]).toMatchObject({ id: 9 })
  expect(posted[0]!.reply).toBeUndefined()
  expect(posted[0]!.error).toMatch(/internal error/i)
})

it('refuses a main-thread load', async () => {
  parentPort = null
  await expect(loadEntry()).rejects.toThrow('the git-walk entry runs only as a worker thread')
})
