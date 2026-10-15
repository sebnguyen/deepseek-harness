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

export interface VscodeApiFacade {
  readonly workspace: {
    readonly workspaceRoot: () => string | null
    readonly onDidSaveTextDocument: (listener: (doc: TextDocumentLike) => void) => unknown
    readonly onDidChangeActiveTextEditor: (listener: (editor: TextEditorLike | undefined) => void) => unknown
  }
  readonly window: {
    readonly showTextDocument: (path: string, options?: { line?: number }) => Promise<unknown>
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context { vscodeApi: VscodeApiFacade }
}

type TextDocumentLike = { uri?: { fsPath?: string } }
type TextEditorLike = { document?: TextDocumentLike }

let cached: VscodeApiFacade | undefined

export function fetchVscodeApiFacade(): VscodeApiFacade {
  if (cached !== undefined) return cached
  cached = Object.freeze({
    workspace: {
      workspaceRoot: () => vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath ?? null,
      onDidSaveTextDocument: (l: (doc: TextDocumentLike) => void) => vscode.workspace.onDidSaveTextDocument(l),
      onDidChangeActiveTextEditor: (l: (editor: TextEditorLike | undefined) => void) => vscode.window.onDidChangeActiveTextEditor(l),
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
  })
  return cached
}

export const inject: string[] = []

export function apply(ctx: Context): void {
  ctx.vscodeApi = fetchVscodeApiFacade()
}
