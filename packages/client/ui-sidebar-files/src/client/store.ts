/**
 * The file tree's view state: which directories are expanded, and what each
 * loaded level contains.
 *
 * The tree is not one resource. A directory listing per level, expanded lazily,
 * is state the type owns — so it lives in a Slot-standard exclusive store
 * (one instance per session), bucketed by the tree's owner: a tab id for tabs
 * of this kind, which expand independently, or the session id itself for the
 * explorer column drawn beside the sidebar's panes.
 *
 * Writers run between `start` and `forget`: the owner's `signal` is what ends a
 * bucket's life, and the face stops dispatching once it aborts.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceDirectoryEntry } from '@deepseek-ai/dsh-api-workspace-files/types'

/** One tree's key: a tab id for a files tab, the session id for the explorer column. */
export type TreeKey = TabId | SessionId

/**
 * One directory's contents, as one expanded level of the tree.
 *
 * The endpoint's listing also names the directory as a workspace-relative path;
 * the tree keys every level by absolute path instead, so the adapter drops it.
 */
export interface DirLevel {
  /** The directory's entries, in the endpoint's order. */
  readonly entries: readonly WorkspaceDirectoryEntry[]
  /** The listing hit the endpoint's entry cap, so entries are missing. */
  readonly truncated: boolean
}

/** What one directory level is doing right now. */
export type LevelState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly level: DirLevel }
  | { readonly kind: 'failed'; readonly failure: RemoteFailure }

/**
 * One tree: its root, the levels it has asked for, and what is open.
 *
 * Every path here is absolute: the root is the session's working directory as
 * the Host reports it, and a child is the parent joined with the entry name.
 */
export interface FilesTabState {
  /** Absolute path of the workspace root this tree is rooted at. */
  root: string
  /** Level state by absolute directory path; a path absent here was never asked for. */
  levels: Record<string, LevelState>
  /** Expanded absolute directory paths, root included. */
  expanded: string[]
  /** Row the reveal gesture currently highlights; null outside one. */
  highlighted: string | null
}

/** Every tree, keyed by its owner id. */
export interface FilesState {
  byTree: Record<TreeKey, FilesTabState>
}

/**
 * One tree's bucket, which every writer after `start` relies on: the face only
 * dispatches while the owner's signal is live, and `forget` runs on its abort.
 * @param state - the draft.
 * @param key - the tree being written.
 * @returns the tree.
 */
function bucket(state: FilesState, key: TreeKey): FilesTabState {
  const tree = state.byTree[key]
  if (tree === undefined) throw new Error(`ui-sidebar-files: no tree for "${key}"`)
  return tree
}

/** The tree store's write set; every action names the tree it writes. */
type FilesActions = {
  start: (draft: FilesState, key: TreeKey, root: string) => void
  loading: (draft: FilesState, key: TreeKey, path: string) => void
  loaded: (draft: FilesState, key: TreeKey, path: string, level: DirLevel) => void
  failed: (draft: FilesState, key: TreeKey, path: string, failure: RemoteFailure) => void
  toggled: (draft: FilesState, key: TreeKey, path: string) => void
  expandedPaths: (draft: FilesState, key: TreeKey, paths: readonly string[]) => void
  highlightedSet: (draft: FilesState, key: TreeKey, path: string) => void
  highlightedClear: (draft: FilesState, key: TreeKey, path: string) => void
  reset: (draft: FilesState, key: TreeKey) => void
  forget: (draft: FilesState, key: TreeKey) => void
}

/**
 * Declare the file tree's store.
 *
 * A factory rather than a shared handle: the registrations declare it as an
 * exclusive store, so the framework mints one instance per session, shared by
 * the tab type and the explorer column.
 * @returns the store handle to declare on the registration.
 */
export function createFilesStore(): EngineStoreHandle<FilesState, FilesActions> {
  return defineStore({
    init: (): FilesState => ({ byTree: {} }),
    actions: {
      /**
       * Seed one tree at its workspace root, with the root expanded.
       * @param d - draft state.
       * @param key - the tree being drawn.
       * @param root - absolute path of the workspace root.
       */
      start: (d, key: TreeKey, root: string) => {
        d.byTree[key] = { root, levels: {}, expanded: [root], highlighted: null }
      },
      /**
       * Mark one directory as being listed. A level that already shows rows
       * keeps them while a re-ask is in flight, so the reveal's refresh of a
       * listed ancestor swaps in the new listing on settlement instead of
       * flashing loading rows.
       * @param d - draft state.
       * @param key - the tree being drawn.
       * @param path - absolute directory path.
       */
      loading: (d, key, path) => {
        const state = bucket(d, key)
        if (state.levels[path]?.kind !== 'ready') state.levels[path] = { kind: 'loading' }
      },
      /**
       * Record one directory's contents.
       * @param d - draft state.
       * @param key - the tree being drawn.
       * @param path - absolute directory path.
       * @param level - the listing to show under it.
       */
      loaded: (d, key: TreeKey, path: string, level: DirLevel) => {
        bucket(d, key).levels[path] = { kind: 'ready', level }
      },
      /**
       * Record why one directory could not be listed.
       * @param d - draft state.
       * @param key - the tree being drawn.
       * @param path - absolute directory path.
       * @param failure - the settled Remote failure.
       */
      failed: (d, key: TreeKey, path: string, failure: RemoteFailure) => {
        bucket(d, key).levels[path] = { kind: 'failed', failure }
      },
      /**
       * Open a collapsed directory, or collapse an open one.
       *
       * A collapsed level keeps what it loaded, so reopening it draws at once.
       * @param d - draft state.
       * @param key - the tree being drawn.
       * @param path - absolute directory path.
       */
      toggled: (d, key: TreeKey, path: string) => {
        const state = bucket(d, key)
        const at = state.expanded.indexOf(path)
        if (at >= 0) state.expanded.splice(at, 1)
        else state.expanded.push(path)
      },
      /**
       * Expand directories without collapsing any of them, for the reveal
       * gesture; a tree `start` has not seeded is left alone, so a reveal that
       * reaches an unmounted column is a no-op, not a thrown write.
       * @param d - draft state.
       * @param key - the tree being written.
       * @param paths - absolute directory paths to leave expanded.
       */
      expandedPaths: (d, key, paths) => {
        const state = d.byTree[key]
        if (state === undefined) return
        for (const path of paths) if (!state.expanded.includes(path)) state.expanded.push(path)
      },
      /**
       * Highlight one row as the reveal target.
       * @param d - draft state.
       * @param key - the tree being written.
       * @param path - absolute path of the revealed file.
       */
      highlightedSet: (d, key, path) => {
        const state = d.byTree[key]
        if (state !== undefined) state.highlighted = path
      },
      /**
       * Drop one highlight once its moment passes; a newer reveal keeps its own.
       * @param d - draft state.
       * @param key - the tree being written.
       * @param path - the highlighted path the timer expired for.
       */
      highlightedClear: (d, key, path) => {
        const state = d.byTree[key]
        if (state !== undefined && state.highlighted === path) state.highlighted = null
      },
      /**
       * Drop every loaded level, keeping what is expanded.
       *
       * This is the reload gesture's first half: the expanded set says which
       * levels to fetch again.
       * @param d - draft state.
       * @param key - the tree being drawn.
       */
      reset: (d, key: TreeKey) => {
        bucket(d, key).levels = {}
      },
      /**
       * Forget one tree whose owner is gone.
       * @param d - draft state.
       * @param key - the tree that went away.
       */
      forget: (d, key: TreeKey) => {
        d.byTree = Object.fromEntries(Object.entries(d.byTree).filter(([id]) => id !== key))
      },
    },
  })
}
