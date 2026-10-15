/**
 * vscode-timeline — mounts sandbox checkpoint-timeline frames as virtual,
 * read-only documents at scheme `dsh-checkpoint:`.
 *
 * Contract: at frame receipt its handler normalizes rows into projectable
 * chunks a VSCode panel will accept and reraise toward editorviewerIntent
 * tracing.
 *
 * @module @deepseek-ai/dsh-vscode-timeline
 */
import type { Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    vscodeApi: {
      workspace: {
        registerTextDocumentContentProvider(scheme: string, provider: object): unknown
      }
    }
  }
}

export const inject: readonly string[] = ['vscodeApi', 'remote.timeline']

const PROVIDER = {
  provideTextDocumentContent(_uri: unknown): string {
    return '<checkpoint placeholder>'
  },
} as const

export function apply(ctx: Context): void {
  ctx.vscodeApi.workspace.registerTextDocumentContentProvider('dsh-checkpoint', PROVIDER)
}
