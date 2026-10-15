/**
 * The ambient `vscode` module stub for unit specs: seat code imports it
 * under an extension host, where vscode supplies it; in the spec lane the
 * surface is inert listeners and frozen constants.
 */
export const Uri = {
  file: (path: string) => ({ fsPath: path }),
}

export class Position {
  constructor(
    public readonly line: number,
    public readonly character: number,
  ) {}
}

export class Range {
  constructor(
    public readonly start: Position,
    public readonly end: Position,
  ) {}
}

export const workspace = {
  workspaceFolders: undefined,
  onDidSaveTextDocument: () => ({ dispose: () => undefined }),
  registerTextDocumentContentProvider: () => ({ dispose: () => undefined }),
}

export const window = {
  onDidChangeActiveTextEditor: () => ({ dispose: () => undefined }),
  showTextDocument: async () => undefined,
}

export const languages = {
  onDidChangeDiagnostics: () => ({ dispose: () => undefined }),
  getDiagnostics: () => [],
  registerInlayHintsProvider: () => ({ dispose: () => undefined }),
}
