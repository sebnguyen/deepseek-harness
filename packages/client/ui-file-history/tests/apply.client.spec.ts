/**
 * The file-history plugin contributes nothing host-side and provides the
 * `fileHistory` session hook as one memoized register projection per binding;
 * failed and superseded reads keep the last folded register.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import { Context, Service } from '@deepseek-ai/cordis'
import { apply as hostApply } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'

/** The Remote carrier the plugin's namespace reads. */
class RemoteService extends Service {
  constructor(serviceCtx: Context) {
    super(serviceCtx, 'remote')
  }
}

/** The non-checkpoint services the plugin injects but never calls in these specs. */
function provideCarrierServices(ctx: Context): void {
  ctx.provide('slots', { inject: () => () => {}, register: () => () => {} } as never)
  ctx.provide('sessions', { binding: () => undefined, list: { getSnapshot: () => ({ byId: {} }) } } as never)
  ctx.provide('locale', { register: () => () => {}, bind: () => (key: string) => key } as never)
}

/** One binding with a hand-advanced revision and a session cwd; null leaves the cwd absent. */
function bindingFixture(cwd: string | null = '/w') {
  const revisionBox = { revision: 0 }
  const binding = {
    sessionId: 's-1',
    session: { getSnapshot: () => ({ cwd: cwd === null ? undefined : cwd }) },
    eventSource: {
      getSnapshot: () => revisionBox,
      subscribe: () => () => {},
    },
  } as unknown as SessionBinding
  return { binding, revisionBox }
}

const TIMELINES = [{
  path: 'a.txt',
  slots: [{
    slotId: 'c1', kind: 'worktree', path: 'a.txt', label: 'writer', createdAt: 7, turn: 1, after: 'sha256:b', detail: { toolName: 'writer' },
  }],
}]

/** The same register after one more write: the fold must move. */
const TIMELINES_NEXT = [{
  path: 'a.txt',
  slots: [{
    slotId: 'c1', kind: 'worktree', path: 'a.txt', label: 'writer', createdAt: 7, turn: 1, after: 'sha256:b', detail: { toolName: 'writer' },
  }, {
    slotId: 'c2', kind: 'worktree', path: 'a.txt', label: 'writer', createdAt: 8, turn: 1, before: 'sha256:b', after: 'sha256:c', detail: { toolName: 'writer' },
  }],
}]

interface HistorySource {
  getSnapshot: () => { files: readonly { path: string }[] }
  subscribe: (listener: () => void) => () => void
}
interface ApplyDescriptor {
  resolve: (binding: SessionBinding) => { hooks: { fileHistory: HistorySource } }
}

describe('host apply', () => {
  it('provides nothing', () => {
    expect(hostApply()).toBeUndefined()
  })
})

describe('client apply', () => {
  it('serves the fileHistory hook as a register fold keyed by revision and cwd', async () => {
    const { binding, revisionBox } = bindingFixture()
    const calls: string[] = []
    const resultBox: { value: unknown } = { value: { ok: true, value: TIMELINES } }
    const ctx = new Context()
    new RemoteService(ctx)
    provideCarrierServices(ctx)
    ctx.provide('remote.checkpoint', {
      slots: vi.fn(async (sessionId: string) => {
        calls.push(sessionId)
        return resultBox.value
      }),
    } as never)
    let descriptor: ApplyDescriptor | undefined
    ctx.provide('uiSession', {
      provide: (one: ApplyDescriptor) => {
        descriptor = one
        return () => {}
      },
    } as never)
    const fiber = ctx.plugin({ inject: [...inject], apply: apply })
    await fiber.await()
    if (descriptor === undefined) throw new Error('the hook provider must register')
    const source = descriptor.resolve(binding).hooks.fileHistory
    expect(source.getSnapshot().files).toEqual([])
    await vi.waitFor(() => {
      expect(source.getSnapshot().files.map(file => file.path)).toEqual(['a.txt'])
    })
    expect(calls).toEqual(['s-1'])
    // The same key never refetches; the binding is memoized to one source.
    source.getSnapshot()
    expect(calls).toEqual(['s-1'])
    expect(descriptor.resolve(binding).hooks.fileHistory).toBe(source)

    // An unrelated revision bump refetches but keeps the served fold's
    // identity, so hook consumers do not re-render on every session event.
    const listener = vi.fn()
    const off = source.subscribe(listener)
    const served = source.getSnapshot()
    revisionBox.revision = 2
    await vi.waitFor(async () => {
      source.getSnapshot()
      expect(calls.length).toBe(2)
    })
    expect(listener).not.toHaveBeenCalled()
    expect(source.getSnapshot()).toBe(served)

    // A register that moved serves a fresh fold and notifies.
    resultBox.value = { ok: true, value: TIMELINES_NEXT }
    revisionBox.revision = 3
    await vi.waitFor(async () => {
      source.getSnapshot()
      expect(listener).toHaveBeenCalled()
    })
    expect(source.getSnapshot()).not.toBe(served)
    off()

    // A binding without a cwd folds under the empty-cwd key too.
    const { binding: cwdless } = bindingFixture(null)
    const cwdlessSource = descriptor.resolve(cwdless).hooks.fileHistory
    await vi.waitFor(() => {
      cwdlessSource.getSnapshot()
      expect(cwdlessSource.getSnapshot().files.map(file => file.path)).toEqual(['a.txt'])
    })

    // A failed envelope keeps the last fold.
    resultBox.value = { ok: false, error: 'down' }
    revisionBox.revision = 4
    await vi.waitFor(() => {
      source.getSnapshot()
      expect(calls.length).toBe(5)
    })
    expect(source.getSnapshot().files.map(file => file.path)).toEqual(['a.txt'])
    await fiber.dispose()
  })

  it('refolds absolute slot paths relative to the session cwd', async () => {
    const { binding } = bindingFixture('/w')
    const ctx = new Context()
    new RemoteService(ctx)
    provideCarrierServices(ctx)
    ctx.provide('remote.checkpoint', {
      slots: vi.fn(async () => ({
        ok: true,
        value: [{ path: '/w/a.txt', slots: [{ slotId: 'c9', kind: 'worktree', path: '/w/a.txt', label: 'w', createdAt: 9, after: 'sha256:b', detail: { toolName: 'w' } }] }],
      })),
    } as never)
    let descriptor: ApplyDescriptor | undefined
    ctx.provide('uiSession', {
      provide: (one: ApplyDescriptor) => {
        descriptor = one
        return () => {}
      },
    } as never)
    const fiber = ctx.plugin({ inject: [...inject], apply: apply })
    await fiber.await()
    if (descriptor === undefined) throw new Error('the hook provider must register')
    const source = descriptor.resolve(binding).hooks.fileHistory
    await vi.waitFor(() => {
      expect(source.getSnapshot().files.map(file => file.path)).toEqual(['a.txt'])
    })
    await fiber.dispose()
  })

  it('a revision bump mid-flight coalesces into the in-flight read', async () => {
    const { binding, revisionBox } = bindingFixture()
    let release: (value: { ok: true; value: unknown }) => void = () => {}
    const pending = new Promise<{ ok: true; value: unknown }>((resolve) => { release = resolve })
    const slots = vi.fn(() => pending)
    const ctx = new Context()
    new RemoteService(ctx)
    provideCarrierServices(ctx)
    ctx.provide('remote.checkpoint', { slots } as never)
    let descriptor: ApplyDescriptor | undefined
    ctx.provide('uiSession', {
      provide: (one: ApplyDescriptor) => {
        descriptor = one
        return () => {}
      },
    } as never)
    const fiber = ctx.plugin({ inject: [...inject], apply: apply })
    await fiber.await()
    if (descriptor === undefined) throw new Error('the hook provider must register')
    const source = descriptor.resolve(binding).hooks.fileHistory
    source.getSnapshot()
    // The bump arrives while the first read is still in flight: no second read.
    revisionBox.revision = 2
    source.getSnapshot()
    source.getSnapshot()
    expect(slots).toHaveBeenCalledTimes(1)
    release({ ok: true, value: TIMELINES })
    await vi.waitFor(() => {
      expect(source.getSnapshot().files.map(file => file.path)).toEqual(['a.txt'])
    })
    await fiber.dispose()
  })

  it('keeps the last fold when the remote rejects, and refetches on the next revision', async () => {
    const { binding, revisionBox } = bindingFixture()
    let mode: 'ok' | 'reject' = 'ok'
    let fetches = 0
    const ctx = new Context()
    new RemoteService(ctx)
    provideCarrierServices(ctx)
    ctx.provide('remote.checkpoint', {
      slots: vi.fn(async () => {
        fetches += 1
        if (mode === 'reject') return Promise.reject(new Error('transport'))
        return { ok: true, value: TIMELINES }
      }),
    } as never)
    let descriptor: ApplyDescriptor | undefined
    ctx.provide('uiSession', {
      provide: (one: ApplyDescriptor) => {
        descriptor = one
        return () => {}
      },
    } as never)
    const fiber = ctx.plugin({ inject: [...inject], apply: apply })
    await fiber.await()
    if (descriptor === undefined) throw new Error('the hook provider must register')
    const source = descriptor.resolve(binding).hooks.fileHistory
    await vi.waitFor(() => { expect(source.getSnapshot().files).toHaveLength(1) })
    mode = 'reject'
    revisionBox.revision = 1
    await vi.waitFor(() => {
      source.getSnapshot()
      expect(fetches).toBe(2)
    })
    // The rejected read keeps the prior fold in place.
    expect(source.getSnapshot().files).toHaveLength(1)
    mode = 'ok'
    revisionBox.revision = 2
    await vi.waitFor(() => {
      source.getSnapshot()
      expect(fetches).toBe(3)
    })
    expect(source.getSnapshot().files).toHaveLength(1)
    await fiber.dispose()
  })
})
