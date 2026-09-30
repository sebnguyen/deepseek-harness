/**
 * The file tree tab's body: the session's workspace root, listed one level at
 * a time.
 *
 * Everything the tree keeps lives in its store, keyed by tab; everything it asks
 * for goes through its injected face. The component itself only decides the
 * chrome — the header row with the root's path and the reload control — and
 * what a click means: a directory toggles, a file opens through the owner's
 * `tabActions` for a `file:` viewer to claim, and anything else is shown but
 * refuses to open. The rows themselves are the shared tree (`Tree.tsx`), which
 * the explorer column draws too.
 */
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { fileAddressFor, pathPartsOf } from '@deepseek-ai/dsh-util-workspace-path'
import type {} from './locales.ts'
import type { FilesInjected } from './face.ts'
import { TreeList, type TreeContext } from './Tree.tsx'
import type { createFilesStore } from './store.ts'
import css from './FilesBody.module.css'

/** The body's composed props: the tab it draws, its store, its face, and its copy. */
export type FilesBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsStore<ReturnType<typeof createFilesStore>>
  & FilesInjected
  & PropsLocale<'sidebarFiles'>

/* jscpd:ignore-start -- the header row is the document preview's (ui-sidebar-documentpreview
   TextPreview `usePathClipped`), copied because a plugin bundle shares runtime code
   only through the platform modules. TODO: once the artifact and slot surfaces
   settle, one copy in ui-primitives could serve every pane header. */
/**
 * Keep the path row's `data-files-path-clipped` current: set while the path's
 * text is wider than its box, so the stylesheet fades the clipped start. Read
 * after each commit that can change the path or mount the header, and whenever
 * either box resizes; written to the DOM directly because it changes only how
 * the stylesheet fades what is already rendered.
 */
function usePathClipped(
  box: RefObject<HTMLDivElement | null>,
  text: RefObject<HTMLSpanElement | null>,
  path: string | undefined,
): void {
  useLayoutEffect(() => {
    const outer = box.current
    const inner = text.current
    if (outer === null || inner === null) return undefined
    const apply = (): void => {
      if (inner.offsetWidth > outer.clientWidth) outer.dataset.filesPathClipped = ''
      else delete outer.dataset.filesPathClipped
    }
    apply()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(apply)
    observer?.observe(outer)
    observer?.observe(inner)
    return () => { observer?.disconnect() }
  }, [box, text, path])
}
/* jscpd:ignore-end */

/** The file tree's body: the workspace root and whatever the reader has opened under it. */
export function FilesBody({
  useTabInfo, sessionId, useSessions, useStore, actions, start, load, toggle, t,
}: FilesBodyProps): ReactNode {
  const { tab } = useTabInfo()
  const { signal, actions: tabActions } = tab
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
  const state = useStore(store => store.byTree[tab.id])
  const pathRef = useRef<HTMLDivElement>(null)
  const pathTextRef = useRef<HTMLSpanElement>(null)
  usePathClipped(pathRef, pathTextRef, state?.root)
  useEffect(() => {
    // A bucket gone because the record aborted must not be re-seeded by a
    // component that has not unmounted yet.
    if (state !== undefined || cwd === undefined || signal.aborted) return
    start(tab.id, cwd, signal)
  }, [state, cwd, tab.id, signal, start])

  if (cwd === undefined) {
    return (
      <div className={css.status} data-files-state="no-workspace">
        <p className={css.statusLine}>{t('noWorkspace')}</p>
      </div>
    )
  }
  if (state === undefined) return null
  const tree: TreeContext = {
    state,
    onToggle: (path) => { toggle(tab.id, path, state.levels[path] !== undefined, signal) },
    // Every row is under the tree's root, so its address is session-relative.
    onOpen: (path) => { tabActions.openResource(fileAddressFor(sessionId, state.root, path)) },
    t,
  }
  // Reload drops every level and asks again for the expanded ones; a collapsed
  // level is fetched again the next time it opens.
  const reload = (): void => {
    actions.reset(tab.id)
    for (const path of state.expanded) load(tab.id, path, signal)
  }
  const { directory, name } = pathPartsOf(state.root)
  return (
    <div className={css.root} data-files-state="tree" data-files-root={state.root}>
      {/* jscpd:ignore-start -- the text preview's header row; see `usePathClipped`. */}
      <div className={css.header}>
        <div ref={pathRef} className={css.path} title={state.root} data-files-path>
          <span ref={pathTextRef} className={css.pathText}>
            {directory !== '' && <span className={css.pathDirectory}>{directory}</span>}
            <span className={css.pathName}>{name}</span>
          </span>
        </div>
        <button
          type="button"
          className={css.tool}
          aria-label={t('reload')}
          title={t('reload')}
          data-files-reload
          onClick={reload}
        >
          <IconRefreshOutline16 />
        </button>
      </div>
      {/* jscpd:ignore-end */}
      <div className={css.body}>
        <TreeList root={state.root} tree={tree} />
      </div>
    </div>
  )
}
