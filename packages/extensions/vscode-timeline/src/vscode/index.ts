/**
 * vscode-timeline — the twin's checkpoint Timeline.
 *
 * Three surfaces over one data source, `remote.checkpoint` slot timelines
 * (`kind: 'worktree'` slots: one committed write's before/after snapshots):
 *
 * 1. **The native Timeline view** (`window.registerTimelineProvider` on the
 *    `file` scheme): one item per worktree slot of the active file; an
 *    item's command opens `vscode.diff` between two `dsh-checkpoint://<digest>`
 *    documents.
 * 2. **The `dsh-checkpoint:` virtual document**: `checkpoint.blob(digest)`
 *    supplies the frozen text a diff (or any direct open) reads; the
 *    reserved digest `empty` maps to the empty document.
 * 3. **The Timeline tab** (`do-harness.timeline.open`): a styled webview
 *    editor panel with a real bar — buttons step the playhead, stop rows
 *    open diffs — replacing vscode's unstyleable CodeLens strip. The tab
 *    tails the active editor and re-reads stops on session activation.
 *
 * The active session rides the bridge: seeded from `ctx.twinCore.sessionId`
 * (the spawned bridge.json), superseded by every `ideBridge/activate`
 * downlink frame, replayed from the seat's backlog.
 *
 * @module @deepseek-ai/dsh-vscode-timeline
 */
import type { Context } from '@deepseek-ai/cordis'

// The seat resolves planes against cordis services by inject: the facade
// (`vscodeApi`), the gateway's `remote` service parent, and the two remote
// namespaces this plane calls.
export const inject: readonly string[] = ['vscodeApi', 'remote', 'remote.timeline', 'remote.checkpoint']

// ---------------------------------------------------------------------------
// Structural faces, kept local like `ui-vscode/rpc.ts`: planes are standalone
// bundles and spell only the slices they consume.
// ---------------------------------------------------------------------------

interface RemoteResult<T> { readonly ok: boolean; readonly value?: T }

interface CheckpointSlotLike {
  readonly slotId: string
  readonly kind: string
  readonly path: string
  readonly label: string
  readonly turn?: number
  readonly before?: string
  readonly after?: string
  readonly createdAt: number
  readonly detail?: { readonly toolName?: string; readonly purpose?: string }
}

interface CheckpointSlotTimelineLike {
  readonly path: string
  readonly slots: readonly CheckpointSlotLike[]
}

interface CheckpointRemoteFace {
  slots(sessionId: string, path?: string): Promise<RemoteResult<readonly CheckpointSlotTimelineLike[]>>
  blob(sessionId: string, digest: string): Promise<RemoteResult<string | null>>
}

interface WebviewLike {
  html: string
  onDidReceiveMessage(listener: (message: unknown) => void): unknown
}

interface WebviewPanelLike {
  readonly webview: WebviewLike
  title: string
  reveal(column?: number, preserveFocus?: boolean): void
  onDidDispose(listener: () => void): unknown
}

interface VscodeApiFace {
  workspace: {
    workspaceRoot(): string | null
    registerTextDocumentContentProvider(scheme: string, provider: unknown): unknown
  }
  window: {
    registerTimelineProvider(scheme: string, provider: unknown): unknown
    activeTextEditor(): { readonly path: string | null; readonly line: number; readonly lineText: string } | null
    onDidChangeActiveTextEditor(listener: (editor: unknown) => void): unknown
    createWebviewPanel(viewType: string, title: string, showOptions: number, options: unknown): WebviewPanelLike
  }
  languages: {
    registerInlayHintsProvider(selector: unknown, provider: unknown): unknown
  }
  commands: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): unknown
    executeCommand(id: string, ...args: unknown[]): Promise<unknown>
  }
  uri: {
    parse(value: string): unknown
  }
  runtime: {
    createEventEmitter(): { event: unknown; fire(payload?: unknown): void; dispose(): void }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    vscodeApi: VscodeApiFace
    remote: { checkpoint: CheckpointRemoteFace }
    twinCore: { readonly token: string; readonly sessionId?: string }
  }
}

// ---------------------------------------------------------------------------

/** `dsh-checkpoint:` documents carry their blob digest in the URI authority. */
export const CHECKPOINT_SCHEME = 'dsh-checkpoint'
/** The reserved authority naming the empty document (a slot with no prior text). */
export const EMPTY_DIGEST = 'empty'

/** The URI of one frozen document: `dsh-checkpoint://<digest>` (`empty` when the slot holds none). */
export function digestUri(digest: string | undefined): string {
  return `${CHECKPOINT_SCHEME}://${digest ?? EMPTY_DIGEST}`
}

/** The digest one `dsh-checkpoint:` URI names (`empty` when absent). */
export function digestOfUri(uri: unknown): string | null {
  if (typeof uri !== 'object' || uri === null) return null
  const authority = (uri as { authority?: unknown }).authority
  return typeof authority === 'string' && authority !== '' ? authority : null
}

/** Only `worktree` slots are timeline stops; notes and other kinds stay out. */
export function worktreeSlots(timelines: readonly CheckpointSlotTimelineLike[]): CheckpointSlotLike[] {
  const stops: CheckpointSlotLike[] = []
  for (const timeline of timelines) {
    for (const slot of timeline.slots) {
      if (slot.kind === 'worktree') stops.push(slot)
    }
  }
  stops.sort((a, b) => a.createdAt - b.createdAt)
  return stops
}

/** One Timeline item for one worktree slot; its command diffs the slot's before/after pair. */
function timelineItem(slot: CheckpointSlotLike, index: number, total: number, parseUri: (v: string) => unknown): Record<string, unknown> {
  const tool = slot.detail?.toolName ?? slot.label
  const turn = slot.turn === undefined ? '–' : String(slot.turn)
  return {
    id: slot.slotId,
    label: `stop ${index + 1}/${total} · ${tool} · turn ${turn}`,
    timestamp: slot.createdAt,
    ...(slot.detail?.purpose === undefined ? {} : { tooltip: slot.detail.purpose }),
    command: {
      id: 'vscode.diff',
      title: `View stop ${index + 1} of ${slot.path}`,
      arguments: [
        parseUri(digestUri(slot.before)),
        parseUri(digestUri(slot.after)),
        `${slot.path} — stop ${index + 1}/${total}`,
      ],
    },
  }
}

/** The plane state every registration closes over: session, caches, the playhead, the refresh wires. */
class TimelinePlane {
  sessionId: string | undefined
  /** The per-path stop cache; the step commands read it to size a playhead wrap. */
  readonly timelines = new Map<string, { at: number; slots: CheckpointSlotLike[] }>()
  private readonly playheads = new Map<string, number>()
  readonly timelineEmitter
  readonly hintEmitter

  constructor(
    private readonly remote: CheckpointRemoteFace,
    api: VscodeApiFace,
  ) {
    this.timelineEmitter = api.runtime.createEventEmitter()
    this.hintEmitter = api.runtime.createEventEmitter()
  }

  activate(sessionId: string | undefined): void {
    this.sessionId = sessionId
    this.timelines.clear()
    this.playheads.clear()
  }

  /** Refresh every vscode surface after the session or a playhead changed. */
  refresh(): void {
    this.timelineEmitter.fire()
    this.hintEmitter.fire()
  }

  /** The one file's worktree stops, fetched through a short TTL so vscode's query storms stay cheap. */
  async stops(path: string): Promise<CheckpointSlotLike[]> {
    const cached = this.timelines.get(path)
    if (cached !== undefined && Date.now() - cached.at < 2_000) return cached.slots
    const sessionId = this.sessionId
    if (sessionId === undefined) return []
    let stops: CheckpointSlotLike[] = []
    try {
      const result = await this.remote.slots(sessionId, path)
      if (result.ok && result.value !== undefined) stops = worktreeSlots(result.value)
      else console.warn('[dsh-timeline] slots not-ok', JSON.stringify(result).slice(0, 400))
    } catch (error) {
      console.error('[dsh-timeline] slots failed', error)
      stops = []
    }
    this.timelines.set(path, { at: Date.now(), slots: stops })
    return stops
  }

  playhead(path: string, count: number): number {
    const current = this.playheads.get(path) ?? count - 1
    return Math.min(Math.max(current, 0), Math.max(count - 1, 0))
  }

  step(path: string, count: number, delta: -1 | 1): void {
    if (count === 0) return
    this.playheads.set(path, (this.playhead(path, count) + delta + count) % count)
    this.refresh()
  }
}

/** The document's workspace-relative path, or null outside the opened workspace root. */
function relativePath(root: string | null, uri: unknown): string | null {
  const fsPath = typeof uri === 'object' && uri !== null ? (uri as { fsPath?: unknown }).fsPath : undefined
  if (typeof fsPath !== 'string' || root === null) return null
  const base = root.endsWith('/') ? root.slice(0, -1) : root
  return fsPath === base || !fsPath.startsWith(`${base}/`) ? null : fsPath.slice(base.length + 1)
}

/** Escape interpolations in the tab template — slot labels are user tool data. */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** The Timeline tab page: a styled bar plus the rows — styles ride vscode's theme variables. */
function timelineTabHtml(path: string, stops: readonly CheckpointSlotLike[], playhead: number): string {
  const current = stops.length === 0 ? undefined : stops[Math.min(playhead, stops.length - 1)]
  const head = current === undefined
    ? '<div class="bar"><span class="counter">No checkpoint stops for this file yet.</span></div>'
    : `<div class="bar">
        <button data-k="prev" aria-label="Previous stop">◀</button>
        <span class="counter">stop ${escapeHtml(`${playhead + 1}`)}${escapeHtml('/')}${escapeHtml(`${stops.length}`)} · ${escapeHtml(stopLabel(current))} · turn ${escapeHtml(current.turn === undefined ? '–' : `${current.turn}`)}</span>
        <button data-k="next" aria-label="Next stop">▶</button>
      </div>`
  const rows = stops.map((slot, index) => (
    `<button class="row${index === playhead ? ' playhead' : ''}" data-k="open" data-i="${index}">
      <span class="cell">${escapeHtml(`${index + 1}/${stops.length}`)}</span>
      <span class="cell tool">${escapeHtml(stopLabel(slot))}</span>
      <span class="cell">turn ${escapeHtml(slot.turn === undefined ? '–' : `${slot.turn}`)}</span>
    </button>`
  )).join('')
  return `<!DOCTYPE html>
<html>
<head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
body { font-family: var(--vscode-font-family); font-size: 13px; color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 14px; margin: 0; }
.bar { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 6px; background: var(--vscode-input-background); margin-bottom: 14px; }
.bar button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 0; border-radius: 4px; padding: 3px 12px; cursor: pointer; }
.bar .counter { font-weight: 600; }
.row { display: flex; gap: 14px; align-items: center; width: 100%; text-align: left; border: 0; background: transparent; color: inherit; padding: 6px 12px; cursor: pointer; border-radius: 4px; margin-bottom: 4px; font-size: 13px; font-family: inherit; }
.row:hover { background: var(--vscode-list-hoverBackground); }
.row.playhead { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.row .tool { flex: 1; font-weight: 600; }
.row .cell { white-space: nowrap; }
h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: var(--vscode-descriptionForeground); margin: 16px 0 6px 12px; }
.caption { color: var(--vscode-descriptionForeground); padding: 0 12px 8px; }
</style>
</head>
<body>
<h2>Checkpoints — ${escapeHtml(path)}</h2>
${head}
<h2>Stops</h2>
${rows === '' ? '<div class="caption">No checkpoint stops for this file yet.</div>' : rows}
<script>
const vscode = acquireVsCodeApi();
document.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.k === 'prev' || b.dataset.k === 'next') vscode.postMessage({ kind: b.dataset.k });
  else vscode.postMessage({ kind: 'open', index: Number(b.dataset.i) });
}));
</script>
</body>
</html>`
}

/** The slot's bar/row label: tool name when recorded, slot label otherwise. */
function stopLabel(slot: CheckpointSlotLike): string {
  return slot.detail?.toolName ?? slot.label
}

export function apply(ctx: Context): void {
  const api = ctx.vscodeApi
  const plane = new TimelinePlane(ctx.remote.checkpoint, api)
  plane.activate(ctx.twinCore.sessionId)
  console.info('[dsh-timeline] mounted, sessionId =', ctx.twinCore.sessionId)

  // Seat emits land in the shared Context event space via the same escape
  // hatch the bridge uses: `dsh/frame/ideBridge/activate` carries the tab's
  // focused session.
  const local = ctx as unknown as { on(event: string, listener: (arg: unknown) => void): unknown }
  local.on('dsh/frame/ideBridge/activate', (frame: unknown) => {
    if (typeof frame !== 'object' || frame === null) return
    const sessionId = (frame as { sessionId?: unknown }).sessionId
    if (typeof sessionId !== 'string') return
    plane.activate(sessionId)
    plane.refresh()
  })

  // (2) The virtual document: the frozen text of one checkpoint blob.
  api.workspace.registerTextDocumentContentProvider(CHECKPOINT_SCHEME, {
    provideTextDocumentContent: async (uri: unknown): Promise<string> => {
      const digest = digestOfUri(uri)
      if (digest === null || digest === EMPTY_DIGEST) return ''
      const sessionId = plane.sessionId
      if (sessionId === undefined) return ''
      try {
        const result = await ctx.remote.checkpoint.blob(sessionId, digest)
        return result.ok && result.value !== undefined && result.value !== null ? result.value : ''
      } catch {
        return ''
      }
    },
  })

  // (1) The native Timeline view over the active file's worktree stops.
  api.window.registerTimelineProvider('file', {
    id: 'dsh-checkpoints',
    label: 'Checkpoints',
    onDidChangeTimeline: plane.timelineEmitter.event,
    provideTimeline: async (uri: unknown): Promise<readonly Record<string, unknown>[]> => {

      const path = relativePath(api.workspace.workspaceRoot(), uri)
      if (path === null || plane.sessionId === undefined) return []
      const stops = await plane.stops(path)
      return stops.map((slot, index) => timelineItem(slot, index, stops.length, value => api.uri.parse(value)))
    },
  })

  // Stepping and diff-opening are plain command work: the tab and the
  // hidden commands ride the same two helpers (the path is the sole arg).
  const stepPath = (path: string, delta: -1 | 1): void => {
    const slots = plane.timelines.get(path)
    plane.step(path, slots?.slots.length ?? 0, delta)
  }
  const openStopAt = (path: string, index: number): void => {
    const slots = plane.timelines.get(path)
    if (slots === undefined || index >= slots.slots.length) return
    const stop = slots.slots[index] as CheckpointSlotLike
    const command = timelineItem(stop, index, slots.slots.length, value => api.uri.parse(value)).command as {
      id: string
      arguments: unknown[]
    }
    void api.commands.executeCommand(command.id, ...command.arguments)
  }
  const stepCommand = (delta: -1 | 1) => (arg: unknown): void => {
    const path = typeof arg === 'object' && arg !== null ? (arg as { path?: unknown }).path : undefined
    if (typeof path !== 'string') return
    stepPath(path, delta)
    plane.refresh()
    // The fork's editor bar re-reads its model on this ping (no-op when the
    // workbench predates the bar contribution).
    void api.commands.executeCommand('do-harness.timeline.barRefresh')
  }
  api.commands.registerCommand('do-harness.timeline.prev', stepCommand(-1))
  api.commands.registerCommand('do-harness.timeline.next', stepCommand(1))

  // The fork's editor bar query surface: this file's playhead as a bar model.
  api.commands.registerCommand('do-harness.timeline.describe', async (arg: unknown): Promise<unknown> => {
    if (typeof arg !== 'string' || plane.sessionId === undefined) return { ok: false }
    const stops = await plane.stops(arg)
    if (stops.length === 0) return { ok: false }
    const index = plane.playhead(arg, stops.length)
    const stop = stops[index] as CheckpointSlotLike
    const tool = stop.detail?.toolName ?? stop.label
    return {
      ok: true,
      path: arg,
      index,
      total: stops.length,
      tool,
      turn: stop.turn === undefined ? '–' : String(stop.turn),
    }
  })
  api.commands.registerCommand('do-harness.timeline.openStop', (arg: unknown): void => {
    const path = typeof arg === 'object' && arg !== null ? (arg as { path?: unknown }).path : undefined
    if (typeof path !== 'string') return
    const slots = plane.timelines.get(path)
    if (slots === undefined || slots.slots.length === 0) return
    openStopAt(path, plane.playhead(path, slots.slots.length))
  })

  // (3) The Timeline tab: a webview editor panel with a real UI — buttons,
  // a stops bar, rows — since vscode's text-surface alternatives (inlay,
  // CodeLens) cannot look like the harness UI. Messages ride postMessage;
  // the tab tails the active editor while open.
  let tab: WebviewPanelLike | undefined
  let tracked: string | undefined
  const render = async (): Promise<void> => {
    if (tab === undefined || plane.sessionId === undefined) return
    if (tracked === undefined) return
    const stops = await plane.stops(tracked)
    tab.webview.html = timelineTabHtml(tracked, stops, plane.playhead(tracked, stops.length))
  }
  const trackActive = (): void => {
    const editor = api.window.activeTextEditor()
    const path = editor === null || editor.path === null
      ? undefined
      : relativePath(api.workspace.workspaceRoot(), { fsPath: editor.path })
    if (path === tracked || path === undefined) return
    tracked = path ?? undefined
    if (tab !== undefined) tab.title = `Timeline — ${path}`
    void render()
  }
  api.window.onDidChangeActiveTextEditor(() => { trackActive() })

  // The fork's editor bar refreshes on editor-change events; bars mounted
  // before the planes composed would stay hidden forever without a late ping.
  setTimeout(() => { void api.commands.executeCommand('do-harness.timeline.barRefresh') }, 2000)
  api.commands.registerCommand('do-harness.timeline.open', async (): Promise<void> => {
    trackActive()
    if (tab === undefined) {
      tab = api.window.createWebviewPanel('dshCheckpointTimeline', `Timeline — ${tracked ?? '(no file)'}`, 2, {
        enableScripts: true,
        retainContextWhenHidden: true,
      })
      tab.webview.onDidReceiveMessage((message: unknown) => {
        if (tracked === undefined || typeof message !== 'object' || message === null) return
        const kind = (message as { kind?: unknown }).kind
        if (kind === 'prev' || kind === 'next') {
          stepPath(tracked, kind === 'prev' ? -1 : 1)
          plane.refresh()
          void render()
          void api.commands.executeCommand('do-harness.timeline.barRefresh')
          return
        }
        if (kind === 'open') {
          const index = (message as { index?: unknown }).index
          if (typeof index === 'number') openStopAt(tracked, index)
        }
      })
      tab.onDidDispose(() => { tab = undefined })
    } else {
      tab.reveal(2)
      const path = tracked
      if (path !== undefined) tab.title = `Timeline — ${path}`
    }
    await render()
  })
}
