/**
 * The ambient `vscode` module stub for unit specs: seat code imports it
 * under an extension host, where vscode supplies it; in the spec lane the
 * surface is inert listeners and frozen constants.
 */
export const Uri = {
  file: (path: string) => ({ fsPath: path, scheme: 'file' }),
  parse: (value: string) => ({ uri: value }),
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

export class EventEmitter {
  private readonly listeners: Array<(payload: unknown) => void> = []
  readonly event = (listener: (payload: unknown) => void) => {
    this.listeners.push(listener)
    return { dispose: () => undefined }
  }

  fire(payload: unknown): void {
    for (const listener of this.listeners) listener(payload)
  }

  dispose(): void {
    this.listeners.length = 0
  }
}

export const workspace = {
  workspaceFolders: undefined,
  onDidSaveTextDocument: () => ({ dispose: () => undefined }),
  registerTextDocumentContentProvider: () => ({ dispose: () => undefined }),
}

export const window = {
  activeTextEditor: undefined,
  onDidChangeActiveTextEditor: () => ({ dispose: () => undefined }),
  showTextDocument: async () => undefined,
  showInputBox: async () => undefined,
  registerTimelineProvider: () => ({ dispose: () => undefined }),
}

export const languages = {
  onDidChangeDiagnostics: () => ({ dispose: () => undefined }),
  getDiagnostics: () => [],
  registerInlayHintsProvider: () => ({ dispose: () => undefined }),
}

export const commands = {
  registerCommand: () => ({ dispose: () => undefined }),
  executeCommand: async () => undefined,
}
