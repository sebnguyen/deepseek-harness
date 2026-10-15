/**
 * The slices of `vscode` the bridge touches, declared ambiently so the
 * package carries no @types/vscode dependency. The types are exactly the
 * runtime surface the shim consumes; the twin's extension host supplies
 * the real module at activation.
 */
declare module 'vscode' {
  /** The staged extension's own directory on disk. */
  export interface ExtensionUri { readonly fsPath: string }
  export interface Disposable { dispose(): void }
  export interface ExtensionContext {
    readonly extensionUri: ExtensionUri
    /** Disposables the extension host drains on unload. */
    readonly subscriptions: Disposable[]
  }

  /** A dedicated diagnostics sink, surfaced in the workbench Output panel. */
  export interface OutputChannel {
    appendLine(value: string): void
    dispose(): void
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
    registerTextDocumentContentProvider(scheme: string, provider: unknown): unknown
  }

  export const window: {
    showTextDocument(target: unknown, options?: unknown): PromiseLike<unknown>
    onDidChangeActiveTextEditor(listener: unknown): unknown
    createOutputChannel(name: string): OutputChannel
  }

  export const languages: {
    onDidChangeDiagnostics(listener: unknown): unknown
    getDiagnostics(uri: unknown): readonly unknown[]
    registerInlayHintsProvider(selector: unknown, provider: unknown): unknown
  }
}
