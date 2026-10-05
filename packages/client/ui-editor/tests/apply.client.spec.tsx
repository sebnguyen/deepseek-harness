/**
 * The plugin registers the editor tab type, its dictionaries, and its body;
 * disposing the fiber removes all three (HMR safety).
 */
// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, EDITOR_ID, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ui-editor client apply', () => {
  it('registers the editor type, dictionaries, and body; the fiber disposes all three', async () => {
    const ctx = new Context()
    const definitions: SidebarRightTabDefinition[] = []
    const disposed: string[] = []
    const locales: Array<[string, unknown]> = []
    const bodies: string[] = []
    const injected: string[] = []
    const reads: string[] = []
    const writes: string[] = []
    let specification: { inject: () => unknown } | undefined
    ctx.provide('sidebarRightTabs', {
      register: (definition: SidebarRightTabDefinition) => {
        definitions.push(definition)
        return () => { disposed.push('type') }
      },
    } as never)
    ctx.provide('locale', {
      register: (ns: string, dictionaries: unknown) => {
        locales.push([ns, dictionaries])
        return () => { disposed.push('locale') }
      },
    } as never)
    ctx.provide('remote', {
      workspaceFiles: {
        readAll: async (sessionId: string, path: string) => {
          reads.push(`${sessionId}/${path}`)
          return { ok: true, value: { absolutePath: '/w/a', version: 'v', bytes: 0, offset: 0, data: '', eof: true } }
        },
        write: async (sessionId: string, path: string, content: string) => {
          writes.push(`${sessionId}/${path}:${content}`)
          return { ok: true, value: { absolutePath: '/w/a', version: 'v2' } }
        },
      },
    } as never)
    ctx.provide('remote.workspaceFiles', {} as never)
    ctx.provide('slots', {
      inject: (seat: string, register: () => () => void) => {
        injected.push(seat)
        const release = register()
        return () => {
          release()
          disposed.push(seat)
        }
      },
      register: (specificationIn: { key: string; inject: () => unknown }) => {
        specification = specificationIn
        bodies.push(specificationIn.key)
        return () => { disposed.push('body') }
      },
    } as never)
    const fiber = await ctx.plugin({ inject: [...inject], apply })
    expect(definitions).toHaveLength(1)
    const definition = definitions[0]
    if (definition === undefined) throw new Error('the editor type must register')
    expect(definition.id).toBe(EDITOR_ID)
    expect(definition.priority).toBe('builtin')
    expect(definition.canOpen?.('dsh-resource://file/session/s-1/notes.md')).toBe(true)
    expect(definition.canOpen?.('dsh-resource://file/absolute/notes.md')).toBe(false)
    expect(locales.map(entry => entry[0])).toEqual(['editor'])
    expect(injected).toEqual(['sidebar.right.pane.tab'])
    expect(bodies).toEqual([EDITOR_ID])
    if (specification === undefined) throw new Error('the body must register with an inject face')
    const face = specification.inject() as {
      load: (file: unknown, signal: AbortSignal) => Promise<unknown>
      save: (file: unknown, content: string, version: string | undefined, signal: AbortSignal) => Promise<unknown>
    }
    const file = { sessionId: 's-1', path: 'notes.txt' }
    await face.load(file, new AbortController().signal)
    await face.save(file, 'text', undefined, new AbortController().signal)
    expect(reads).toEqual(['s-1/notes.txt'])
    expect(writes).toEqual(['s-1/notes.txt:text'])
    hostApply()
    await fiber.dispose()
    expect(disposed.sort()).toEqual(['body', 'locale', 'sidebar.right.pane.tab', 'type'])
  })
})
