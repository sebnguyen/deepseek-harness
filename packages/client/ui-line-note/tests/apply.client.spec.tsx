// @vitest-environment jsdom
/**
 * The line-note plugin contributes no host-side behavior and mounts its
 * dictionaries, the session hook, and the gutter entry on the Client.
 */
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
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

describe('host apply', () => {
  it('provides nothing and returns nothing', () => {
    expect(hostApply()).toBeUndefined()
  })
})

describe('client apply', () => {
  it('registers dictionaries, the lineNotes hook, and the gutter entry; disposal releases all three', async () => {
    const locales: unknown[] = []
    const bindings: unknown[] = []
    const injected: string[] = []
    const bodies: string[] = []
    const disposed: string[] = []
    const ctx = new Context()
    new RemoteService(ctx)
    ctx.provide('remote.checkpoint', {
      slots: vi.fn(async () => ({ ok: true, value: [] })),
      slotPut: vi.fn(async () => ({ ok: true, value: {} })),
    } as never)
    ctx.provide('locale', {
      register: (ns: string) => {
        locales.push(ns)
        return () => { disposed.push('locale') }
      },
      bind: () => () => '',
    } as never)
    ctx.provide('uiSession', {
      provide: (descriptor: { hooks: string[] }) => {
        bindings.push(descriptor)
        return () => { disposed.push('hook') }
      },
    } as never)
    ctx.provide('slots', {
      inject: (seat: string, register: () => () => void) => {
        injected.push(seat)
        const release = register()
        return () => {
          release()
          disposed.push(seat)
        }
      },
      register: (specificationIn: { id: string }) => {
        bodies.push(specificationIn.id)
        return () => { disposed.push('entry') }
      },
    } as never)
    const fiber = ctx.plugin({ inject: [...inject], apply: apply })
    await fiber.await()
    expect(locales).toEqual(['lineNote'])
    expect(injected).toEqual(['editor.cm.extension'])
    expect(bodies).toEqual(['line-note'])
    expect(bindings).toHaveLength(1)
    const descriptor = bindings[0] as { hooks: string[] }
    expect(descriptor.hooks).toEqual(['lineNotes'])
    await fiber.dispose()
    expect(disposed.sort()).toEqual(['editor.cm.extension', 'entry', 'hook', 'locale'])
  })

  it('serves the lineNotes hook as a register read keyed to the binding', async () => {
    const notesRemote = { calls: [] as string[] }
    let descriptor: { resolve: (binding: SessionBinding) => { hooks: { lineNotes: {
      getSnapshot: () => { byPath: Map<string, unknown[]> }
      subscribe: (listener: () => void) => () => void
    } } } } | undefined
    const ctx = new Context()
    new RemoteService(ctx)
    ctx.provide('remote.checkpoint', {
      slots: vi.fn(async (_sessionId: string, _path?: string) => {
        notesRemote.calls.push(`${_sessionId}:${String(_path)}`)
        return { ok: true as const, value: [{ path: 'notes.txt', slots: [noteSlot()] }] }
      }),
      slotPut: vi.fn(async () => ({ ok: true, value: {} })),
    } as never)
    ctx.provide('locale', new LocaleRuntime(ctx) as never)
    ctx.provide('uiSession', {
      provide: (one: typeof descriptor) => {
        descriptor = one
        return () => {}
      },
    } as never)
    ctx.provide('slots', {
      inject: () => () => {},
      register: () => () => {},
    } as never)
    const fiber = ctx.plugin({ inject: [...inject], apply: apply })
    await fiber.await()
    if (descriptor === undefined) throw new Error('the hook provider must register')
    const revision = { revision: 0 }
    const listeners = new Set<() => void>()
    const binding = {
      sessionId: 's-1',
      eventSource: {
        getSnapshot: () => revision,
        subscribe: (listener: () => void) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      },
    } as unknown as SessionBinding
    const source = descriptor.resolve(binding).hooks.lineNotes
    expect([...source.getSnapshot().byPath.keys()]).toEqual([])
    await vi.waitFor(() => {
      expect(source.getSnapshot().byPath.get('notes.txt')).toHaveLength(1)
    })
    // The wire arity is the full declared parameter list: an omitted
    // optional path rides as explicit undefined, not elision.
    expect(notesRemote.calls).toEqual(['s-1:undefined'])
  })

  it('exposes putSlot and slots over the checkpoint remote, memoizes sources, and survives a failing remote', async () => {
    let registered: { inject: (sessionId: string) => {
      putSlot: (slot: unknown) => Promise<unknown>
      slots: () => Promise<unknown[]>
    } } | undefined
    let descriptor: { resolve: (binding: SessionBinding) => { hooks: { lineNotes: {
      getSnapshot: () => { byPath: Map<string, unknown[]> }
      subscribe: (listener: () => void) => () => void
    } } } } | undefined
    let ok = true
    const calls: string[] = []
    const puts: unknown[] = []
    const ctx = new Context()
    new RemoteService(ctx)
    ctx.provide('remote.checkpoint', {
      slots: vi.fn(async (sessionId: string, path?: string) => {
        calls.push(`${sessionId}:${String(path)}`)
        if (!ok) return { ok: false as const, error: 'down' }
        return { ok: true as const, value: [{ path: 'notes.txt', slots: [noteSlot()] }] }
      }),
      slotPut: vi.fn(async (_sessionId: string, slot: unknown) => {
        puts.push([_sessionId, slot])
        return { ok: true as const, value: slot }
      }),
    } as never)
    ctx.provide('locale', new LocaleRuntime(ctx) as never)
    ctx.provide('uiSession', {
      provide: (one: typeof descriptor) => {
        descriptor = one
        return () => {}
      },
    } as never)
    ctx.provide('slots', {
      inject: (_key: string, callback: () => () => void) => callback(),
      register: (specification: typeof registered) => {
        registered = specification
        return () => {}
      },
    } as never)
    const fiber = ctx.plugin({ inject: [...inject], apply: apply })
    await fiber.await()
    if (descriptor === undefined || registered === undefined) {
      throw new Error('the plugin must register both faces')
    }
    const revisionBox = { revision: 0 }
    const binding = {
      sessionId: 's-1',
      eventSource: {
        getSnapshot: () => revisionBox,
        subscribe: () => () => {},
      },
    } as unknown as SessionBinding
    // The same binding resolves to the same source: one fetch, not two.
    const first = descriptor.resolve(binding).hooks.lineNotes
    const second = descriptor.resolve(binding).hooks.lineNotes
    expect(second).toBe(first)
    await vi.waitFor(() => {
      expect(first.getSnapshot().byPath.get('notes.txt')).toHaveLength(1)
    })
    expect(calls).toEqual(['s-1:undefined'])

    // The entry's inject factory hands out working putSlot and slots faces.
    const face = registered.inject('s-9')
    await face.putSlot({ slotId: 'note-z', kind: 'note', path: 'p', label: 'l', line: 1, retained: '', detail: { text: 'l' } })
    expect(puts).toHaveLength(1)
    expect(await face.slots()).toHaveLength(1)
    ok = false
    expect(await face.slots()).toEqual([])
    // The hook-bound read folds a failing remote to no notes too.
    revisionBox.revision = 1
    await vi.waitFor(() => {
      first.getSnapshot()
      expect(first.getSnapshot().byPath.size).toBe(0)
    })
  })
})

/** One note slot fixture. */
function noteSlot() {
  return {
    slotId: 'note-a', kind: 'note', path: 'notes.txt', label: 'careful', line: 2, createdAt: 1, detail: { text: 'careful' },
  }
}
