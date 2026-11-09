// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { describe, expect, it } from 'vitest'
import { apply, inject } from '../src/client/index.ts'

describe('ui-orchestration registration', () => {
  it('registers one keyed entry and one launch option', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const slots = ctx.get('slots') as SlotRegistry
    ctx.provide('locale', new LocaleRuntime(ctx))
    ctx.provide('sessions', {
      open: () => {},
      create: async () => 'session',
      retain: () => () => {},
      refreshSubagents: () => {},
    } as never)

    slots.register({
      name: 'root',
      children: {
        'layout.mode.entry': { kind: 'keyed', scope: 'root' },
        'layout.mode.option': { kind: 'list', scope: 'root' },
      },
    } as never, () => null)

    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const entries = slots.entries('layout.mode.entry') as readonly { options: { key?: string } }[]
    const options = slots.entries('layout.mode.option') as readonly { options: { id?: string } }[]
    expect(entries.some(entry => entry.options.key === 'orchestration')).toBe(true)
    expect(options.some(option => option.options.id === 'orchestration')).toBe(true)

    await fiber.dispose()
  })
})
