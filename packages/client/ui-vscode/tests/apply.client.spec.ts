/**
 * The plugin registers the frame tab type, dictionaries, and body; the
 * readiness mirror flips `canOpen` live and disposes with the fiber.
 */
import { Context } from '@deepseek-ai/cordis'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { describe, expect, it } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import type { IdeWireStatus } from '../src/client/rpc.ts'

const STATUS: IdeWireStatus = { ready: false, twinSha: undefined, reason: 'no-twin', frameUrl: undefined }

function fakeIde(): { readonly face: object; flip(ready: boolean): void } {
  const listeners = new Set<(status: IdeWireStatus) => void>()
  let current = STATUS
  return {
    face: {
      status: async () => current,
      events: (signal: AbortSignal) => ({
        [Symbol.asyncIterator]: async function* () {
          while (!signal.aborted) {
            yield current
            await new Promise<void>((resolve) => {
              const wake = (): void => resolve()
              listeners.add(wake)
              signal.addEventListener('abort', wake, { once: true })
            })
          }
        },
      }),
      open: async () => {},
    },
    flip(ready: boolean) {
      current = { ...current, ready }
      for (const listener of listeners) listener(current)
    },
  }
}

describe('ui-vscode client apply', () => {
  it('registers type, dictionaries, and body; readiness gates claims; disposal cleans all', async () => {
    const ctx = new Context()
    const definitions: SidebarRightTabDefinition[] = []
    const disposed: string[] = []
    const locales: string[] = []
    const slots: string[] = []
    const bodies: string[] = []
    const injected: string[] = []
    ctx.provide('sidebarRightTabs', {
      register: (definition: SidebarRightTabDefinition) => {
        definitions.push(definition)
        return () => { disposed.push('type') }
      },
    } as never)
    ctx.provide('locale', {
      register: (ns: string) => {
        locales.push(ns)
        return () => { disposed.push('locale') }
      },
    } as never)
    ctx.provide('slots', {
      inject: (seat: string, factory: () => () => void) => {
        slots.push(seat)
        const inner = factory() as unknown as { key: string; inject?: () => unknown }
        bodies.push(inner.key)
        injected.push(JSON.stringify((inner.inject as () => unknown)()))
        return () => { disposed.push('body') }
      },
      register: (spec: { key: string }) => spec,
    } as never)
    const ide = fakeIde()
    ctx.provide('remote', { ide: ide.face } as never)
    ctx.provide('remote.ide', ide.face as never)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    expect(locales).toEqual(['vscode'])
    expect(slots).toEqual(['sidebar.right.pane.tab'])
    expect(injected.length).toBe(1)
    expect(definitions).toHaveLength(1)
    const address = 'dsh-resource://file/session/s1/a.ts'
    expect(definitions[0]!.canOpen?.(address)).toBe(false)
    ide.flip(true)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(definitions[0]!.canOpen?.(address)).toBe(true)
    ide.flip(false)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(definitions[0]!.canOpen?.(address)).toBe(false)

    await fiber.dispose()
    expect(disposed).toEqual(expect.arrayContaining(['type', 'locale', 'body']))
  })
})
