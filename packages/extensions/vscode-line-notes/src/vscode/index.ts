/**
 * vscode-line-notes — renders `@path#L<n>` notes as transient editor
 * decorations and inlay hints in the vscode editor view.
 * @module @deepseek-ai/dsh-vscode-line-notes
 */
import type { Context } from '@deepseek-ai/cordis'

export const inject: readonly string[] = ['vscodeApi', 'remote.lineNotes']

declare module '@deepseek-ai/cordis' {
  interface Context {
    vscodeApi: unknown
  }
}

export function apply(ctx: Context): void {
  void ctx
}
