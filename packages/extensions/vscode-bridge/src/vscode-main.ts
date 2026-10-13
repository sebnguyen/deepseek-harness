/**
 * The vscode entry the REH extension host loads. It only adapts vscode's
 * objects to the structural shapes `extension.ts`'s tested `activate`
 * consumes; the seat itself does not import the vscode module.
 * @module @deepseek-ai/dsh-vscode-bridge/vscode-main
 */

import { type ExtensionContext, Position, Range, Uri, window, workspace } from 'vscode'
import { activate as activateSeat } from './extension.ts'

let running: { stop(): Promise<void> } | undefined

export async function activate(context: ExtensionContext): Promise<void> {
  running = await activateSeat({
    extensionUriFsPath: context.extensionUri.fsPath,
    workbench: {
      workspaceRoot: workspace.workspaceFolders?.[0]?.uri.fsPath ?? null,
      showTextDocument: async (path: string, options?: { line?: number }): Promise<unknown> => {
        const line = options?.line
        return window.showTextDocument(Uri.file(path), {
          ...(line === undefined
            ? {}
            : { selection: new Range(new Position(Math.max(line - 1, 0), 0), new Position(Math.max(line - 1, 0), 0)) }),
        })
      },
    },
  })
}

export async function deactivate(): Promise<void> {
  await running?.stop()
  running = undefined
}
