/**
 * The line-notes plane: session notes render as ✎ inlay hints, the
 * add-note command freezes the caret line into a note slot — against faked
 * facade/remotes.
 */

import { describe, expect, it } from 'vitest'
import { apply, inject } from '../src/vscode/index.ts'

const NOTE = { id: 'n1', path: 'src/a.ts', line: 2, text: 'remember this' }

interface Fakes {
  ctx: Record<string, unknown>
  inlayProviders: Array<{ selector: unknown; provider: Record<string, unknown> }>
  commands: Map<string, (...args: unknown[]) => unknown>
  listeners: Map<string, Array<(arg: unknown) => void>>
  emitters: Array<{ fired: number }>
  adds: Array<Record<string, unknown>>
}

function makeFakes(overrides: { input?: string | undefined; lineText?: string } = {}): Fakes {
  const fakes: Fakes = {
    ctx: {},
    inlayProviders: [],
    commands: new Map(),
    listeners: new Map(),
    emitters: [],
    adds: [],
  }
  const api = {
    workspace: { workspaceRoot: () => '/repo' },
    window: {
      activeTextEditor: () => ({ path: '/repo/src/a.ts', line: 7, lineText: overrides.lineText ?? 'const x = 1' }),
      showInputBox: async () => overrides.input,
    },
    languages: {
      registerInlayHintsProvider: (selector: unknown, provider: Record<string, unknown>) => {
        fakes.inlayProviders.push({ selector, provider })
        return { dispose: () => undefined }
      },
    },
    commands: {
      registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
        fakes.commands.set(id, handler)
        return { dispose: () => undefined }
      },
    },
    runtime: {
      createEventEmitter: () => {
        const emitter = { fired: 0, event: { tag: 'event' }, fire() { emitter.fired += 1 }, dispose() {} }
        fakes.emitters.push(emitter)
        return emitter
      },
    },
  }
  fakes.ctx = {
    vscodeApi: api,
    remote: {
      lineNotes: {
        state: async (sessionId: string) => (sessionId === 's1'
          ? { ok: true, value: { notes: [NOTE] } }
          : { ok: true, value: { notes: [] } }),
        add: async (sessionId: string, note: Record<string, unknown>) => {
          fakes.adds.push({ sessionId, ...note })
          return { ok: true, value: { id: 'note-abcd', ...note } }
        },
      },
    },
    twinCore: { token: 'tkn', sessionId: 's1' },
    on: (event: string, listener: (arg: unknown) => void) => {
      const list = fakes.listeners.get(event) ?? []
      list.push(listener)
      fakes.listeners.set(event, list)
      return listener
    },
  }
  return fakes
}

const DOCUMENT = {
  uri: { fsPath: '/repo/src/a.ts' },
  lineCount: 10,
  lineAt: () => ({ text: 'x' }),
}

describe('vscode-line-notes plane', () => {
  it('declares its seat services by inject list', () => {
    expect(inject).toEqual(['vscodeApi', 'remote.lineNotes'])
  })

  it('registers the inlay provider and the add-note command', () => {
    const fakes = makeFakes()
    apply(fakes.ctx as never)
    expect(fakes.inlayProviders).toHaveLength(1)
    expect([...fakes.commands.keys()]).toEqual(['do-harness.addLineNote'])
  })

  it('pins one ✎ hint at the end of every noted line', async () => {
    const fakes = makeFakes()
    apply(fakes.ctx as never)
    const provide = fakes.inlayProviders[0]!.provider.provideInlayHints as (
      doc: unknown,
    ) => Promise<Array<Record<string, unknown>>>
    const hints = await provide(DOCUMENT)
    expect(hints).toEqual([{
      position: { line: 1, character: 'x'.length },
      label: '✎ remember this',
      tooltip: 'remember this',
      paddingLeft: true,
    }])
    // A document in another file or outside the workspace gets no hints.
    await expect(provide({ ...DOCUMENT, uri: { fsPath: '/repo/src/other.ts' } })).resolves.toEqual([])
    await expect(provide({ ...DOCUMENT, uri: { fsPath: '/elsewhere/a.ts' } })).resolves.toEqual([])
  })

  it('the add-note command freezes the caret line into a note slot and refreshes', async () => {
    const fakes = makeFakes({ input: '  first note  ' })
    apply(fakes.ctx as never)
    await fakes.commands.get('do-harness.addLineNote')!()
    expect(fakes.adds).toEqual([{
      sessionId: 's1',
      path: 'src/a.ts',
      line: 7,
      text: 'first note',
      retained: 'const x = 1',
    }])
    expect(fakes.emitters[0]!.fired).toBeGreaterThan(0)
  })

  it('an empty or cancelled prompt writes nothing', async () => {
    for (const input of [undefined, '   ']) {
      const fakes = makeFakes({ input })
      apply(fakes.ctx as never)
      await fakes.commands.get('do-harness.addLineNote')!()
      expect(fakes.adds).toEqual([])
    }
  })

  it('tracks the activate frame: a switch clears the session’s notes', async () => {
    const fakes = makeFakes()
    apply(fakes.ctx as never)
    const provide = fakes.inlayProviders[0]!.provider.provideInlayHints as (doc: unknown) => Promise<unknown[]>
    expect(await provide(DOCUMENT)).toHaveLength(1)
    for (const listener of fakes.listeners.get('dsh/frame/ideBridge/activate') ?? []) {
      listener({ type: 'ideBridge/activate', sessionId: 'other' })
    }
    // The fake's state always answers NOTE, but only for the seeded session.
    await expect(provide(DOCUMENT)).resolves.toEqual([])
  })
})
