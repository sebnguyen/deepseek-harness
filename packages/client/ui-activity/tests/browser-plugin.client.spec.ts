/**
 * ui-activity plugin halves: the browser entry's dictionary and input-dock
 * registrations against the real SlotRegistry (with fiber teardown proving
 * removal — HMR safety), and the inert node entry.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyNode } from '../src/index.ts'
import { en, NS, zh } from '../src/client/locales.ts'

/** Slot ledger reader: entry ids currently registered in the input dock. */
function dockEntryIds(ctx: Context): (string | undefined)[] {
  return ctx.slots
    .entries('conversation.composer.dock')
    .map(entry => entry.options.id)
}

/** Boot the browser half over a real slot tree that declares the dock list. */
async function bench(): Promise<{ ctx: Context; fiber: ReturnType<Context['plugin']> }> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.composer.dock': { kind: 'list', scope: 'session' },
    },
  } as never, () => null)
  ctx.provide('sessions', {})
  // The locale plugin binds a settings scope, which reads the connection handle
  // and the forwarded-event port.
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  // These specs assert the shipped Chinese copy. There is no jsdom `window` in
  // this lane, so browser-language detection never runs and the locale comes
  // from FALLBACK_LOCALE (en): state the asserted locale explicitly.
  ctx.locale.setLocale('zh')
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber }
}

describe('ui-activity browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['sessions', 'slots', 'locale'])
  })

  it('registers the dock entry, and fiber teardown removes it (HMR safety)', async () => {
    const { ctx, fiber } = await bench()
    expect(dockEntryIds(ctx)).toContain('activity')
    await fiber.dispose()
    expect(dockEntryIds(ctx)).not.toContain('activity')
  })

  it('registers both dictionaries under its own namespace and releases them with the fiber', async () => {
    const { ctx, fiber } = await bench()
    const translate = ctx.locale.bind(NS)
    expect(translate('drawer.aria')).toBe(zh['drawer.aria'])
    ctx.locale.setLocale('en')
    expect(translate('drawer.aria')).toBe(en['drawer.aria'])

    // Withdrawn dictionaries leave the key unresolved rather than translated.
    await fiber.dispose()
    expect(translate('drawer.aria')).not.toBe(en['drawer.aria'])
  })

  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('supplies the dock entry callbacks through its inject face', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.slots.register({
      name: 'root',
      children: {
        'conversation.composer.dock': { kind: 'list', scope: 'session' },
      },
    } as never, () => null)
    const refreshSubagents = vi.fn()
    const openSubagent = vi.fn()
    const open = vi.fn()
    const subagentAddress = vi.fn((id: string) => id === 'child'
      ? { parentSessionId: 'parent', childSessionId: id, mode: 'one-shot' }
      : undefined)
    ctx.provide('sessions', { refreshSubagents, subagentAddress, openSubagent, open })
    ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
    ctx.provide('remote', { $on: () => () => {} } as never)
    ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const entry = ctx.slots.entries('conversation.composer.dock').find(candidate => candidate.options.id === 'activity')
    const injectChild = entry!.inject as unknown as ((id: string) => { onRefresh(): void; onOpenChild(id: string): void }) | undefined
    const face = injectChild!('session-1')

    face.onRefresh()
    expect(refreshSubagents).toHaveBeenCalledWith('session-1')
    face.onOpenChild('child')
    expect(openSubagent).toHaveBeenCalledWith({ parentSessionId: 'parent', childSessionId: 'child', mode: 'one-shot' })
    face.onOpenChild('missing')
    expect(openSubagent).toHaveBeenCalledTimes(1)
    // A child the catalog has not reached opens straight into its session.
    expect(open).toHaveBeenCalledWith('missing')
    await fiber.dispose()
  })
})

describe('ui-activity node half', () => {
  it('contributes no host behavior', () => {
    // The node half exists only so the plugin appears in the Loader tree.
    expect(applyNode).not.toThrow()
  })
})
