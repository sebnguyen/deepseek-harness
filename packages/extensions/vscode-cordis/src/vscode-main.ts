/**
 * The vscode entry the REH extension host loads. It only adapts vscode's
 * objects to the structural shapes `extension.ts`'s tested `activate`
 * consumes; the seat itself does not import the vscode module.
 * @module @deepseek-ai/dsh-vscode-cordis/vscode-main
 */

import { type ExtensionContext, Position, Range, Uri, window, workspace } from 'vscode'
import { activate as activateSeat } from './extension.ts'

let running: { stop(): Promise<void> } | undefined

/** Diagnostic sink the seat reports into — visible in the twin's Output panel as 'DSH Twin'. */
let channel: ReturnType<typeof window.createOutputChannel> | undefined

export async function activate(context: ExtensionContext): Promise<void> {
  if (channel === undefined) {
    channel = window.createOutputChannel('DSH Twin')
    context.subscriptions.push(channel)
  }
  // An in-process re-activation (the extension host restarting the
  // extension in place) must not strand the previous seat: an orphaned
  // seat loop outlives its vscode lifetime and fights every later loop
  // for the downlink through host-side supersession.
  await running?.stop()
  running = undefined
  running = await activateSeat({
    extensionUriFsPath: context.extensionUri.fsPath,
    logger: (...args: unknown[]) => {
      channel?.appendLine(`${new Date().toISOString()} ${args.map(String).join(' ')}`)
    },
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
