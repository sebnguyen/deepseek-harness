/**
 * vscode-events plane: facade listeners drive ideBridge.report uploads —
 * saves carry a path, editors report path-or-null, diagnostics aggregate
 * error and warning counts per changed file.
 */

import { describe, expect, it } from 'vitest'
import { apply } from '../src/vscode/index.ts'

function fakeCtx() {
  const listeners = {
    save: undefined as undefined | ((doc: { uri?: { fsPath?: string } }) => void),
    editor: undefined as undefined | ((editor: { document?: { uri?: { fsPath?: string } } } | undefined) => void),
    diagnostics: undefined as undefined | ((event: { uris?: readonly { fsPath?: string }[] }) => void),
  }
  const reports: Array<{ token: string; event: unknown }> = []
  const ctx = {
    twinCore: { token: 'tok' },
    vscodeApi: {
      workspace: {
        onDidSaveTextDocument(fn: typeof listeners.save) { listeners.save = fn },
        onDidChangeActiveTextEditor(fn: typeof listeners.editor) { listeners.editor = fn },
      },
      languages: {
        onDidChangeDiagnostics(fn: typeof listeners.diagnostics) { listeners.diagnostics = fn },
        getDiagnostics: (uri: { fsPath?: string }) => (uri.fsPath === '/repo/a.ts'
          ? [{ severity: 0 }, { severity: 1 }, { severity: 1 }, { severity: 2 }]
          : []),
      },
    },
    remote: {
      ideBridge: {
        report: async (request: { token: string; event: unknown }) => {
          reports.push(request)
          return undefined
        },
      },
    },
  }
  apply(ctx as never)
  return { listeners, reports }
}

describe('vscode-events plane', () => {
  it('reports saves with their fs path', () => {
    const { listeners, reports } = fakeCtx()
    listeners.save?.({ uri: { fsPath: '/repo/a.ts' } })
    listeners.save?.({})  // in-memory buffer: nothing to project
    expect(reports).toEqual([
      { token: 'tok', event: { type: 'save', path: '/repo/a.ts' } },
    ])
  })

  it('reports the active editor, including null for a closed editor', () => {
    const { listeners, reports } = fakeCtx()
    listeners.editor?.({ document: { uri: { fsPath: '/repo/b.ts' } } })
    listeners.editor?.(undefined)
    expect(reports).toEqual([
      { token: 'tok', event: { type: 'activeEditor', path: '/repo/b.ts' } },
      { token: 'tok', event: { type: 'activeEditor', path: null } },
    ])
  })

  it('aggregates error and warning counts per changed file', () => {
    const { listeners, reports } = fakeCtx()
    listeners.diagnostics?.({ uris: [{ fsPath: '/repo/a.ts' }, { fsPath: '/repo/ok.ts' }] })
    expect(reports).toEqual([
      { token: 'tok', event: { type: 'diagnostics', path: '/repo/a.ts', errors: 1, warnings: 2 } },
      { token: 'tok', event: { type: 'diagnostics', path: '/repo/ok.ts', errors: 0, warnings: 0 } },
    ])
  })
})
