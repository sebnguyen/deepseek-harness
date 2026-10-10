import type { Context } from '@deepseek-ai/cordis'
import { activateBridge, type IdeBridgeFace, type VscodeGlueFace } from './bridge.ts'
import { syncNotes, type CommentsFace, type NoteThreadState } from './notes.ts'
import { entryFor, notesOf, stopsOf } from './projection.ts'
import { seatEvidence, startSeat } from './seat.ts'
import { projectStops, restoreAt, type TimelineWireFace } from './timeline.ts'

/**
 * Real activation entry inside the twin's ext-host. The twin is a cordis
 * engine too: activation reads the spawn env as its evidence row, and only
 * when the launch token proves parentage does it start the seat — the same
 * client halves the web app mounts, over one token-closured carrier. Every
 * feature below is a parked `inject` fiber on the seat's keys, so a twin
 * booted standalone mounts nothing: the frame stays a stock editor. The
 * register content rides the house checkpoint wire exactly as the web's
 * line-note and timeline surfaces ride it; the ide namespace carries frame
 * lifecycle only.
 */

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Present iff the spawn env proved the twin is the Host's child. */
    ideHost: IdeHost
  }
}

/** The seat facts feature plugins may read behind the `ideHost` key. */
export interface IdeHost {
  /** The session the checkpoint projections address. */
  readonly sessionId: string
  /** The workspace root that session-relative register paths are under. */
  readonly cwd: string
}

interface RemoteWire<T> {
  readonly ok: boolean
  readonly value?: T
  readonly error?: { readonly message: string }
}

function valueOf<T>(result: RemoteWire<T>): T | undefined {
  return result.ok ? result.value : undefined
}

/** The checkpoint namespace as the seat's features unwrap it. */
interface CheckpointSeatFace {
  slots(sessionId: string, path?: string): Promise<RemoteWire<readonly import('@deepseek-ai/dsh-checkpoint/types').CheckpointSlotTimeline[]>>
  stops(sessionId: string, path?: string): Promise<RemoteWire<readonly import('@deepseek-ai/dsh-checkpoint/types').CheckpointTimeline[]>>
  restore(sessionId: string, path: string, digest: string): Promise<RemoteWire<string>>
}

/** The frame-lifecycle namespace as the seat's features unwrap it. */
interface IdeSeatFace {
  hello(): Promise<RemoteWire<boolean>>
  openNext(): Promise<RemoteWire<string | null>>
  report(kind: 'save' | 'activeEditor' | 'diagnostics', path: string | null, detail: string | null): Promise<RemoteWire<void>>
}

interface SeatRemote {
  readonly checkpoint: CheckpointSeatFace
  readonly ide: IdeSeatFace
}

export interface ActivateHooks {
  /** The ext-host API facade; the real entry passes the ambient module. */
  vscode: typeof import('vscode')
  /** Spawn evidence override for tests; defaults to `process.env`. */
  env?: Readonly<Record<string, string | undefined>>
}

/**
 * Activate the seat and its feature plugins. Returns the deactivate disposer
 * the extension host runs; a missing evidence row yields the inert one.
 * @param hooks - the ext-host facade and env seam.
 * @returns disposer tearing the whole seat engine down.
 */
export async function activate(hooks: ActivateHooks): Promise<() => void> {
  const evidence = seatEvidence(hooks.env ?? process.env)
  if (evidence === undefined) return () => {}
  const seat = await startSeat(evidence)
  const ctx = seat.context
  const vscode = hooks.vscode
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''
  ctx.provide('ideHost', { sessionId: evidence.sessionId, cwd })
  const remote = (context: Context): SeatRemote => context.get('remote') as unknown as SeatRemote

  /** The frame-lifecycle fiber: chrome posture, hello, the open drain, uplink. */
  const framePlugin = {
    inject: ['ideHost', 'remote.ide'],
    async apply(context: Context): Promise<() => void> {
      const glue: VscodeGlueFace = {
        executeOpen: async (path) => {
          await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path))
        },
        updateSetting: async (key, value) => {
          await vscode.workspace.getConfiguration().update(key, value, true)
        },
        runLayoutCommand: async (command) => {
          await vscode.commands.executeCommand(command)
        },
      }
      const face = remote(context).ide
      const ide: IdeBridgeFace = {
        hello: async () => (await face.hello()).ok,
        openNext: async () => valueOf(await face.openNext()) ?? null,
      }
      const drain = await activateBridge(glue, ide)
      const onSave = vscode.workspace.onDidSaveTextDocument((document) => {
        void face.report('save', document.uri.fsPath, null)
      })
      const onEditor = vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor !== undefined) void face.report('activeEditor', editor.document.uri.fsPath, null)
      })
      return () => {
        onSave.dispose()
        onEditor.dispose()
        drain()
      }
    },
  }

  /** The render fiber: comment threads off the note register, per active file. */
  const projectionPlugin = {
    inject: ['ideHost', 'remote.checkpoint'],
    apply(context: Context): () => void {
      const parkedHost = context.get('ideHost')
      if (parkedHost === undefined) return () => {}
      const host = parkedHost
      const face = remote(context).checkpoint
      const commentsController = vscode.comments.createCommentController('dsh-notes', 'DSH notes')
      const threadsById = new Map<string, import('vscode').CommentThreadRef>()
      const commentsFace: CommentsFace = {
        createThread: (line, body, author) => {
          const id = randomId()
          const thread = commentsController.createCommentThread(
            vscode.Uri.file(activePath ?? ''),
            new vscode.Range(line - 1, 0, line - 1, 0),
            [{ body, author }],
          )
          threadsById.set(id, thread)
          return id
        },
        replaceThread: (threadId, body) => {
          const thread = threadsById.get(threadId)
          if (thread !== undefined) thread.comments = thread.comments.map(c => ({ ...c, body }))
        },
        deleteThread: (threadId) => {
          const thread = threadsById.get(threadId)
          if (thread !== undefined) {
            thread.dispose()
            threadsById.delete(threadId)
          }
        },
      }
      function randomId(): string {
        return `${Date.now().toString(36)}-${threadsById.size.toString(36)}`
      }
      let activeEditor: import('vscode').TextEditorRef | undefined
      let activePath: string | undefined
      let noteThreads: ReadonlyMap<string, NoteThreadState> = new Map()
      const wire: TimelineWireFace = {
        stops: async () => valueOf(await face.stops(host.sessionId)) ?? [],
        restore: async (digest) => {
          await face.restore(host.sessionId, activePath ?? '', digest)
        },
      }
      const pump = async (): Promise<void> => {
        const path = activePath
        if (path === undefined || activeEditor === undefined) return
        const slots = valueOf(await face.slots(host.sessionId)) ?? []
        const entry = entryFor(host.cwd, slots, path)
        noteThreads = await syncNotes({ list: () => Promise.resolve(entry === undefined ? [] : notesOf(entry)) }, commentsFace, noteThreads)
        const timelines = valueOf(await face.stops(host.sessionId)) ?? []
        const timeline = entryFor(host.cwd, timelines, path)
        void projectStops(timeline === undefined ? [] : stopsOf(timeline))
        void wire
      }
      const onEditor = vscode.window.onDidChangeActiveTextEditor((editor) => {
        activeEditor = editor
        activePath = editor?.document.uri.fsPath
        void pump()
      })
      const timer = setInterval(() => {
        void pump()
      }, 1_500)
      return () => {
        clearInterval(timer)
        onEditor.dispose()
        for (const thread of threadsById.values()) thread.dispose()
        commentsController.dispose()
      }
    },
  }

  await ctx.plugin(framePlugin)
  await ctx.plugin(projectionPlugin)
  return () => {
    void ctx.fiber.dispose().then(() => seat.dispose()).catch(() => {})
  }
}

/**
 * Scrub one timeline chip back through the checkpoint restore Remote; the
 * command palette entry the web's timeline row owns, twin-shaped.
 * @param face - the checkpoint namespace face.
 * @param sessionId - the addressed session.
 * @param path - the addressed file.
 * @param items - the current projection.
 * @param index - the scrubbed chip.
 */
export async function scrubStop(
  face: { restore(sessionId: string, path: string, digest: string): Promise<RemoteWire<string>> },
  sessionId: string,
  path: string,
  items: readonly { readonly digest: string }[],
  index: number,
): Promise<void> {
  await restoreAt({
    stops: () => Promise.resolve([]),
    restore: async (digest) => {
      const result = await face.restore(sessionId, path, digest)
      if (!result.ok) throw new Error(result.error?.message ?? 'restore refused')
    },
  }, items.map(item => ({ turn: 0, tool: '', digest: item.digest, label: '' })), index)
}
