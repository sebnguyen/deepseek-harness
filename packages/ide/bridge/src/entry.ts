import { randomUUID } from 'node:crypto'
import { activateBridge, type IdeBridgeFace, type VscodeGlueFace } from './bridge.ts'

/**
 * Real activation entry inside the twin's ext-host: the bridge is a colocated
 * non-browser client of the Host Connection. Calls ride the house wire
 * verbatim — POST `/api/<endpoint>` with the `client-request` envelope, the
 * process launch token from the spawn env as the `token` query credential —
 * so the Host's trust fence and browser-auth see exactly what a house client
 * sends. A missing credential or a refused call is the frame-absent posture,
 * never a crash of the twin's extension host.
 */
export async function activate(): Promise<() => void> {
  const vscode = await import('vscode')
  const base = (process.env.DSH_GATEWAY_URL ?? 'http://127.0.0.1:0').replace(/\/$/u, '')
  const token = process.env.DSH_IDE_TOKEN ?? ''
  const unavailable = (): (() => void) => () => {}
  if (token === '') return unavailable()
  /** One unary remote verb over the Connection envelope. */
  const call = async (endpoint: string, args: readonly unknown[]): Promise<unknown> => {
    const url = `${base}/api/${endpoint}?token=${encodeURIComponent(token)}`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: endpoint, payload: { args } }),
    })
    if (!response.ok) throw new Error(`gateway answered ${response.status} for ${endpoint}`)
    const envelope = await response.json() as {
      readonly result?: { readonly ok: boolean; readonly value?: unknown; readonly error?: { readonly message: string } }
    }
    const result = envelope.result
    if (result === undefined) throw new Error(`gateway sent no result for ${endpoint}`)
    if (!result.ok) throw new Error(result.error?.message ?? `gateway refused ${endpoint}`)
    return result.value
  }
  const safe = async (endpoint: string, args: readonly unknown[]): Promise<unknown | undefined> => {
    try {
      return await call(endpoint, args)
    }
    catch {
      return undefined
    }
  }
  const ide: IdeBridgeFace = {
    hello: async () => (await safe('ide/hello', [])) === true,
    openNext: async () => {
      const next = await safe('ide/openNext', [])
      return typeof next === 'string' ? next : null
    },
  }
  const glue: VscodeGlueFace = {
    executeOpen: async (path) => {
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path))
    },
    updateSetting: (key, value) => vscode.workspace.getConfiguration().update(key, value, true),
    runLayoutCommand: command => vscode.commands.executeCommand(command),
  }
  const drainDown = await activateBridge(glue, ide)
  const report = (kind: 'save' | 'activeEditor', path: string | null): void => {
    void safe('ide/report', [kind, path, null])
  }
  const subscriptions = [
    vscode.workspace.onDidSaveTextDocument((document) => {
      report('save', document.uri.fsPath)
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      report('activeEditor', editor?.document.uri.fsPath ?? null)
    }),
  ]
  return () => {
    for (const subscription of subscriptions) subscription.dispose()
    drainDown()
  }
}
