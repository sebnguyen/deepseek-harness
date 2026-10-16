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
 * 3. **The line-0 scrubber** (an inlay hint): `◀ stop 3/12 · tool · turn 3 ▶`
 *    on noted files; prev/next ride registered commands.
 *
 * The active session rides the bridge: seeded from `ctx.twinCore.sessionId`
 * (the spawned bridge.json), superseded by every `ideBridge/activate`
 * downlink frame, replayed from the seat's backlog.
 *
 * @module @deepseek-ai/dsh-vscode-timeline
 */
import type { Context } from '@deepseek-ai/cordis'

export const inject: readonly string[] = ['vscodeApi', 'remote.timeline', 'remote.checkpoint']

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

interface VscodeApiFace {
  workspace: {
    workspaceRoot(): string | null
    registerTextDocumentContentProvider(scheme: string, provider: unknown): unknown
  }
  window: {
    registerTimelineProvider(scheme: string, provider: unknown): unknown
  }
  languages: {
    registerInlayHintsProvider(selector: unknown, provider: unknown): unknown
  }
  commands: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): unknown
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

  // The scrubber's stepping is plain command work: registered commands take
  // the file's relative path as their sole argument (label-part command args).
  const stepCommand = (delta: -1 | 1) => (arg: unknown): void => {
    const path = typeof arg === 'object' && arg !== null ? (arg as { path?: unknown }).path : undefined
    if (typeof path !== 'string') return
    const slots = plane.timelines.get(path)
    plane.step(path, slots?.slots.length ?? 0, delta)
    plane.refresh()
  }
  api.commands.registerCommand('do-harness.timeline.prev', stepCommand(-1))
  api.commands.registerCommand('do-harness.timeline.next', stepCommand(1))

  // (3) The line-0 scrubber hint on files that carry stops.
  api.languages.registerInlayHintsProvider([{ scheme: 'file' }], {
    onDidChangeInlayHints: plane.hintEmitter.event,
    provideInlayHints: async (document: unknown): Promise<readonly Record<string, unknown>[]> => {
      const path = relativePath(api.workspace.workspaceRoot(), (document as { uri?: unknown }).uri)
      if (path === null || plane.sessionId === undefined) return []
      const stops = await plane.stops(path)
      if (stops.length === 0) return []
      const index = plane.playhead(path, stops.length)
      const stop = stops[index] as CheckpointSlotLike
      const tool = stop.detail?.toolName ?? stop.label
      const turn = stop.turn === undefined ? '–' : String(stop.turn)
      const prev = (delta: -1 | 1): Record<string, unknown> => ({
        id: delta === -1 ? 'do-harness.timeline.prev' : 'do-harness.timeline.next',
        title: delta === -1 ? 'Previous checkpoint stop' : 'Next checkpoint stop',
        arguments: [{ path }],
      })
      return [{
        position: { line: 0, character: 0 },
        label: [
          { value: '◀', command: prev(-1) },
          { value: ` stop ${index + 1}/${stops.length} · ${tool} · turn ${turn} ` },
          { value: '▶', command: prev(1) },
        ],
        paddingLeft: true,
        paddingRight: true,
      }]
    },
  })
}
