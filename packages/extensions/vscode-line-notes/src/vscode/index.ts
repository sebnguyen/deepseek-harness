/**
 * vscode-line-notes — the twin's line-anchored notes.
 *
 * Read: the notes the session's slot register carries (projected host-side
 * by `lineNotes.state` — the same note model the web gutter and the `@`
 * palette read) render as inlay hints `✎ <note>` pinned at the end of each
 * noted line.
 *
 * Write: the palette-contributed command `do-harness.addLineNote` freezes
 * the caret line and its text through `lineNotes.add`, which appends one
 * `kind: 'note'` checkpoint slot — the exact payload the web gutter writes.
 *
 * The active session rides the bridge, seeded from `ctx.twinCore.sessionId`
 * and superseded by `ideBridge/activate` frames.
 *
 * @module @deepseek-ai/dsh-vscode-line-notes
 */
import type { Context } from '@deepseek-ai/cordis'

export const inject: readonly string[] = ['vscodeApi', 'remote.lineNotes']

// ---------------------------------------------------------------------------
// Structural faces, marked out locally like `ui-vscode/rpc.ts`: plane bundles
// declare only the slices they consume.
// ---------------------------------------------------------------------------

interface RemoteResult<T> { readonly ok: boolean; readonly value?: T; readonly error?: unknown }

interface LineNoteLike {
  readonly id: string
  readonly path: string
  readonly line: number
  readonly text: string
}

interface LineNotesRemoteFace {
  state(sessionId: string): Promise<RemoteResult<{ readonly notes: readonly LineNoteLike[] }>>
  add(sessionId: string, note: {
    readonly path: string
    readonly line: number
    readonly text: string
    readonly retained: string
  }): Promise<RemoteResult<LineNoteLike>>
}

interface VscodeApiFace {
  workspace: {
    workspaceRoot(): string | null
  }
  window: {
    activeTextEditor(): { readonly path: string | null; readonly line: number; readonly lineText: string } | null
    showInputBox(options?: { prompt?: string; placeHolder?: string }): Promise<string | undefined>
  }
  languages: {
    registerInlayHintsProvider(selector: unknown, provider: unknown): unknown
  }
  commands: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): unknown
  }
  runtime: {
    createEventEmitter(): { event: unknown; fire(payload?: unknown): void; dispose(): void }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    vscodeApi: VscodeApiFace
    remote: { lineNotes: LineNotesRemoteFace }
    twinCore: { readonly token: string; readonly sessionId?: string }
  }
}

const NOTE_LABEL_MAX = 80

/** The hint text for one note: `✎ <text>`, truncated to keep lines readable. */
export function noteLabel(note: LineNoteLike): string {
  const text = note.text
  const trimmed = text.length > NOTE_LABEL_MAX ? `${text.slice(0, NOTE_LABEL_MAX - 1)}…` : text
  return `✎ ${trimmed}`
}

/** The plane state every registration closes over: session, the note cache, the refresh wire. */
class LineNotesPlane {
  sessionId: string | undefined
  private cache: { at: number; notes: LineNoteLike[] } | undefined
  readonly emitter

  constructor(
    private readonly remote: LineNotesRemoteFace,
    api: VscodeApiFace,
  ) {
    this.emitter = api.runtime.createEventEmitter()
  }

  activate(sessionId: string | undefined): void {
    this.sessionId = sessionId
    this.cache = undefined
  }

  invalidate(): void {
    this.cache = undefined
    this.emitter.fire()
  }

  /** All the session's notes, fetched through a short TTL so vscode's query storms stay cheap. */
  async notes(): Promise<LineNoteLike[]> {
    if (this.cache !== undefined && Date.now() - this.cache.at < 2_000) return this.cache.notes
    const sessionId = this.sessionId
    if (sessionId === undefined) return []
    let notes: LineNoteLike[] = []
    try {
      const result = await this.remote.state(sessionId)
      if (result.ok && result.value !== undefined) notes = [...result.value.notes]
    } catch {
      notes = []
    }
    this.cache = { at: Date.now(), notes }
    return notes
  }
}

/** The document's workspace-relative path, or null outside the workspace root. */
function relativePath(root: string | null, uri: unknown): string | null {
  const fsPath = typeof uri === 'object' && uri !== null ? (uri as { fsPath?: unknown }).fsPath : undefined
  if (typeof fsPath !== 'string' || root === null) return null
  const base = root.endsWith('/') ? root.slice(0, -1) : root
  return fsPath === base || !fsPath.startsWith(`${base}/`) ? null : fsPath.slice(base.length + 1)
}

export function apply(ctx: Context): void {
  const api = ctx.vscodeApi
  const plane = new LineNotesPlane(ctx.remote.lineNotes, api)
  plane.activate(ctx.twinCore.sessionId)

  const local = ctx as unknown as { on(event: string, listener: (arg: unknown) => void): unknown }
  local.on('dsh/frame/ideBridge/activate', (frame: unknown) => {
    if (typeof frame !== 'object' || frame === null) return
    const sessionId = (frame as { sessionId?: unknown }).sessionId
    if (typeof sessionId !== 'string') return
    plane.activate(sessionId)
    plane.invalidate()
  })
  // Forward-looking refresh: a future note projection publisher invalidates
  // the cache the same way (the frame simply has not shipped yet).
  local.on('dsh/frame/line-notes', () => { plane.invalidate() })

  api.languages.registerInlayHintsProvider([{ scheme: 'file' }], {
    onDidChangeInlayHints: plane.emitter.event,
    provideInlayHints: async (document: unknown): Promise<readonly Record<string, unknown>[]> => {
      const path = relativePath(api.workspace.workspaceRoot(), (document as { uri?: unknown }).uri)
      if (path === null || plane.sessionId === undefined) return []
      const notes = await plane.notes()
      const doc = document as { lineCount?: number; lineAt(line: number): { text: string } }
      const lines = typeof doc.lineCount === 'number' ? doc.lineCount : Number.POSITIVE_INFINITY
      const hints: Record<string, unknown>[] = []
      for (const note of notes) {
        if (note.path !== path || note.line < 1 || note.line > lines) continue
        const text = doc.lineAt(note.line - 1).text
        hints.push({
          position: { line: note.line - 1, character: text.length },
          label: noteLabel(note),
          tooltip: note.text,
          paddingLeft: true,
        })
      }
      return hints
    },
  })

  // The add-note gesture, contributed to the palette by the staged bridge
  // extension manifest: freeze the caret line's text as the note slot's
  // retained snapshot, the same payload the web gutter sends.
  api.commands.registerCommand('do-harness.addLineNote', async (): Promise<void> => {
    const editor = api.window.activeTextEditor()
    const sessionId = plane.sessionId
    if (editor === null || editor.path === null || sessionId === undefined) return
    const path = relativePath(api.workspace.workspaceRoot(), { fsPath: editor.path })
    if (path === null) return
    const text = await api.window.showInputBox({
      prompt: `Note for ${path}:${editor.line}`,
      placeHolder: 'Pin a comment to this line',
    })
    if (text === undefined || text.trim() === '') return
    await ctx.remote.lineNotes.add(sessionId, {
      path,
      line: editor.line,
      text: text.trim(),
      retained: editor.lineText,
    })
    plane.invalidate()
  })
}
