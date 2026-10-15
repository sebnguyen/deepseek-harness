/**
 * The slices of `vscode` the bridge touches, declared ambiently so the
 * package carries no @types/vscode dependency. The types are exactly the
 * runtime surface the shim consumes; the twin's extension host supplies
 * the real module at activation.
 */
declare module 'vscode' {
  /** The staged extension's own directory on disk. */
  export interface ExtensionUri { readonly fsPath: string }
  export interface ExtensionContext {
    readonly extensionUri: ExtensionUri
  }

  export interface VsCodeUri { readonly fsPath: string }

  export const Uri: { file(path: string): VsCodeUri }
  export class Position {
    readonly line: number
    readonly character: number
    constructor(line: number, character: number)
  }
  export class Range {
    readonly start: Position
    readonly end: Position
    constructor(start: Position, end: Position)
  }

  export const workspace: {
    readonly workspaceFolders?: ReadonlyArray<{ readonly uri: VsCodeUri }>
    onDidSaveTextDocument(listener: unknown): unknown
  }

  export const window: {
    showTextDocument(target: unknown, options?: unknown): PromiseLike<unknown>
    onDidChangeActiveTextEditor(listener: unknown): unknown
  }
}
