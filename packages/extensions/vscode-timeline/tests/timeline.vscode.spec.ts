/**
 * The timeline plane: the native Timeline over worktree slots, the
 * `dsh-checkpoint:` virtual document, and the line-0 scrubber — all against
 * faked facade/remotes.
 */

import { describe, expect, it } from 'vitest'
import { apply, inject } from '../src/vscode/index.ts'

const WORKTREE_1 = {
  slotId: 'w1',
  kind: 'worktree',
  path: 'src/a.ts',
  label: 'WriteFile',
  turn: 1,
  after: 'digest-1',
  createdAt: 1_726_000_000_000,
  detail: { toolName: 'WriteFile', purpose: 'create the module' },
}
const WORKTREE_2 = {
  slotId: 'w2',
  kind: 'worktree',
  path: 'src/a.ts',
  label: 'EditFile',
  turn: 3,
  before: 'digest-1',
  after: 'digest-2',
  createdAt: 1_726_000_060_000,
  detail: { toolName: 'EditFile' },
}
const NOTE_SLOT = { slotId: 'n1', kind: 'note', path: 'src/a.ts', label: 'remember', line: 2, createdAt: 1 }

interface Fakes {
  ctx: Record<string, unknown>
  contentProviders: Array<{ scheme: string; provider: { provideTextDocumentContent(uri: unknown): unknown } }>
  timelineProviders: Array<{ scheme: string; provider: Record<string, unknown> }>
  inlayProviders: Array<{ selector: unknown; provider: Record<string, unknown> }>
  commands: Map<string, (...args: unknown[]) => unknown>
  listeners: Map<string, Array<(arg: unknown) => void>>
  emitters: Array<{ fired: number }
  >
  blobs: Map<string, string>
}

function makeFakes(): Fakes {
  const fakes: Fakes = {
    ctx: {},
    contentProviders: [],
    timelineProviders: [],
    inlayProviders: [],
    commands: new Map(),
    listeners: new Map(),
    emitters: [],
    blobs: new Map([['digest-1', 'BEFORE'], ['digest-2', 'AFTER']]),
  }
  const createEmitter = () => {
    const emitter = { fired: 0, event: { tag: 'event' }, fire() { emitter.fired += 1 }, dispose() {} }
    fakes.emitters.push(emitter)
    return emitter
  }
  const api = {
    workspace: {
      workspaceRoot: () => '/repo',
      registerTextDocumentContentProvider: (scheme: string, provider: { provideTextDocumentContent(uri: unknown): unknown }) => {
        fakes.contentProviders.push({ scheme, provider })
        return { dispose: () => undefined }
      },
    },
    window: {
      registerTimelineProvider: (scheme: string, provider: Record<string, unknown>) => {
        fakes.timelineProviders.push({ scheme, provider })
        return { dispose: () => undefined }
      },
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
    uri: { parse: (value: string) => ({ parsed: value }) },
    runtime: { createEventEmitter: createEmitter },
  }
  const remote = {
    checkpoint: {
      slots: async (sessionId: string) => {
        if (sessionId !== 's1') return { ok: false, error: new Error('no session') }
        return { ok: true, value: [{ path: 'src/a.ts', slots: [WORKTREE_1, WORKTREE_2, NOTE_SLOT] }] }
      },
      blob: async (sessionId: string, digest: string) => {
        if (sessionId !== 's1') return { ok: false, error: new Error('no session') }
        return { ok: true, value: fakes.blobs.get(digest) ?? null }
      },
    },
    timeline: {},
  }
  fakes.ctx = {
    vscodeApi: api,
    remote,
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
  lineCount: 12,
  lineAt: (line: number) => ({ text: `line ${line}` }),
}

describe('vscode-timeline plane', () => {
  it('declares its seat services by inject list', () => {
    expect(inject).toEqual(['vscodeApi', 'remote.timeline', 'remote.checkpoint'])
  })

  it('registers the content, timeline, and inlay providers plus its commands', () => {
    const fakes = makeFakes()
    apply(fakes.ctx as never)
    expect(fakes.contentProviders.map(registration => registration.scheme)).toEqual(['dsh-checkpoint'])
    expect(fakes.timelineProviders.map(registration => registration.scheme)).toEqual(['file'])
    expect(fakes.inlayProviders).toHaveLength(1)
    expect([...fakes.commands.keys()]).toEqual(['do-harness.timeline.prev', 'do-harness.timeline.next'])
  })

  it('serves frozen blob text for digests and the empty document for the empty marker', async () => {
    const fakes = makeFakes()
    apply(fakes.ctx as never)
    const provider = fakes.contentProviders[0]!.provider
    await expect(provider.provideTextDocumentContent({ authority: 'digest-2' })).resolves.toBe('AFTER')
    await expect(provider.provideTextDocumentContent({ authority: 'empty' })).resolves.toBe('')
    await expect(provider.provideTextDocumentContent({ uri: true })).resolves.toBe('')
  })

  it('maps worktree slots to timeline items whose commands open checkpoint diffs', async () => {
    const fakes = makeFakes()
    apply(fakes.ctx as never)
    const provider = fakes.timelineProviders[0]!.provider
    const provide = provider.provideTimeline as (uri: unknown) => Promise<Array<Record<string, unknown>>>
    const items = await provide({ fsPath: '/repo/src/a.ts' })
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ id: 'w1', label: 'stop 1/2 · WriteFile · turn 1', timestamp: 1_726_000_000_000 })
    const command = items[0]!.command as { id: string; arguments: unknown[] }
    expect(command.id).toBe('vscode.diff')
    expect((command.arguments[0] as { parsed: string }).parsed).toBe('dsh-checkpoint://empty')
    expect((command.arguments[1] as { parsed: string }).parsed).toBe('dsh-checkpoint://digest-1')
    // A file outside the workspace root produces no Timeline.
    await expect(provide({ fsPath: '/elsewhere/x.ts' })).resolves.toEqual([])
  })

  it('pins the line-0 scrubber to the latest stop and steps it through the prev/next commands', async () => {
    const fakes = makeFakes()
    apply(fakes.ctx as never)
    const inlay = fakes.inlayProviders[0]!.provider
    const provide = inlay.provideInlayHints as (doc: unknown) => Promise<Array<Record<string, unknown>>>
    const first = await provide(DOCUMENT)
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ position: { line: 0, character: 0 }, paddingLeft: true })
    const label = first[0]!.label as Array<{ value: string; command?: { id: string } }>
    expect(label.map(part => part.value)).toEqual(['◀', ' stop 2/2 · EditFile · turn 3 ', '▶'])
    expect(label[0]).toMatchObject({ command: { id: 'do-harness.timeline.prev' } })
    expect(label[2]).toMatchObject({ command: { id: 'do-harness.timeline.next' } })

    const firesBefore = fakes.emitters.reduce((sum, emitter) => sum + emitter.fired, 0)
    fakes.commands.get('do-harness.timeline.prev')!({ path: 'src/a.ts' })
    expect(fakes.emitters.reduce((sum, emitter) => sum + emitter.fired, 0)).toBeGreaterThan(firesBefore)
    const stepped = await provide(DOCUMENT)
    const steppedLabel = stepped[0]!.label as Array<{ value: string }>
    expect(steppedLabel[1]!.value).toBe(' stop 1/2 · WriteFile · turn 1 ')
  })

  it('tracks the activate frame: session switch resets the caches and refreshes', async () => {
    const fakes = makeFakes()
    apply(fakes.ctx as never)
    const provider = fakes.timelineProviders[0]!.provider
    const provide = provider.provideTimeline as (uri: unknown) => Promise<unknown[]>
    expect(await provide({ fsPath: '/repo/src/a.ts' })).toHaveLength(2)
    for (const listener of fakes.listeners.get('dsh/frame/ideBridge/activate') ?? []) {
      listener({ type: 'ideBridge/activate', sessionId: 'other' })
    }
    expect(await provide({ fsPath: '/repo/src/a.ts' })).toEqual([])
  })
})
