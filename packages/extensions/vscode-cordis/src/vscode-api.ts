/**
 * vscodeApi adapter: binds the ambient vscode module — supplied by the
 * extension host at activation — as the `ctx.vscodeApi` facade on the seat
 * Context. Planes never import `vscode` themselves; they consume only the
 * facade, and the facade instance freezes exactly once per seat process.
 * The bundle keeps the import external (`neverBundle`), so nothing here
 * evaluates against a real vscode module during tests or host-side builds.
 */
import type { Context } from '@deepseek-ai/cordis'
import * as vscode from 'vscode'

/** A virtual-text-document content provider (vscode.workspace.registerTextDocumentContentProvider). */
export interface VscodeContentProviderLike {
  provideTextDocumentContent(uri: unknown): string | undefined | PromiseLike<string | undefined>
}

/** A timeline provider; the facade hands it vscode's calls verbatim (vscode.window.registerTimelineProvider). */
export interface VscodeTimelineProviderLike {
  readonly id?: string
  readonly label?: string
  provideTimeline(uri: unknown, options: unknown, token: unknown): PromiseLike<readonly VscodeTimelineItemLike[]>
}

/**
 * One Timeline item the plane returns: plain data only. `command.arguments`
 * may carry URIs already made with `vscodeApi.uri.parse`; the facade passes
 * the object through to vscode's timeline conversion unchanged.
 */
export interface VscodeTimelineItemLike {
  readonly id?: string
  readonly label: string
  readonly timestamp?: number
  readonly tooltip?: string
  readonly command?: {
    readonly id: string
    readonly title: string
    readonly arguments?: readonly unknown[]
  }
}

/** The active editor's note-relevant position snapshot, in vscode's own conventions. */
export interface ActiveTextEditorSnapshot {
  /** The editor document's on-disk path, or null for untitled/virtual docs. */
  readonly path: string | null
  /** The caret's 1-based line number. */
  readonly line: number
  /** The caret line's full text (for freezing into a note slot). */
  readonly lineText: string
}

/** A vscode-style event emitter the plane attaches as `onDidChange*` on its providers. */
export interface EventEmitterLike {
  readonly event: unknown
  fire(payload?: unknown): void
  dispose(): void
}

export interface VscodeApiFacade {
  readonly workspace: {
    readonly workspaceRoot: () => string | null
    readonly onDidSaveTextDocument: (listener: (doc: TextDocumentLike) => void) => unknown
    readonly onDidChangeActiveTextEditor: (listener: (editor: TextEditorLike | undefined) => void) => unknown
    readonly registerTextDocumentContentProvider: (scheme: string, provider: VscodeContentProviderLike) => unknown
  }
  readonly window: {
    readonly showTextDocument: (path: string, options?: { line?: number }) => Promise<unknown>
    readonly activeTextEditor: () => ActiveTextEditorSnapshot | null
    readonly showInputBox: (options?: { prompt?: string; placeHolder?: string }) => Promise<string | undefined>
    readonly registerTimelineProvider: (scheme: string, provider: VscodeTimelineProviderLike) => unknown
  }
  readonly languages: {
    readonly onDidChangeDiagnostics: (listener: (event: DiagnosticChangeLike) => void) => unknown
    readonly getDiagnostics: (uri: UriLike) => readonly DiagnosticLike[]
    readonly registerInlayHintsProvider: (selector: unknown, provider: unknown) => unknown
  }
  readonly commands: {
    readonly registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => unknown
    readonly executeCommand: (id: string, ...args: unknown[]) => Promise<unknown>
  }
  readonly uri: {
    readonly parse: (value: string) => unknown
    readonly file: (path: string) => unknown
  }
  readonly runtime: {
    readonly createEventEmitter: () => EventEmitterLike
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context { vscodeApi: VscodeApiFacade }
}

type TextDocumentLike = { uri?: { fsPath?: string } }
type TextEditorLike = { document?: TextDocumentLike }
/** A uri in the facade's own minimal shape — planes never import `vscode`. */
export interface UriLike { fsPath?: string }
/** A diagnostics-change event (see vscode.languages.onDidChangeDiagnostics). */
export interface DiagnosticChangeLike { uris?: readonly UriLike[] }
/** A diagnostic in the facade's minimal shape; `severity` mirrors the vscode enum (0 = Error, 1 = Warning). */
export interface DiagnosticLike { severity?: number }

/** Snapshot the ambient active editor, or null when no file editor is focused. */
function activeTextEditorSnapshot(): ActiveTextEditorSnapshot | null {
  const editor = vscode.window.activeTextEditor
  if (editor === undefined) return null
  const document = editor.document as {
    uri?: { scheme?: string; fsPath?: string }
    lineAt(line: number): { text: string }
  }
  const scheme = document.uri?.scheme
  const path = scheme === 'file' ? (document.uri?.fsPath ?? null) : null
  const line = editor.selection.active.line
  return { path, line: line + 1, lineText: document.lineAt(line).text }
}

let cached: VscodeApiFacade | undefined

export function fetchVscodeApiFacade(): VscodeApiFacade {
  if (cached !== undefined) return cached
  const facade = Object.freeze({
    workspace: {
      workspaceRoot: () => {
        const folders = vscode.workspace.workspaceFolders
        const first = folders === undefined || folders.length === 0 ? undefined : folders[0]
        return first === undefined ? null : first.uri.fsPath
      },
      onDidSaveTextDocument: (l: (doc: TextDocumentLike) => void) => vscode.workspace.onDidSaveTextDocument(l),
      onDidChangeActiveTextEditor: (l: (editor: TextEditorLike | undefined) => void) => vscode.window.onDidChangeActiveTextEditor(l),
      registerTextDocumentContentProvider: (
        scheme: string,
        provider: VscodeContentProviderLike,
      ) => (
        vscode.workspace.registerTextDocumentContentProvider(scheme, provider as never)
      ),
    },
    window: {
      showTextDocument: async (path: string, opts?: { line?: number }) => {
        if (opts?.line === undefined) return vscode.window.showTextDocument(vscode.Uri.file(path))
        const pos = new vscode.Position(Math.max(opts.line - 1, 0), 0)
        return vscode.window.showTextDocument(vscode.Uri.file(path), {
          selection: new vscode.Range(pos, pos),
        })
      },
      activeTextEditor: activeTextEditorSnapshot,
      showInputBox: async (options?: { prompt?: string; placeHolder?: string }) => (
        vscode.window.showInputBox(options)
      ),
      registerTimelineProvider: (scheme: string, provider: VscodeTimelineProviderLike) => (
        vscode.window.registerTimelineProvider(scheme, provider as never)
      ),
    },
    languages: {
      onDidChangeDiagnostics: (l: (event: DiagnosticChangeLike) => void) => vscode.languages.onDidChangeDiagnostics(l),
      getDiagnostics: (uri: UriLike) => vscode.languages.getDiagnostics(uri) as readonly DiagnosticLike[],
      registerInlayHintsProvider: (selector: unknown, provider: unknown) => (
        vscode.languages.registerInlayHintsProvider(selector as never, provider as never)
      ),
    },
    commands: {
      registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => (
        vscode.commands.registerCommand(id, handler)
      ),
      executeCommand: (id: string, ...args: unknown[]) => (
        vscode.commands.executeCommand(id, ...args) as Promise<unknown>
      ),
    },
    uri: {
      parse: (value: string): unknown => vscode.Uri.parse(value),
      file: (path: string): unknown => vscode.Uri.file(path),
    },
    runtime: {
      createEventEmitter: (): EventEmitterLike => {
        const emitter = new vscode.EventEmitter()
        return {
          event: emitter.event,
          fire(payload?: unknown) { emitter.fire(payload) },
          dispose() { emitter.dispose() },
        }
      },
    },
  } satisfies VscodeApiFacade)
  cached = facade
  return facade
}

export const inject: string[] = []

export function apply(ctx: Context): void {
  ctx.vscodeApi = fetchVscodeApiFacade()
}
