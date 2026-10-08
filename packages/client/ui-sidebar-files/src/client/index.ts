/**
 * Browser half: register `files` as a right-Sidebar tab type, and the session's
 * persistent explorer column beside the Sidebar's panes.
 *
 * The public two-stage path, unmodified: the type into `ctx.sidebarRightTabs`,
 * the body into the keyed `sidebar.right.pane.tab` seat and the chip title into
 * the keyed `sidebar.right.pane.tab.title` seat, both under the type's `id`.
 * The explorer registers into the sidebar's `sidebar.right.explorer` seat and
 * shares the tree store the tab type uses, keyed by session instead of tab.
 *
 * The file split is this package's layering: what the type IS
 * (`definition.tsx`), what it keeps (`store.ts`), how it lists (`face.ts`), how
 * a reveal is asked (`reveal.ts`), the shared rows (`Tree.tsx`), what the tab
 * draws (`FilesBody.tsx`, `FilesTitle.tsx`), what the column draws
 * (`ExplorerBody.tsx`), what it says
 * (`locales.ts`), and this module, which only wires them together.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { } from '@deepseek-ai/dsh-api-remotes/client'
import type { } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { } from '@deepseek-ai/dsh-client-ui-session/client'
import type { } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { FILES_ID, filesDefinition } from './definition.tsx'
import { createList, explorerFace, filesFace } from './face.ts'
import { FilesBody } from './FilesBody.tsx'
import { FilesTitle } from './FilesTitle.tsx'
import { ExplorerBody } from './ExplorerBody.tsx'
import { en, zh } from './locales.ts'
import { createRevealChannel, type ISidebarFilesExtensions } from './reveal.ts'
import { createFilesStore } from './store.ts'

export type { SidebarFilesKey } from './locales.ts'
export type { DirLevel, FilesState, FilesTabState, LevelState, TreeKey } from './store.ts'
export type { ExplorerInjected, FilesInjected, ListWorkspaceDirectory, WorkspaceFilesListRemote } from './face.ts'
export type { FilesBodyProps } from './FilesBody.tsx'
export type { ExplorerBodyProps } from './ExplorerBody.tsx'
export type { FilesRevealChannel, FilesRevealRequest, ISidebarFilesExtensions } from './reveal.ts'

/** This package's copy namespace. */
const NS = 'sidebarFiles'

/**
 * Required browser services: the tab registry, the navigation face, the keyed
 * and explorer seats, the Remote carrier and its namespace, and copy.
 */
export const inject = [
  'slots',
  'locale',
  'sidebarRightTabs',
  'sidebarRight',
  'remote',
  'remote.workspaceFiles',
]

/**
 * Client plugin body: register the type, its dictionaries, its body, its chip
 * title, and the explorer column over one shared tree store.
 * @param ctx - client root context carrying the registry, the slots, and the Remote face.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.sidebarRightTabs.register(filesDefinition(t)), 'ui-sidebar-files: files type')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar-files: dictionaries')

  const store = createFilesStore()
  const inject = filesFace(createList(ctx.remote))
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: FILES_ID, locale: NS, store, inject },
    FilesBody,
  )), 'ui-sidebar-files: files tab body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab.title', key: FILES_ID },
    FilesTitle,
  )), 'ui-sidebar-files: files tab title')
  const reveals = createRevealChannel()
  const explorerInject = explorerFace(
    createList(ctx.remote),
    (address) => { ctx.sidebarRight.openResource(address) },
    reveals,
  )
  ctx.effect(() => ctx.slots.inject('sidebar.right.explorer', () => ctx.slots.register(
    { name: 'sidebar.right.explorer', locale: NS, store, inject: explorerInject },
    ExplorerBody,
  )), 'ui-sidebar-files: explorer column')
  const extensions: ISidebarFilesExtensions = {
    revealIn: (sessionId, path) => { reveals.request({ sessionId, path }) },
  }
  ctx.effect(() => ctx.reflect.provide('sidebarFilesExtensions', extensions),
    'ui-sidebar-files: explorer reveal face')
}
