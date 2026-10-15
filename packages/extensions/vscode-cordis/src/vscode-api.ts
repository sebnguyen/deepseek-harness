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
  provideTextDocumentContent(uri: unknown): string | undefined
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
  }
  readonly languages: {
    readonly onDidChangeDiagnostics: (listener: (event: DiagnosticChangeLike) => void) => unknown
    readonly getDiagnostics: (uri: UriLike) => readonly DiagnosticLike[]
    readonly registerInlayHintsProvider: (selector: unknown, provider: unknown) => unknown
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
      registerTextDocumentContentProvider: (scheme: string, provider: { provideTextDocumentContent(uri: unknown): string | undefined }) => (
        vscode.workspace.registerTextDocumentContentProvider(scheme, provider)
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
    },
    languages: {
      onDidChangeDiagnostics: (l: (event: DiagnosticChangeLike) => void) => vscode.languages.onDidChangeDiagnostics(l),
      getDiagnostics: (uri: UriLike) => vscode.languages.getDiagnostics(uri) as readonly DiagnosticLike[],
      registerInlayHintsProvider: (selector: unknown, provider: unknown) => (
        vscode.languages.registerInlayHintsProvider(selector as never, provider as never)
      ),
    },
  })
  cached = facade
  return cached
}

export const inject: string[] = []

export function apply(ctx: Context): void {
  ctx.vscodeApi = fetchVscodeApiFacade()
}
