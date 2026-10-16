/**
 * The line-notes plane: session notes render as comment threads at their
 * lines, the add-note command freezes the caret line into a note slot —
 * against faked facade/remotes.
 */

import { describe, expect, it } from 'vitest'
import { apply, inject } from '../src/vscode/index.ts'

const NOTE = { id: 'n1', path: 'src/a.ts', line: 2, text: 'remember this' }

interface ThreadRecord {
  uri: unknown
  range: unknown
  comments: readonly unknown[]
  label: string | undefined
  canReply: unknown
  disposed: number
}

interface Fakes {
  ctx: Record<string, unknown>
  controllers: Array<{ id: string; label: string }>
  threads: ThreadRecord[]
  commands: Map<string, (...args: unknown[]) => unknown>
  listeners: Map<string, Array<(arg: unknown) => void>>
  emitters: Array<{ fired: number }>
  adds: Array<Record<string, unknown>>
}

interface SeededNote { readonly id: string; readonly path: string; readonly line: number; readonly text: string }

function makeFakes(overrides: { input?: string | undefined; lineText?: string; sessionsNotes?: readonly SeededNote[] } = {}): Fakes {
  const fakes: Fakes = {
    ctx: {},
    controllers: [],
    threads: [],
    commands: new Map(),
    listeners: new Map(),
    emitters: [],
    adds: [],
  }
  const seededNotes = overrides.sessionsNotes ?? [NOTE]
  const api = {
    workspace: {
      workspaceRoot: () => '/repo',
      openTextDocument: async () => ({ lineCount: 10 }),
    },
    window: {
      activeTextEditor: () => ({ path: '/repo/src/a.ts', line: 7, lineText: overrides.lineText ?? 'const x = 1' }),
      onDidChangeActiveTextEditor: () => ({ dispose: () => undefined }),
      showInputBox: async () => overrides.input,
    },
    comments: {
      createCommentController: (id: string, label: string) => {
        fakes.controllers.push({ id, label })
        return {
          createCommentThread: (uri: unknown, range: unknown, comments: readonly unknown[]) => {
            const record: ThreadRecord = { uri, range, comments, label: undefined, canReply: undefined, disposed: 0 }
            fakes.threads.push(record)
            return {
              get label() { return record.label },
              set label(value: string | undefined) { record.label = value },
              get canReply() { return record.canReply },
              set canReply(value: unknown) { record.canReply = value },
              dispose() { record.disposed += 1 },
            }
          },
        }
      },
    },
    uri: { file: (path: string) => ({ fsPath: path }) },
    classes: {},
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
          ? { ok: true, value: { notes: seededNotes } }
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

/** Wait out the plane's render queue (promise chaining, no clocks). */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise(resolve => setTimeout(resolve, 0))
}

describe('vscode-line-notes plane', () => {
  it('declares its seat services by inject list', () => {
    expect(inject).toEqual(['vscodeApi', 'remote', 'remote.lineNotes'])
  })

  it('creates one comment controller, renders the seeded note, and registers the add-note command', async () => {
    const fakes = makeFakes()
    apply(fakes.ctx as never)
    await settle()
    expect(fakes.controllers).toEqual([{ id: 'dsh-line-notes', label: 'DSH Line Notes' }])
    expect([...fakes.commands.keys()]).toEqual(['do-harness.addLineNote'])
    expect(fakes.threads).toHaveLength(1)
  })

  it('pins one comment thread at every noted line of the active file', async () => {
    const fakes = makeFakes()
    apply(fakes.ctx as never)
    await settle()
    const thread = fakes.threads[0]!
    expect(thread.uri).toEqual({ fsPath: '/repo/src/a.ts' })
    expect(thread.range).toEqual({ start: { line: 1, character: 0 }, end: { line: 1, character: 0 } })
    expect(thread.comments).toHaveLength(1)
    expect(thread.comments[0]).toMatchObject({
      body: 'remember this',
      author: { name: 'harness agent' },
    })
    expect(thread.label).toBe('✎ remember this')
    expect(thread.canReply).toBe(false)
  })

  it('a note with a line beyond the document is dropped', async () => {
    const fakes = makeFakes({ sessionsNotes: [{ ...NOTE, line: 99 }] })
    apply(fakes.ctx as never)
    await settle()
    expect(fakes.threads).toHaveLength(0)
  })

  it('the add-note command freezes the caret line into a note slot and re-renders', async () => {
    const fakes = makeFakes({ input: '  first note  ' })
    apply(fakes.ctx as never)
    await settle()
    const threadsBefore = fakes.threads.length
    await fakes.commands.get('do-harness.addLineNote')!()
    await settle()
    expect(fakes.adds).toEqual([{
      sessionId: 's1',
      path: 'src/a.ts',
      line: 7,
      text: 'first note',
      retained: 'const x = 1',
    }])
    expect(fakes.emitters[0]!.fired).toBeGreaterThan(0)
    // Invalidation rebuilt the thread set wholesale: prior threads disposed, a fresh set built.
    expect(fakes.threads.length).toBeGreaterThan(threadsBefore)
    expect(fakes.threads[0]!.disposed).toBeGreaterThan(0)
  })

  it('an empty or cancelled prompt writes nothing', async () => {
    for (const input of [undefined, '   ']) {
      const fakes = makeFakes({ input })
      apply(fakes.ctx as never)
      await fakes.commands.get('do-harness.addLineNote')!()
      expect(fakes.adds).toEqual([])
    }
  })

  it('tracks the activate frame: a session switch disposes the rendered threads', async () => {
    const fakes = makeFakes()
    apply(fakes.ctx as never)
    await settle()
    expect(fakes.threads).toHaveLength(1)
    for (const listener of fakes.listeners.get('dsh/frame/ideBridge/activate') ?? []) {
      listener({ type: 'ideBridge/activate', sessionId: 'other' })
    }
    await settle()
    // The seeded note belongs to s1; 'other' renders nothing but the older thread got disposed.
    expect(fakes.threads).toHaveLength(1)
    expect(fakes.threads[0]!.disposed).toBeGreaterThan(0)
  })
})
