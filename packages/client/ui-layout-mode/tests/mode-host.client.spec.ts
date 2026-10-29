// @vitest-environment jsdom
// The mode state is owned here now: the host asks once, pins the choice, and
// falls back to the default shell only when the pinned entry disappears.
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import type { LayoutModeService } from '../src/client/contract.ts'

afterEach(() => { vi.restoreAllMocks() })

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  ctx.provide('locale', new LocaleRuntime(ctx))
  // Stand in for AppFrame's `layout.mode` seat declaration.
  slots.register({
    name: 'root',
    children: { 'layout.mode': { kind: 'single', scope: 'root' } },
  } as never, () => null)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  const service = ctx.get('layoutMode') as LayoutModeService
  return { ctx, slots, fiber, service }
}

describe('ui-layout-mode', () => {
  it('starts in the chooser and pins the first valid choice', async () => {
    const b = await bench()
    expect(b.service.info.getSnapshot()).toEqual({ phase: 'choosing', mode: 'default' })
    expect(b.ctx.slots.entries('layout.mode')).toHaveLength(1)

    b.slots.register({ name: 'layout.mode.entry', key: 'turbo' } as never, () => null)
    b.service.select('turbo')
    expect(b.service.info.getSnapshot()).toEqual({ phase: 'active', mode: 'turbo' })

    b.service.select('default')
    expect(b.service.info.getSnapshot()).toEqual({ phase: 'active', mode: 'turbo' })
    await b.fiber.dispose()
  })

  it('ignores an unregistered mode id', async () => {
    const b = await bench()
    b.service.select('missing')
    expect(b.service.info.getSnapshot()).toEqual({ phase: 'choosing', mode: 'default' })
    await b.fiber.dispose()
  })

  it('falls back to default when the pinned entry disappears', async () => {
    const b = await bench()
    const dispose = b.slots.register({ name: 'layout.mode.entry', key: 'turbo' } as never, () => null)
    b.service.select('turbo')
    dispose()
    await vi.waitFor(() => {
      expect(b.service.info.getSnapshot()).toEqual({ phase: 'active', mode: 'default' })
    })
    await b.fiber.dispose()
  })
})
