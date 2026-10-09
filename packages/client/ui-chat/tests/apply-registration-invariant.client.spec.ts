/**
 * The Chat apply's deferred registrations: the token-efficiency settings
 * item and the turn-chip row's checkpoint faces. This suite builds its own
 * service tree, so the invariant companion host must stay out of the root.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply, inject } from '../src/client/index.ts'

/** The Remote carrier the chat apply reads its checkpoint namespace through. */
class RemoteService extends Service {
  constructor(serviceCtx: Context) {
    super(serviceCtx, 'remote')
  }
}

interface RegisteredSpec {
  id: string
  locale?: string
  inject?: (sessionId: SessionId) => {
    slots: () => Promise<unknown[]>
    blob: (digest: string) => Promise<string | null>
  }
}

/** A bare Cordis mount capturing every registration the chat apply makes. */
async function registrationBench() {
  const specs = new Map<string, RegisteredSpec>()
  const checkpoint = {
    slots: vi.fn(async () => ({ ok: true, value: [] })),
    blob: vi.fn(async () => ({ ok: true, value: null })),
  }
  const ctx = new Context()
  new RemoteService(ctx)
  ctx.provide('slots', {
    inject: (_key: string, callback: () => () => void) => callback(),
    register: (spec: RegisteredSpec) => {
      specs.set(spec.id, spec)
      return () => { specs.delete(spec.id) }
    },
  } as never)
  ctx.provide('sessions', {
    binding: () => undefined,
    list: { getSnapshot: () => ({ byId: {} }) },
    scope: () => undefined,
    fork: vi.fn(async () => 'root-1' as SessionId),
    open: vi.fn(),
  } as never)
  ctx.provide('uiSession', { provide: () => () => {} } as never)
  ctx.provide('uiConversation', {
    binding: () => ({ target: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }) }),
    events: { register: () => () => {}, registerFallback: () => () => {} },
    views: { register: () => () => {} },
    imageUrl: vi.fn(() => 'url'),
    peekImageUrl: vi.fn(() => 'url'),
  } as never)
  ctx.provide('locale', { register: () => () => {}, bind: () => (key: string) => key } as never)
  ctx.provide('remote.session', {} as never)
  ctx.provide('remote.checkpoint', checkpoint as never)
  ctx.provide('sidebarRight', { openResource: vi.fn() } as never)
  const fiber = ctx.plugin({ inject: [...inject], apply: apply })
  await fiber.await()
  return { specs, checkpoint, fiber }
}

describe('Chat deferred registrations', () => {
  it('registers the token-efficiency item and serves turn-chip faces over the checkpoint remote', async () => {
    const registration = await registrationBench()
    expect(registration.specs.get('token-efficiency')).toBeDefined()
    const chips = registration.specs.get('turn-chip-row')!
    expect(chips.locale).toBe('chat')
    const face = chips.inject!('root-1' as SessionId)
    expect(await face.slots()).toEqual([])
    expect(await face.blob('sha256:x')).toBeNull()
    // A failing remote degrades the chips to none instead of throwing.
    registration.checkpoint.slots.mockResolvedValueOnce({ ok: false, error: 'down' } as never)
    expect(await face.slots()).toEqual([])
    registration.checkpoint.blob.mockResolvedValueOnce({ ok: false, error: 'down' } as never)
    expect(await face.blob('sha256:x')).toBeNull()
    await registration.fiber.dispose()
  })
})
