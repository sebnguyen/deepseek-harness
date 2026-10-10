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
  export const Range: {
    new (startLine: number, startCharacter: number, endLine: number, endCharacter: number): RangeLike
  }
  export interface RangeLike {}
  export interface TextDocumentRef {
    readonly uri: Uri
  }
  export interface TextEditorDecorationType extends Disposable {}
  export interface TextEditorRef {
    readonly document: TextDocumentRef
    setDecorations(type: TextEditorDecorationType, ranges: readonly RangeLike[]): void
  }
  export interface CommentRef {
    body: string
    author: string
  }
  export interface CommentThreadRef extends Disposable {
    comments: CommentRef[]
  }
  export interface CommentControllerRef extends Disposable {
    createCommentThread(uri: Uri, range: RangeLike, comments: CommentRef[]): CommentThreadRef
  }
  export namespace commands {
    export function executeCommand(command: string, ...args: unknown[]): Thenable<unknown>
  }
  export namespace workspace {
    export const workspaceFolders: ReadonlyArray<{ readonly uri: Uri }> | undefined
    export function getConfiguration(section?: string): {
      update(key: string, value: unknown, global?: boolean): Thenable<void>
    }
    export function onDidSaveTextDocument(listener: (document: TextDocumentRef) => void): Disposable
  }
  export namespace window {
    export function onDidChangeActiveTextEditor(listener: (editor: TextEditorRef | undefined) => void): Disposable
    export function createTextEditorDecorationType(options: unknown): TextEditorDecorationType
  }
  export namespace comments {
    export function createCommentController(id: string, label: string): CommentControllerRef
  }
}
