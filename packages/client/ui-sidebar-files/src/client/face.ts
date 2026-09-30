/**
 * The tree's asynchronous half: listing directories into the store.
 *
 * The component never awaits anything. It calls `start` / `load` / `toggle`, and
 * this face performs the listing and writes the outcome through the store's own
 * actions — the Slot-standard `inject` shape, so the session id is resolved by
 * the framework and the write set stays the store's.
 *
 * The listing itself is bound here to the Client Remote face: the tree keys
 * every level by absolute path and hands the endpoint that same absolute path;
 * the endpoint answers with the directory's workspace-relative path as well,
 * which the tree has no use for and drops.
 *
 * One level has one listing in force: asking for a level again — the reload
 * gesture, a directory reopened after a reset — retires the listing still in
 * flight for it, whose settlement then writes nothing. Cleanup rides the owner's
 * `signal`: a request is not made for an owner that already ended, and when the
 * owner goes away the bucket and its listing bookkeeping are forgotten, so no
 * later settlement writes to it.
 */
import type { ClientRemote, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { BoundActions } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { DirLevel, TreeKey, createFilesStore } from './store.ts'

/**
 * One directory listing, bound to a Remote face.
 *
 * The session travels with the call because the endpoint resolves the workspace
 * root from it: the same path means different directories in different sessions.
 * A Remote call does not reject — the result carries the failure.
 */
export type ListWorkspaceDirectory = (
  sessionId: SessionId,
  path: string,
  signal: AbortSignal,
) => Promise<RemoteResult<DirLevel>>

/**
 * The slice of the Client Remote face this package calls: the `workspaceFiles`
 * namespace's `list`, exactly as the Host's generated client declares it.
 */
export type WorkspaceFilesListRemote = {
  readonly workspaceFiles: Pick<ClientRemote['workspaceFiles'], 'list'>
}

/**
 * Bind the listing to one Remote face, keeping only what the tree stores.
 * @param remote - the Client Remote face carrying the `workspaceFiles` namespace.
 * @returns the listing the tree's face performs.
 */
export function createList(remote: WorkspaceFilesListRemote): ListWorkspaceDirectory {
  return async (sessionId, path, signal) => {
    const result = await remote.workspaceFiles.list(sessionId, path, signal)
    if (!result.ok) return result
    return { ok: true, value: { entries: result.value.entries, truncated: result.value.truncated } }
  }
}

/**
 * The absolute path of one child entry.
 *
 * Joined with `/` whatever the parent's separators: the Host resolves mixed
 * separators, and the tree only needs a stable key.
 * @param parent - absolute path of the listed directory.
 * @param name - the entry's basename.
 * @returns the child's absolute path.
 */
export function childPath(parent: string, name: string): string {
  return `${parent.replace(/[/\\]+$/, '')}/${name}`
}

/** The tree's injected business face, as the body receives it. */
export interface FilesInjected {
  /**
   * Seed one tree and list its root.
   * @param key - the tree being drawn.
   * @param root - absolute path of the workspace root.
   * @param signal - the owner's lifetime.
   */
  readonly start: (key: TreeKey, root: string, signal: AbortSignal) => void
  /**
   * List one directory into the store.
   * @param key - the tree being drawn.
   * @param path - absolute directory path.
   * @param signal - the owner's lifetime.
   */
  readonly load: (key: TreeKey, path: string, signal: AbortSignal) => void
  /**
   * Open or collapse one directory, listing it the first time it opens.
   * @param key - the tree being drawn.
   * @param path - absolute directory path.
   * @param loaded - whether this level already has state.
   * @param signal - the owner's lifetime.
   */
  readonly toggle: (key: TreeKey, path: string, loaded: boolean, signal: AbortSignal) => void
}

/** The explorer column's face: the tree's face plus opening a file into the panes. */
export interface ExplorerInjected extends FilesInjected {
  /**
   * Open one resource address in the sidebar's pane area.
   * @param address - a `dsh-resource://file` address.
   */
  readonly open: (address: string) => void
}

/**
 * Bind the tree's face to one directory listing.
 * @param list - the bound `workspaceFiles.list` call.
 * @returns the Slot `inject` factory: session and bound actions in, face out.
 */
export function filesFace(
  list: ListWorkspaceDirectory,
): (sessionId: SessionId, actions: BoundActions<ReturnType<typeof createFilesStore>>) => FilesInjected {
  return (
    sessionId: SessionId,
    actions: BoundActions<ReturnType<typeof createFilesStore>>,
  ): FilesInjected => {
    /** Per tree, per absolute path: the listing generation a settlement must match; the latest request wins. */
    const generations = new Map<TreeKey, Map<string, number>>()
    const nextGeneration = (key: TreeKey, path: string): number => {
      const byPath = generations.get(key) ?? new Map<string, number>()
      generations.set(key, byPath)
      const generation = (byPath.get(path) ?? 0) + 1
      byPath.set(path, generation)
      return generation
    }
    const load = (key: TreeKey, path: string, signal: AbortSignal): void => {
      if (signal.aborted) return
      const generation = nextGeneration(key, path)
      actions.loading(key, path)
      void list(sessionId, path, signal).then((result) => {
        // A newer listing of this level was asked for since, or the owner is
        // gone and its bookkeeping with it: nothing left for this one to write.
        if (generations.get(key)?.get(path) !== generation) return
        if (result.ok) actions.loaded(key, path, result.value)
        else actions.failed(key, path, result.error)
      })
    }
    return {
      start(key, root, signal) {
        actions.start(key, root)
        signal.addEventListener('abort', () => {
          generations.delete(key)
          actions.forget(key)
        }, { once: true })
        load(key, root, signal)
      },
      load,
      toggle(key, path, loaded, signal) {
        actions.toggled(key, path)
        if (!loaded) load(key, path, signal)
      },
    }
  }
}

/**
 * Bind the explorer column's face: the tree's face for the session-keyed tree,
 * plus the opener that lands a clicked file in the sidebar's pane area.
 * @param list - the bound `workspaceFiles.list` call.
 * @param open - the sidebar resource opener, aimed at the mounted session.
 * @returns the Slot `inject` factory: session and bound actions in, face out.
 */
export function explorerFace(
  list: ListWorkspaceDirectory,
  open: (address: string) => void,
): (sessionId: SessionId, actions: BoundActions<ReturnType<typeof createFilesStore>>) => ExplorerInjected {
  return (sessionId, actions) => ({ ...filesFace(list)(sessionId, actions), open })
}
