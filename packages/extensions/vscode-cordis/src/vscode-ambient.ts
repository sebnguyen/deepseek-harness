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

  export interface VsCodeUri { readonly fsPath: string; readonly scheme?: string }

  export const Uri: { file(path: string): VsCodeUri; parse(value: string): VsCodeUri }
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

  /** A plainly-declared event emitter (Event is a function goldo-typed at use). */
  export class EventEmitter<T = unknown> {
    readonly event: unknown
    fire(event?: T): void
    dispose(): void
  }

  /** The minimal document slice the facade's editor snapshot reads. */
  export interface ActiveTextDocumentLike {
    readonly uri: { scheme?: string; fsPath?: string }
    lineAt(line: number): { text: string }
  }
  /** The minimal editor slice the facade's editor snapshot reads. */
  export interface ActiveTextEditorLike {
    readonly document: ActiveTextDocumentLike
    readonly selection: { active: { line: number } }
  }

  export const workspace: {
    readonly workspaceFolders?: ReadonlyArray<{ readonly uri: VsCodeUri }>
    onDidSaveTextDocument(listener: unknown): unknown
    registerTextDocumentContentProvider(scheme: string, provider: unknown): unknown
  }

  export const window: {
    readonly activeTextEditor?: ActiveTextEditorLike
    showTextDocument(target: unknown, options?: unknown): PromiseLike<unknown>
    onDidChangeActiveTextEditor(listener: unknown): unknown
    createOutputChannel(name: string): OutputChannel
    showInputBox(options?: { prompt?: string; placeHolder?: string }): PromiseLike<string | undefined>
    registerTimelineProvider(scheme: string, provider: unknown): unknown
  }

  export const languages: {
    onDidChangeDiagnostics(listener: unknown): unknown
    getDiagnostics(uri: unknown): readonly unknown[]
    registerInlayHintsProvider(selector: unknown, provider: unknown): unknown
  }

  export const commands: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): unknown
    executeCommand(id: string, ...args: unknown[]): PromiseLike<unknown>
  }
}
