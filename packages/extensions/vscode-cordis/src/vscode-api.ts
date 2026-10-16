/**
 * vscodeApi: the ambient vscode module — supplied by the extension host at
 * activation — published on the seat Context as ONE cordis service. The
 * facade forwards the vscode namespaces generically: a plane reads
 * `vscodeApi.languages.registerCodeLensProvider` the moment vscode registers
 * it, with no facade commit in between. Only the genuinely synthetic
 * members are curated on top (workspaceRoot, the active-editor snapshot,
 * the fork's timeline redirect, plus `uri`/`runtime`/`classes` helpers).
 * Planes never import `vscode`; they consume the service.
 */
import type { Context } from '@deepseek-ai/cordis'
import * as vscode from 'vscode'

/** A virtual-text-document content provider (vscode.workspace.registerTextDocumentContentProvider). */
export interface VscodeContentProviderLike {
  provideTextDocumentContent(uri: unknown): string | undefined | PromiseLike<string | undefined>
}

/** A timeline provider; the facade hands it vscode's calls verbatim (vscode.window.registerTimelineProvider). */
export interface VscodeTimelineProviderLike {
  readonly id?: string
  readonly label?: string
  provideTimeline(uri: unknown, options: unknown, token: unknown): PromiseLike<readonly VscodeTimelineItemLike[]>
}

/**
 * One Timeline item the plane returns: plain data only. `command.arguments`
 * may carry URIs already made with `vscodeApi.uri.parse`; the facade passes
 * the object through to vscode's timeline conversion unchanged.
 */
export interface VscodeTimelineItemLike {
  readonly id?: string
  readonly label: string
  readonly timestamp?: number
  readonly tooltip?: string
  readonly command?: {
    readonly id: string
    readonly title: string
    readonly arguments?: readonly unknown[]
  }
}

/** The active editor's note-relevant position snapshot, in vscode's own conventions. */
export interface ActiveTextEditorSnapshot {
  /** The editor document's on-disk path, or null for untitled/virtual docs. */
  readonly path: string | null
  /** The caret's 1-based line number. */
  readonly line: number
  /** The caret line's full text (for freezing into a note slot). */
  readonly lineText: string
}

/** A vscode-style event emitter the plane attaches as `onDidChange*` on its providers. */
export interface EventEmitterLike {
  readonly event: unknown
  fire(payload?: unknown): void
  dispose(): void
}

/** A uri in the facade's own minimal shape — planes never import `vscode`. */
export interface UriLike { fsPath?: string }
/** A diagnostics-change event (see vscode.languages.onDidChangeDiagnostics). */
export interface DiagnosticChangeLike { uris?: readonly UriLike[] }
/** A diagnostic in the facade's minimal shape; `severity` mirrors the vscode enum (0 = Error, 1 = Warning). */
export interface DiagnosticLike { severity?: number }

/**
 * The cordis service the seat publishes. Namespaces forward to the live
 * vscode module — every member vscode registers resolvable, no curation —
 * while the curated members (see the facade source) override only what
 * genuinely differs (workspaceRoot snapshot, the timeline redirect, the
 * `uri`/`runtime`/`classes` helpers planes cannot construct themselves). Each
 * forwarded namespace (`workspace`/`window`/`languages`/`commands`/`comments`
 * and friends) is a Proxy overlaying curated overrides onto `vscode.<ns>`.
 */
export interface VscodeApiFacade {
  readonly workspace: unknown
  readonly window: unknown
  readonly languages: unknown
  readonly commands: unknown
  readonly comments: unknown
  readonly env: unknown
  readonly debug: unknown
  readonly tasks: unknown
  readonly scm: unknown
  readonly extensions: unknown
  readonly authentication: unknown
  readonly uri: {
    readonly parse: (value: string) => unknown
    readonly file: (path: string) => unknown
  }
  readonly runtime: {
    readonly createEventEmitter: () => EventEmitterLike
  }
  /** vscode's class constructors (Uri, Range, Position, EventEmitter...) for planes that must build real values. */
  readonly classes: unknown
}

declare module '@deepseek-ai/cordis' {
  interface Context { vscodeApi: VscodeApiFacade }
}

type VscodeNamespace = Record<PropertyKey, unknown>

const vmod = vscode as unknown as Record<string, unknown>

/** Snapshot the ambient active editor, or null when no file editor is focused. */
function activeTextEditorSnapshot(): ActiveTextEditorSnapshot | null {
  const editor = vscode.window.activeTextEditor
  if (editor === undefined) return null
  const document = editor.document as {
    uri?: { scheme?: string; fsPath?: string }
    lineAt(line: number): { text: string }
  }
  const scheme = document.uri?.scheme
  const path = scheme === 'file' ? (document.uri?.fsPath ?? null) : null
  const line = editor.selection.active.line
  return { path, line: line + 1, lineText: document.lineAt(line).text }
}

/**
 * A namespace surface: the curated overrides own-shadow the live vscode
 * namespace objects below them. Reads evaluate against `vscode` at call
 * time, so late-registered members, live getters (visibleTextEditors...) and
 * the fork's proposed routes all resolve exactly as vscode registers them.
 */
function namespaceSur(source: VscodeNamespace, overrides: VscodeNamespace): VscodeNamespace {
  return new Proxy(overrides, {
    get(target, prop, receiver) {
      if (Reflect.has(target, prop)) return Reflect.get(target, prop, receiver)
      return Reflect.get(source, prop)
    },
    has(target, prop) {
      return Reflect.has(target, prop) || Reflect.has(source, prop)
    },
    getOwnPropertyDescriptor(target, prop) {
      return (
        Reflect.getOwnPropertyDescriptor(target, prop) ??
        Reflect.getOwnPropertyDescriptor(source, prop)
      )
    },
    ownKeys(target) {
      return [...new Set([...Reflect.ownKeys(source), ...Reflect.ownKeys(target)])]
    },
  })
}

/** vscode's constructor exports (`Uri`, `Range`, `Position`, `EventEmitter`) — PascalCase function values. */
function classSurface(): VscodeNamespace {
  const classes: VscodeNamespace = {}
  for (const key of Reflect.ownKeys(vmod)) {
    if (typeof key !== 'string' || !/^[A-Z]/.test(key)) continue
    const value = vmod[key]
    if (typeof value === 'function') classes[key] = value
  }
  return classes
}

let cached: VscodeApiFacade | undefined

let facadeLogger: ((...args: unknown[]) => void) | undefined

/** Route the facade's health line onto the seat's logger channel. */
export function setFacadeLogger(logger: ((...args: unknown[]) => void) | undefined): void {
  facadeLogger = logger
}

export function fetchVscodeApiFacade(): VscodeApiFacade {
  if (cached !== undefined) return cached
  const facade: VscodeApiFacade = Object.freeze({
    workspace: namespaceSur(vmod.workspace as VscodeNamespace, {
      workspaceRoot: () => {
        const folders = vscode.workspace.workspaceFolders
        const first = folders === undefined || folders.length === 0 ? undefined : folders[0]
        return first === undefined ? null : first.uri.fsPath
      },
    }),
    window: namespaceSur(vmod.window as VscodeNamespace, {
      activeTextEditor: activeTextEditorSnapshot,
      // This vscode fork keeps the timeline proposal on the workspace
      // namespace (vscode.workspace.registerTimelineProvider); planes name
      // the stable-API location, the facade redirects once, here.
      registerTimelineProvider: (scheme: string, provider: unknown) => (
        (vmod.workspace as VscodeNamespace).registerTimelineProvider as (scheme: string, provider: unknown) => unknown
      )(scheme, provider),
      showTextDocument: async (path: string, opts?: { line?: number }) => {
        if (opts?.line === undefined) return vscode.window.showTextDocument(vscode.Uri.file(path))
        const pos = new vscode.Position(Math.max(opts.line - 1, 0), 0)
        return vscode.window.showTextDocument(vscode.Uri.file(path), {
          selection: new vscode.Range(pos, pos),
        })
      },
    }),
    languages: namespaceSur(vmod.languages as VscodeNamespace, {}),
    commands: namespaceSur(vmod.commands as VscodeNamespace, {}),
    comments: namespaceSur((vmod.comments ?? {}) as VscodeNamespace, {}),
    env: namespaceSur((vmod.env ?? {}) as VscodeNamespace, {}),
    debug: namespaceSur((vmod.debug ?? {}) as VscodeNamespace, {}),
    tasks: namespaceSur((vmod.tasks ?? {}) as VscodeNamespace, {}),
    scm: namespaceSur((vmod.scm ?? {}) as VscodeNamespace, {}),
    extensions: namespaceSur((vmod.extensions ?? {}) as VscodeNamespace, {}),
    authentication: namespaceSur((vmod.authentication ?? {}) as VscodeNamespace, {}),
    uri: {
      parse: (value: string): unknown => vscode.Uri.parse(value),
      file: (path: string): unknown => vscode.Uri.file(path),
    },
    runtime: {
      createEventEmitter: (): EventEmitterLike => {
        const emitter = new vscode.EventEmitter()
        return {
          event: emitter.event,
          fire(payload?: unknown) { emitter.fire(payload) },
          dispose() { emitter.dispose() },
        }
      },
    },
    classes: classSurface(),
  })
  cached = facade
  return facade
}

export const inject: string[] = []

export function apply(ctx: Context): void {
  // The facade composes as a real cordis service: planes inject `vscodeApi`
  // by name, and the service view is the only shape the injector can wait on
  // when the seat composes.
  ctx.provide('vscodeApi', fetchVscodeApiFacade())
  facadeLogger?.('vscode-api: facade installed')
}
