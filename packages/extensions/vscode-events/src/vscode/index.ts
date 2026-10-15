/**
 * vscode-events: the uplink-projection pilot plane.
 *
 * Translates vscode workbench events on the seat's `vscodeApi` facade into
 * `ideBridge.report` uploads the host projects (save, activeEditor,
 * diagnostics error/warning counts). The bundle evaluates inside the seat's
 * Loader and never imports `vscode` itself — the facade and remotes arrive
 * through the seat's services, and the plane's own dependencies are inlined.
 * @module @deepseek-ai/dsh-vscode-events
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IdeBridgeReportEvent } from '@deepseek-ai/dsh-api-ide/types'

declare module '@deepseek-ai/cordis' {
  interface Context {
    twinCore: { readonly token: string }
  }
}

export const inject: readonly string[] = ['vscodeApi', 'remote.ideBridge']

interface IdeBridgeReportRemote {
  report(request: { token: string; event: IdeBridgeReportEvent }): Promise<unknown>
}

/** The facade slice this plane consumes (see vscode-cordis/src/vscode-api.ts). */
interface VscodeApiEvents {
  workspace: {
    onDidSaveTextDocument(listener: (doc: { uri?: { fsPath?: string } }) => void): unknown
    onDidChangeActiveTextEditor(listener: (editor: { document?: { uri?: { fsPath?: string } } } | undefined) => void): unknown
  }
  languages: {
    onDidChangeDiagnostics(listener: (event: { uris?: readonly { fsPath?: string }[] }) => void): unknown
    getDiagnostics(uri: { fsPath?: string }): readonly { severity?: number }[]
  }
}

/**
 * Report one editor event. Eventless-path documents (in-memory buffers)
 * never surface: there is nothing host-side a projection could join to.
 */
export function apply(ctx: Context): void {
  const api = (ctx as unknown as { vscodeApi: VscodeApiEvents }).vscodeApi
  const ideBridge = (ctx as unknown as { remote: { ideBridge: IdeBridgeReportRemote } }).remote.ideBridge
  const report = (event: IdeBridgeReportEvent): void => {
    void ideBridge.report({ token: ctx.twinCore.token, event }).then(undefined, () => undefined)
  }
  api.workspace.onDidSaveTextDocument((doc) => {
    const path = doc.uri?.fsPath
    if (path !== undefined) report({ type: 'save', path })
  })
  api.workspace.onDidChangeActiveTextEditor((editor) => {
    report({ type: 'activeEditor', path: editor?.document?.uri?.fsPath ?? null })
  })
  api.languages.onDidChangeDiagnostics((evt) => {
    for (const uri of evt.uris ?? []) {
      const path = uri.fsPath
      if (path === undefined) continue
      const diagnostics = api.languages.getDiagnostics(uri)
      // vscode.DiagnosticSeverity: 0 = Error, 1 = Warning.
      report({
        type: 'diagnostics',
        path,
        errors: diagnostics.filter(d => d.severity === 0).length,
        warnings: diagnostics.filter(d => d.severity === 1).length,
      })
    }
  })
}
