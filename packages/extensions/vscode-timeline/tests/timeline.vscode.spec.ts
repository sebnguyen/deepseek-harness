/**
 * The vscode-timeline plane: worktree slots become Timeline items whose
 * commands open checkpoint diffs, the Timeline tab webview steers the
 * playhead with real buttons, and the session rides the activate frame —
 * all against a faked facade.
 */

import { describe, expect, it } from 'vitest'
import { apply, inject } from '../src/vscode/index.ts'

const SLOTS = [
  { slotId: 'w1', kind: 'worktree', path: 'src/a.ts', label: 'WriteFile', turn: 1, after: 'digest-1', createdAt: 1_726_000_000_000, detail: { toolName: 'WriteFile', purpose: 'initial write' } },
  { slotId: 'w2', kind: 'worktree', path: 'src/a.ts', label: 'EditFile', turn: 3, before: 'digest-1', after: 'digest-2', createdAt: 1_726_000_100_000, detail: { toolName: 'EditFile' } },
  { slotId: 'n1', kind: 'note', path: 'src/a.ts', label: 'remember', line: 2, createdAt: 1_726_000_200_000 },
] as const
const TIMELINES = [{ path: 'src/a.ts', slots: [...SLOTS] }] as const

interface PanelRecord {
  title: string
  viewType: string
  html: string
  listeners: Array<(message: unknown) => void>
  reveals: Array<number | undefined>
  disposeListeners: Array<() => void>
}

interface Fakes {
  ctx: Record<string, unknown>
  contentProviders: Array<{ scheme: string; provider: { provideTextDocumentContent(uri: unknown): unknown } }>
  timelineProviders: Array<{ scheme: string; provider: Record<string, unknown> }>
  panels: PanelRecord[]
  editorListeners: Array<(editor: unknown) => void>
  commands: Map<string, (...args: unknown[]) => unknown>
  executed: Array<{ id: string; args: unknown[] }>
  listeners: Map<string, Array<(arg: unknown) => void>>
  emitters: Array<{ fired: number }>
  blobs: Map<string, string>
  /** Open diff tabs the fake workbench reports through tabGroups. */
  tabs: Array<{ input: { original: unknown; modified: unknown } }>
  closedTabs: Array<unknown>
}

function makeFakes(): Fakes {
  const fakes: Fakes = {
    ctx: {},
    contentProviders: [],
    timelineProviders: [],
    panels: [],
    editorListeners: [],
    commands: new Map(),
    executed: [],
    listeners: new Map(),
    emitters: [],
    blobs: new Map([['digest-1', 'BEFORE'], ['digest-2', 'AFTER']]),
    tabs: [],
    closedTabs: [],
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
      activeTextEditor: () => ({ path: '/repo/src/a.ts', line: 1, lineText: 'x' }),
      onDidChangeActiveTextEditor: (listener: (editor: unknown) => void) => {
        fakes.editorListeners.push(listener)
        return { dispose: () => undefined }
      },
      createWebviewPanel: (viewType: string, title: string, _column: number, _options: unknown) => {
        const panel: PanelRecord = { title, viewType, html: '', listeners: [], reveals: [], disposeListeners: [] }
        fakes.panels.push(panel)
        return {
          set title(value: string) { panel.title = value },
          get title() { return panel.title },
          webview: {
            get html() { return panel.html },
            set html(value: string) { panel.html = value },
            onDidReceiveMessage: (listener: (message: unknown) => void) => {
              panel.listeners.push(listener)
              return { dispose: () => undefined }
            },
          },
          reveal: (column?: number) => { panel.reveals.push(column) },
          onDidDispose: (listener: () => void) => {
            panel.disposeListeners.push(listener)
            return { dispose: () => undefined }
          },
        }
      },
      tabGroups: {
        // One group, mirroring the diff tabs the workbench would hold open.
        get all() { return [{ tabs: fakes.tabs }] },
        close(tab: unknown) {
          const tracked = tab as { input: { original: unknown; modified: unknown } }
          const index = fakes.tabs.indexOf(tracked)
          if (index >= 0) fakes.tabs.splice(index, 1)
          fakes.closedTabs.push(tab)
          return Promise.resolve(index >= 0)
        },
      },
    },
    languages: {},
    commands: {
      registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
        fakes.commands.set(id, handler)
        return { dispose: () => undefined }
      },
      executeCommand: (id: string, ...args: unknown[]) => {
        fakes.executed.push({ id, args })
        if (id === 'vscode.diff') {
          // The workbench opens (or focuses) one diff tab per original/modified pair.
          const [original, modified] = args as [unknown, unknown, string]
          const existing = fakes.tabs.find(tab => tab.input.original === original && tab.input.modified === modified)
          if (existing === undefined) fakes.tabs.push({ input: { original, modified } })
        }
        return Promise.resolve(undefined)
      },
    },
    uri: { parse: (value: string) => ({ parsed: value }) },
    runtime: { createEventEmitter: createEmitter },
  }
  fakes.ctx = {
    vscodeApi: api,
    remote: {
      checkpoint: {
        slots: async (sessionId: string, path?: string) => (
          sessionId === 's1'
            ? { ok: true, value: path === undefined ? TIMELINES : TIMELINES.filter(t => t.path === path) }
            : { ok: true, value: [] }
        ),
        blob: async (sessionId: string, digest: string) => ({
          ok: true,
          value: sessionId === 's1' ? (fakes.blobs.get(digest) ?? null) : null,
        }),
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

/** Wait out the plane's async renders (promise chaining, no clocks). */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise(resolve => setTimeout(resolve, 0))
}

describe('vscode-timeline plane', () => {
  it('declares its seat services by inject list', () => {
    expect(inject).toEqual(['vscodeApi', 'remote', 'remote.timeline', 'remote.checkpoint'])
  })

  it('registers the content and timeline providers plus its five commands', () => {
    const fakes = makeFakes()
    apply(fakes.ctx as never)
    expect(fakes.contentProviders.map(registration => registration.scheme)).toEqual(['dsh-checkpoint'])
    expect(fakes.timelineProviders.map(registration => registration.scheme)).toEqual(['file'])
    expect([...fakes.commands.keys()]).toEqual([
      'do-harness.timeline.prev',
      'do-harness.timeline.next',
      'do-harness.timeline.describe',
      'do-harness.timeline.openStop',
      'do-harness.timeline.open',
    ])
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

  it('serves the bar model through describe, and steps refresh the bar channel', async () => {
    const fakes = makeFakes()
    apply(fakes.ctx as never)
    const describe = fakes.commands.get('do-harness.timeline.describe')! as (arg: unknown) => Promise<Record<string, unknown>>
    const model = await describe('src/a.ts')
    expect(model).toMatchObject({ ok: true, index: 1, total: 2, tool: 'EditFile', turn: '3' })
    await expect(describe('elsewhere.ts')).resolves.toMatchObject({ ok: false })
    fakes.commands.get('do-harness.timeline.prev')!({ path: 'src/a.ts' })
    await settle()
    expect((await describe('src/a.ts'))).toMatchObject({ ok: true, index: 0, tool: 'WriteFile', turn: '1' })
    const executed = fakes.executed.find(entry => entry.id === 'do-harness.timeline.barRefresh')
    expect(executed).toBeDefined()
  })

  it('opens the Timeline tab on the active file and steers the playhead from webview buttons', async () => {
    const fakes = makeFakes()
    apply(fakes.ctx as never)
    await fakes.commands.get('do-harness.timeline.open')!()
    await settle()
    expect(fakes.panels).toHaveLength(1)
    const panel = fakes.panels[0]!
    expect(panel.viewType).toBe('dshCheckpointTimeline')
    expect(panel.title).toBe('Timeline — src/a.ts')
    expect(panel.html).toContain('Checkpoints — src/a.ts')
    expect(panel.html).toContain('stop 2/2 · EditFile · turn 3')

    for (const listener of panel.listeners) listener({ kind: 'prev' })
    await settle()
    expect(panel.html).toContain('stop 1/2 · WriteFile · turn 1')

    for (const listener of panel.listeners) listener({ kind: 'open', index: 0 })
    await settle()
    const executed = fakes.executed.find(entry => entry.id === 'vscode.diff')!
    expect(executed.id).toBe('vscode.diff')
    expect((executed.args[0] as { parsed: string }).parsed).toBe('dsh-checkpoint://empty')
    expect((executed.args[1] as { parsed: string }).parsed).toBe('dsh-checkpoint://digest-1')

    // A second open reveals the existing tab instead of spawning a new one.
    await fakes.commands.get('do-harness.timeline.open')!()
    await settle()
    expect(fakes.panels).toHaveLength(1)
    expect(panel.reveals).toHaveLength(1)
  })

  it('steps preview the playhead stop in one swapped diff tab', async () => {
    const fakes = makeFakes()
    apply(fakes.ctx as never)
    // Prime the stop cache the way the bar's describe does.
    await (fakes.commands.get('do-harness.timeline.describe')!)( 'src/a.ts' )
    // Playhead defaults to the newest stop (w2); stepping back must open
    // the first preview diff for the older stop (w1).
    fakes.commands.get('do-harness.timeline.prev')!({ path: 'src/a.ts' })
    await settle()
    const diffs1 = fakes.executed.filter(entry => entry.id === 'vscode.diff')
    expect(diffs1).toHaveLength(1)
    expect((diffs1[0]!.args[1] as { parsed: string }).parsed).toBe('dsh-checkpoint://digest-1')
    expect(fakes.tabs).toHaveLength(1)
    // Stepping forward swaps: exactly one tab close follows one new diff.
    fakes.commands.get('do-harness.timeline.next')!({ path: 'src/a.ts' })
    await settle()
    const diffs2 = fakes.executed.filter(entry => entry.id === 'vscode.diff')
    expect(diffs2).toHaveLength(2)
    expect((diffs2[1]!.args[0] as { parsed: string }).parsed).toBe('dsh-checkpoint://digest-1')
    expect((diffs2[1]!.args[1] as { parsed: string }).parsed).toBe('dsh-checkpoint://digest-2')
    expect(fakes.closedTabs).toHaveLength(1)
    expect(fakes.tabs).toHaveLength(1)
    const tracked = fakes.tabs[0]!.input as { modified: { parsed: string } }
    expect(tracked.modified.parsed).toBe('dsh-checkpoint://digest-2')
  })

  it('wraps without stacking duplicates and never leaves two preview tabs', async () => {
    const fakes = makeFakes()
    apply(fakes.ctx as never)
    await (fakes.commands.get('do-harness.timeline.describe')!)( 'src/a.ts' )
    // Two backward steps walk w2 → w1 → (wrap) w2: two opens, one swap,
    // and the tab list ends with exactly one preview tab.
    fakes.commands.get('do-harness.timeline.prev')!({ path: 'src/a.ts' })
    await settle()
    fakes.commands.get('do-harness.timeline.prev')!({ path: 'src/a.ts' })
    await settle()
    expect(fakes.executed.filter(entry => entry.id === 'vscode.diff')).toHaveLength(2)
    expect(fakes.closedTabs).toHaveLength(1)
    expect(fakes.tabs).toHaveLength(1)
    // Stepping again opens the next pair; everything stays single-tab.
    fakes.commands.get('do-harness.timeline.prev')!({ path: 'src/a.ts' })
    await settle()
    expect(fakes.executed.filter(entry => entry.id === 'vscode.diff')).toHaveLength(3)
    expect(fakes.closedTabs).toHaveLength(2)
    expect(fakes.tabs).toHaveLength(1)
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

  it('drops the preview tracker on session switch so stale diffs are never closed', async () => {
    const fakes = makeFakes()
    apply(fakes.ctx as never)
    await (fakes.commands.get('do-harness.timeline.describe')!)( 'src/a.ts' )
    fakes.commands.get('do-harness.timeline.prev')!({ path: 'src/a.ts' })
    await settle()
    expect(fakes.tabs).toHaveLength(1)
    // Switching sessions must not let a later step swap a tab that belongs
    // to the old session's preview pair.
    for (const listener of fakes.listeners.get('dsh/frame/ideBridge/activate') ?? []) {
      listener({ type: 'ideBridge/activate', sessionId: 'other' })
    }
    fakes.commands.get('do-harness.timeline.next')!({ path: 'other.ts' })
    await settle()
    expect(fakes.closedTabs).toHaveLength(0)
  })
})
