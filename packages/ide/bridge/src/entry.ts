import { activateBridge, type IdeBridgeFace, type VscodeGlueFace } from './bridge.ts'

/**
 * Real activation entry inside the twin's ext-host: wires `vscode` and the
 * loopback gateway face from spawn env, then defers to the tested glue. The
 * event uplink rides document-save and active-editor changes; teardown drops
 * the subscriptions before the drain.
 */
export async function activate(): Promise<() => void> {
  const vscode = await import('vscode')
  const base = process.env.DSH_GATEWAY_URL ?? 'http://127.0.0.1:0'
  const session = process.env.DSH_SESSION_ID ?? ''
  const call = async (method: string): Promise<unknown> => {
    const response = await fetch(`${base}/api/remote.ide.${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ args: [session] }),
    })
    return response.json()
  }
  const report = async (kind: 'save' | 'activeEditor', path: string | undefined): Promise<void> => {
    await fetch(`${base}/api/remote.ide.report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ args: [session, kind, path, undefined] }),
    })
  }
  const ide: IdeBridgeFace = {
    hello: async () => (await call('hello')) as boolean,
    openNext: async () => (await call('openNext')) as string | undefined,
  }
  const glue: VscodeGlueFace = {
    executeOpen: async (path) => {
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path))
    },
    updateSetting: (key, value) => vscode.workspace.getConfiguration().update(key, value, true),
    runLayoutCommand: command => vscode.commands.executeCommand(command),
  }
  const drainDown = await activateBridge(glue, ide)
  const subscriptions = [
    vscode.workspace.onDidSaveTextDocument((document) => {
      void report('save', document.uri.fsPath)
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      void report('activeEditor', editor?.document.uri.fsPath)
    }),
  ]
  return () => {
    for (const subscription of subscriptions) subscription.dispose()
    drainDown()
  }
}
