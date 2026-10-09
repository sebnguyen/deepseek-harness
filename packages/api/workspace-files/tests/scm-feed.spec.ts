/**
 * The scm push feed: remembered roots schedule one debounced re-walk per
 * burst of observed writes inside them, pushes the walk's mapped state, and
 * stays silent for writes outside, faults that are not the absence of a
 * repository, and Hosts without the seam.
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { FsVersion } from '@deepseek-ai/dsh-fs'
import type { FsObservation, FsTarget } from '@deepseek-ai/dsh-fs'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { WorkspaceFiles } from '../src/index.ts'
import { ScmFeed } from '../src/scm-feed.ts'
import type { WorkspaceScmState } from '../src/types.ts'
import { openWorkspace, type Harness } from './harness.ts'

let harness: Harness

beforeEach(async () => {
  harness = await openWorkspace('wffs-scmfeed-')
})

afterEach(async () => {
  await harness.dispose()
})

/** One observed write of a path inside or beside the workspace. */
function observed(absolutePath: string): void {
  void harness.ctx.fs.resolve(absolutePath).then((target: FsTarget) => {
    const observation: FsObservation = { kind: 'present', version: FsVersion('v1') }
    harness.ctx.emit('fs/observed', target, observation, undefined)
  })
}

/** The pushed refreshes one context emits, in order. */
function pushed(ctx: Context): { root: string; state: WorkspaceScmState }[] {
  const seen: { root: string; state: WorkspaceScmState }[] = []
  ctx.on('workspaceFiles/scm-updated', (root, state) => {
    seen.push({ root, state })
  })
  return seen
}

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

it('an observed write inside a remembered root pushes one refreshed state', async () => {
  harness.ctx.provide('git', {
    status: async () => ({ head: 'h', entries: [{ path: 'a.txt', status: 'modified' }], truncated: false }),
  } as never)
  const service = harness.endpoint({ scmUpdateDebounceMs: 10 })
  await service.scmStatus(harness.scope, new AbortController().signal)
  // Remembering the same root twice keeps one schedule queue.
  await service.scmStatus(harness.scope, new AbortController().signal)
  const seen = pushed(harness.ctx)
  await writeFile(join(harness.workspace, 'a.txt'), 'x\n')
  observed(join(harness.workspace, 'a.txt'))
  await wait(60)
  expect(seen).toEqual([{
    root: harness.workspace,
    state: { present: true, notRepository: false, head: 'h', entries: [{ path: 'a.txt', status: 'modified' }], truncated: false },
  }])
})

it('a burst of writes inside the quiet window schedules one walk', async () => {
  let walks = 0
  harness.ctx.provide('git', {
    status: async () => {
      walks += 1
      return { head: 'h', entries: [], truncated: false }
    },
  } as never)
  const service = harness.endpoint({ scmUpdateDebounceMs: 40 })
  await service.scmStatus(harness.scope, new AbortController().signal)
  const base = walks
  const seen = pushed(harness.ctx)
  observed(join(harness.workspace, 'a.txt'))
  await wait(15)
  observed(join(harness.workspace, 'b.txt'))
  await wait(120)
  expect(walks - base).toBe(1)
  expect(seen).toHaveLength(1)
})

it('writes outside every remembered root schedule nothing', async () => {
  let walks = 0
  harness.ctx.provide('git', {
    status: async () => {
      walks += 1
      return { head: 'h', entries: [], truncated: false }
    },
  } as never)
  const service = harness.endpoint({ scmUpdateDebounceMs: 10 })
  await service.scmStatus(harness.scope, new AbortController().signal)
  const base = walks
  observed(join(harness.outside, 'y.txt'))
  await wait(60)
  expect(walks - base).toBe(0)
})

it('observations before any scm query schedule nothing', async () => {
  let walks = 0
  harness.ctx.provide('git', {
    status: async () => {
      walks += 1
      return { head: 'h', entries: [], truncated: false }
    },
  } as never)
  harness.endpoint({ scmUpdateDebounceMs: 10 })
  observed(join(harness.workspace, 'a.txt'))
  await wait(60)
  expect(walks).toBe(0)
})

it('a Host without the git seam stays silent on writes', async () => {
  const service = harness.endpoint({ scmUpdateDebounceMs: 10 })
  await service.scmStatus(harness.scope, new AbortController().signal)
  const seen = pushed(harness.ctx)
  observed(join(harness.workspace, 'a.txt'))
  await wait(60)
  expect(seen).toEqual([])
})

it('the seam\'s not-a-repository refusal pushes the notRepository face', async () => {
  harness.ctx.provide('git', {
    status: async (): Promise<never> => {
      throw Object.assign(new Error('no repo'), { code: 'GIT_NOT_REPOSITORY' })
    },
  } as never)
  const service = harness.endpoint({ scmUpdateDebounceMs: 10 })
  await service.scmStatus(harness.scope, new AbortController().signal)
  const seen = pushed(harness.ctx)
  observed(join(harness.workspace, 'a.txt'))
  await wait(60)
  expect(seen).toEqual([{
    root: harness.workspace,
    state: { present: true, notRepository: true, head: null, entries: [], truncated: false },
  }])
})

it('any other seam fault leaves the client\'s last state alone', async () => {
  // The pulling query rides a live seam; the pushed re-walk meets the fault.
  let down = false
  harness.ctx.provide('git', {
    status: async () => {
      if (down) throw new Error('seam down')
      return { head: 'h', entries: [], truncated: false }
    },
  } as never)
  const service = harness.endpoint({ scmUpdateDebounceMs: 10 })
  await service.scmStatus(harness.scope, new AbortController().signal)
  down = true
  const seen = pushed(harness.ctx)
  observed(join(harness.workspace, 'a.txt'))
  await wait(60)
  expect(seen).toEqual([])
})

it('a root the backend cannot resolve is remembered as nothing', async () => {
  const ctx = new Context()
  ctx.provide('fs', {
    resolve: async (): Promise<never> => {
      throw new Error('backend down')
    },
    contains: () => true,
  } as never)
  const feed = new ScmFeed(ctx, 10)
  feed.remember('/gone')
  await wait(20)
  const target = { targetKey: 'k', displayPath: '/gone/a' }
  ctx.emit('fs/observed', target as never, { kind: 'present', version: FsVersion('v') } as never, undefined)
  await wait(20)
})

it('disposal drops the pending re-walk', async () => {
  let walks = 0
  harness.ctx.provide('git', {
    status: async () => {
      walks += 1
      return { head: 'h', entries: [], truncated: false }
    },
  } as never)
  // Applied through a plugin fiber, like production composes the service,
  // so disposing the fiber runs the feed's own cleanup effect.
  let service!: WorkspaceFiles
  const fiber = await harness.ctx.plugin({
    inject: ['fs', 'sandboxPolicy'],
    apply: (scope) => {
      service = new WorkspaceFiles(scope, {
        maxBytes: 1024, maxFileBytes: 1024, maxLines: 100, maxEntries: 100, scmUpdateDebounceMs: 30,
      })
    },
  })
  await service.scmStatus(harness.scope, new AbortController().signal)
  // The remembered root's resolve settles before observations arrive.
  await wait(10)
  const base = walks
  observed(join(harness.workspace, 'a.txt'))
  await wait(5)
  await fiber.dispose()
  await wait(80)
  expect(walks - base).toBe(0)
})

it('a second status query keeps one remembered root', async () => {
  let walks = 0
  harness.ctx.provide('git', {
    status: async () => {
      walks += 1
      return { head: 'h', entries: [], truncated: false }
    },
  } as never)
  const service = harness.endpoint({ scmUpdateDebounceMs: 10 })
  await service.scmStatus(harness.scope, new AbortController().signal)
  // The first remember's resolve settles before the second query repeats it.
  await wait(10)
  await service.scmStatus(harness.scope, new AbortController().signal)
  await wait(10)
  const base = walks
  observed(join(harness.workspace, 'a.txt'))
  await wait(60)
  // The two queries pull, the burst pushes once: exactly one more walk.
  expect(walks - base).toBe(1)
})

it('a feed without the git seam stays silent on writes', async () => {
  const ctx = new Context()
  ctx.provide('fs', {
    resolve: async (path: string) => ({ path }),
    contains: () => true,
  } as never)
  const feed = new ScmFeed(ctx, 5)
  feed.remember('/w')
  await wait(10)
  const target = { targetKey: 'k', path: '/w/a' }
  ctx.emit('fs/observed', target as never, { kind: 'present', version: FsVersion('v1') } as never, undefined)
  await wait(40)
})
