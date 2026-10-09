/**
 * The persistent explorer column: the session's workspace root as a compact
 * tree, drawn beside the sidebar's panes for as long as the panel is shown.
 *
 * It is the tree the files tab draws, keyed by the session rather than a tab
 * record, so a file can be opened without first opening the files page and the
 * tree stays traversable beside every preview. Its lifetime is the mount: the
 * column's owner aborts when it unmounts, which forgets the session's bucket.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { fileAddressFor, pathPartsOf } from '@deepseek-ai/dsh-util-workspace-path'
import { ancestorsWithin } from './reveal.ts'
import type {} from './locales.ts'
import type { ExplorerInjected } from './face.ts'
import { TreeList, type TreeContext } from './Tree.tsx'
import type { createFilesStore } from './store.ts'
import css from './ExplorerBody.module.css'

/** The column's composed props: the session it draws, its store, its face, and its copy. */
export type ExplorerBodyProps =
  & PropsRuntime<'sidebar.right.explorer'>
  & PropsStore<ReturnType<typeof createFilesStore>>
  & ExplorerInjected
  & PropsLocale<'sidebarFiles'>

/** How long one reveal keeps its row highlighted. */
const REVEAL_HIGHLIGHT_MS = 2500

/**
 * The explorer column's body: the workspace root's name and reload above the
 * shared tree, a file click opens into the panes beside it, and a reveal
 * request expands and re-lists the file's ancestors and highlights its row.
 */
export function ExplorerBody({
  sessionId, useSessions, useStore, actions, start, load, toggle, reloadScm, open, subscribeReveals, t,
}: ExplorerBodyProps): ReactNode {
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
  const state = useStore(store => store.byTree[sessionId])
  const [signal, setSignal] = useState<AbortSignal | undefined>(undefined)
  useEffect(() => {
    if (cwd === undefined) {
      setSignal(undefined)
      return undefined
    }
    const controller = new AbortController()
    setSignal(controller.signal)
    start(sessionId, cwd, controller.signal)
    return () =>{  controller.abort() }
  }, [sessionId, cwd, start])

  // Reveal requests arrive outside React, so they read the latest tree through
  // a ref the render keeps fresh; the subscription registers once per face.
  const stateRef = useRef(state)
  stateRef.current = state
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const revealFile = (path: string): void => {
    const current = stateRef.current
    if (current === undefined || signal === undefined) return
    const ancestors = ancestorsWithin(current.root, path)
    if (ancestors.length === 0) return
    actions.expandedPaths(sessionId, ancestors)
    // A call may have created files after the column listed a level — the
    // mount-time root listing is the common case — so a reveal re-asks every
    // ancestor that is not still in flight, and the fresh listing makes the
    // highlighted row exist.
    for (const dir of ancestors) {
      if (stateRef.current?.levels[dir]?.kind !== 'loading') load(sessionId, dir, signal)
    }
    actions.highlightedSet(sessionId, path)
    if (highlightTimer.current !== undefined) clearTimeout(highlightTimer.current)
    highlightTimer.current = setTimeout(() => {
      actions.highlightedClear(sessionId, path)
    }, REVEAL_HIGHLIGHT_MS)
  }
  const revealRef = useRef(revealFile)
  revealRef.current = revealFile
  useEffect(() => {
    const unsubscribe = subscribeReveals((path) => { revealRef.current(path) })
    return () => {
      unsubscribe()
      if (highlightTimer.current !== undefined) clearTimeout(highlightTimer.current)
    }
  }, [subscribeReveals])

  if (cwd === undefined) {
    return (
      <div className={css.status} data-files-explorer-state="no-workspace">
        <p className={css.statusLine}>{t('noWorkspace')}</p>
      </div>
    )
  }
  if (state === undefined || signal === undefined) return null
  const tree: TreeContext = {
    state,
    onToggle: (path) => { toggle(sessionId, path, state.levels[path] !== undefined, signal) },
    onOpen: (path) => { open(fileAddressFor(sessionId, state.root, path)) },
    highlighted: state.highlighted ?? undefined,
    t,
  }
  // Reload drops every level and asks again for the expanded ones; a collapsed
  // level is fetched again the next time it opens.
  const reload = (): void => {
    actions.reset(sessionId)
    for (const path of state.expanded) load(sessionId, path, signal)
    reloadScm(sessionId, signal)
  }
  const { name } = pathPartsOf(state.root)
  return (
    <div className={css.root} data-files-explorer-state="tree" data-files-root={state.root} aria-label={t('type.label')}>
      <div className={css.header}>
        <span className={css.title} title={state.root} data-files-explorer-root>{name}</span>
        <button
          type="button"
          className={css.tool}
          aria-label={t('reload')}
          title={t('reload')}
          data-files-explorer-reload
          onClick={reload}
        >
          <IconRefreshOutline16 />
        </button>
      </div>
      <div className={css.body}>
        <TreeList root={state.root} tree={tree} />
      </div>
    </div>
  )
}
