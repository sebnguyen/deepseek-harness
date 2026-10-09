/**
 * Minimal ambient surface of the `vscode` module the bridge rides. The real
 * types live in the pinned twin's `vscode.d.ts`; the repository-side skeleton
 * declares only what its glue calls, so house tooling type-checks the package
 * without the twin present.
 */
declare module 'vscode' {
  export interface Disposable {
    dispose(): void
  }
  export interface Uri {
    readonly fsPath: string
  }
  export const Uri: {
    file(path: string): Uri
  }
  export namespace commands {
    export function executeCommand(command: string, ...args: unknown[]): Thenable<unknown>
  }
  export namespace workspace {
    export function getConfiguration(section?: string): {
      update(key: string, value: unknown, global?: boolean): Thenable<void>
    }
  }
}
