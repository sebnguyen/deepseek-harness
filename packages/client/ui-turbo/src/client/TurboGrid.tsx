/**
 * The Turbo tiling surface. One shared sidebar sits beside a react-mosaic
 * canvas; each leaf is a stable cell pinned to at most one Session. Layout
 * state is the Mosaic tree; cell assignments live in a separate id map so a
 * drag/reorder/remove never has to remap Session ownership.
 */
import { memo, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import {
  getLeaves, Mosaic, MosaicContext, MosaicWindow, MosaicWindowContext,
} from 'react-mosaic-component'
import type { MosaicNode } from 'react-mosaic-component'
import './react-mosaic.css'
import { Button, DigitalOceanLogo, IconRefreshOutline16, IconWarningOutline16, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TurboModeInjected } from './contract.ts'
import {
  appendCell, dividerSplitPaths, dropPosition, insertCell, rebalanceSplit, removeCells,
  type CellId, type DropPosition,
} from './surface.ts'
import css from './TurboGrid.module.css'

type Runtime = PropsRuntime<'layout.mode.entry'>
type RenderSlots = PropsRenderSlots<never>
type PinnedSeat = RenderSlots['PinnedSessionProvider']

const INITIAL_CELL: CellId = 'cell-1'

/** Props the Mosaic surface consumes from the mode and its inject face. */
export type TurboGridProps =
  & Omit<TurboModeInjected, 'hooks'>
  & PropsLocale<'turbo'>
  & {
    renderConversation: Runtime['renderConversation']
    renderSidebar: Runtime['renderSidebar']
    useSessions: Runtime['useSessions']
    PinnedSessionProvider: PinnedSeat
  }

/** Render the shared sidebar and the tiling canvas. */
export function TurboGrid({
  renderConversation, renderSidebar, useSessions, PinnedSessionProvider,
  createSession, openSession, clearSession, retainSession, t,
}: TurboGridProps) {
  const sessions = useSessions(state => state)
  const [tree, setTree] = useState<MosaicNode<CellId> | null>(INITIAL_CELL)
  const [cells, setCells] = useState<Map<CellId, SessionId | undefined>>(
    () => new Map([[INITIAL_CELL, sessions.current as SessionId | undefined]]),
  )
  // The blank-append effect must see assignments written earlier in the same
  // tick; session-store notifications can render before React commits setCells.
  const cellsRef = useRef(cells)
  const writeCells = useCallback((next: Map<CellId, SessionId | undefined>): void => {
    cellsRef.current = next
    setCells(next)
  }, [])
  const nextCell = useRef(2)
  const [busy, setBusy] = useState(false)
  // The seq keys the shared banner, so repeating the same refusal replays it
  // instead of leaving the first one silently in place.
  const toastSeq = useRef(0)
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const showToast = useCallback((text: string): void => {
    toastSeq.current += 1
    setToast({ seq: toastSeq.current, text })
  }, [])
  // Stable identity: Toast restarts its lifetime whenever onDone changes, and
  // this grid re-renders on every session-store notification.
  const dismissToast = useCallback((): void => { setToast(null) }, [])
  const [dropTarget, setDropTarget] = useState<{ cellId: CellId; position: DropPosition } | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)

  const cellId = useCallback((): CellId => `cell-${nextCell.current++}`, [])

  const addCell = useCallback((sessionId?: SessionId): CellId => {
    const id = cellId()
    writeCells(new Map(cellsRef.current).set(id, sessionId))
    return id
  }, [cellId, writeCells])

  const createNode = useCallback((): CellId => addCell(), [addCell])

  const appendSessionCell = useCallback((sessionId: SessionId) => {
    const id = cellId()
    writeCells(new Map(cellsRef.current).set(id, sessionId))
    setTree(current => appendCell(current, id))
  }, [cellId, writeCells])

  // The shared sidebar's New Session action creates or reuses a blank Session
  // and makes it current. Give an unassigned blank Session a cell once; a
  // non-blank row selected in the sidebar is not auto-appended (drag it in).
  useEffect(() => {
    if (sessions.phase !== 'ready' || sessions.current === undefined) return
    const current = sessions.current as SessionId
    if ([...cellsRef.current.values()].includes(current)) return
    const summary = sessions.byId[current] as { blank?: boolean } | undefined
    if (summary?.blank === true) appendSessionCell(current)
  }, [appendSessionCell, sessions.byId, sessions.current, sessions.phase])

  const newSessionForCell = useCallback(async (target: CellId): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const source = cellsRef.current.get(target)
      const created = await createSession(source === undefined ? undefined : { sourceSessionId: source })
      writeCells(new Map(cellsRef.current).set(target, created))
      openSession(created)
    } catch {
      showToast(t('error.create'))
    } finally {
      setBusy(false)
    }
  }, [busy, createSession, openSession, showToast, t, writeCells])

  // Void adapter: the prop is a click handler, and an async function here trips
  // the lint rule even though React would ignore the returned promise.
  const createSessionInCell = useCallback((target: CellId): void => {
    void newSessionForCell(target)
  }, [newSessionForCell])

  const newSessionAndCell = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const created = await createSession()
      const id = addCell(created)
      setTree(current => appendCell(current, id))
      openSession(created)
    } catch {
      showToast(t('error.create'))
    } finally {
      setBusy(false)
    }
  }

  const changeTree = (next: MosaicNode<CellId> | null, meta?: { type: string; node?: MosaicNode<CellId> }): void => {
    if (meta?.type === 'remove' && meta.node !== undefined) {
      const current = sessions.current
      const summary = current === undefined
        ? undefined
        : sessions.byId[current] as { blank?: boolean } | undefined
      const removal = removeCells(cellsRef.current, getLeaves(meta.node), current, summary?.blank === true)
      if (removal.clearsCurrent) clearSession()
      writeCells(removal.cells)
    }
    setTree(next)
  }

  // A divider's DOM position matches the order MosaicRoot renders dividers, so
  // the clicked split is looked up by index in this layout's divider paths.
  const rebalanceAt = useCallback((handle: HTMLElement): void => {
    const split = handle.closest('.mosaic-split')
    const root = canvasRef.current?.querySelector('.mosaic-root')
    if (split === null || !root || !root.contains(split)) return
    const index = Array.from(root.querySelectorAll('.mosaic-split')).indexOf(split)
    setTree((prev) => {
      const path = dividerSplitPaths(prev)[index]
      return path === undefined ? prev : rebalanceSplit(prev, path)
    })
  }, [])

  const dropSession = (target: CellId, sessionId: SessionId, position: DropPosition): void => {
    if ([...cellsRef.current.values()].includes(sessionId)) {
      showToast(t('notice.duplicate'))
      openSession(sessionId)
      return
    }
    if (cellsRef.current.get(target) === undefined) {
      writeCells(new Map(cellsRef.current).set(target, sessionId))
      openSession(sessionId)
      return
    }
    const id = addCell(sessionId)
    setTree(current => insertCell(current, target, id, position))
    openSession(sessionId)
  }

  const titleOf = (target: CellId): string => {
    const sessionId = cells.get(target)
    if (sessionId === undefined) return t('cell.empty.title')
    const summary = sessions.byId[sessionId] as { displayTitle?: string; title?: string } | undefined
    return summary?.displayTitle ?? summary?.title ?? t('cell.empty.title')
  }

  const dragOver = (event: DragEvent<HTMLDivElement>, target: CellId): void => {
    if (!event.dataTransfer.types.includes('text/plain')) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    setDropTarget({ cellId: target, position: dropPosition(rect, event.clientX, event.clientY) })
  }

  const drop = (event: DragEvent<HTMLDivElement>, target: CellId): void => {
    const sessionId = event.dataTransfer.getData('text/plain')
    if (sessionId === '') return
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    dropSession(target, sessionId as SessionId, dropPosition(rect, event.clientX, event.clientY))
    setDropTarget(null)
  }

  const zeroState = (
    <div className={css.zero}>
      <DigitalOceanLogo size={48} className={css.emptyMark} />
      <span className={css.emptyTitle}>{t('cell.empty.title')}</span>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => { void newSessionAndCell() }}>
        {t('cell.empty.action')}
      </Button>
    </div>
  )

  return (
    <div className={css.root}>
      <div className={css.sidebar}>{renderSidebar()}</div>
      <div className={css.canvas} ref={canvasRef}>
        <Mosaic<CellId>
          className={css.mosaic ?? ''}
          value={tree}
          onChange={changeTree}
          createNode={createNode}
          zeroStateView={zeroState}
          resize={{
            minimumPaneSizePx: { row: 300, column: 220 },
            preview: true,
            renderSplitHandle: () => (
              <RebalanceHandle label={t('split.rebalance')} onRebalance={rebalanceAt} />
            ),
          }}
          renderTile={(target, path) => {
            const current = dropTarget?.cellId === target ? dropTarget.position : undefined
            return (
              <div
                className={css.tile}
                data-cell={target}
                data-drop={current}
                onDragOver={(event) => { dragOver(event, target) }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null)
                }}
                onDrop={(event) => { drop(event, target) }}
              >
                <MosaicWindow<CellId>
                  path={path}
                  title={titleOf(target)}
                  createNode={createNode}
                  toolbarControls={<CellControls />}
                >
                  <CellBody
                    cellId={target}
                    sessionId={cells.get(target)}
                    renderConversation={renderConversation}
                    PinnedSessionProvider={PinnedSessionProvider}
                    retainSession={retainSession}
                    onNew={createSessionInCell}
                    busy={busy}
                    t={t}
                  />
                </MosaicWindow>
              </div>
            )
          }}
        />
        {toast !== null && (
          <Toast
            key={toast.seq}
            text={toast.text}
            icon={<IconWarningOutline16 />}
            onDone={dismissToast}
          />
        )}
      </div>
    </div>
  )
}

/** Native controls inside the library-owned draggable toolbar. */
function CellControls() {
  const windowActions = useContext(MosaicWindowContext).mosaicWindowActions
  const rootActions = useContext(MosaicContext).mosaicActions
  const path = windowActions.getPath()
  return (
    <div className={css.controls}>
      <button
        type="button"
        className={css.controlButton}
        onClick={() => { void windowActions.split() }}
      >Split</button>
      <button
        type="button"
        className={css.controlButton}
        aria-label="Close cell"
        onClick={() => rootActions.remove(path)}
      >×</button>
    </div>
  )
}

/** Round control centered on a split border; clicking it equalises that split. */
function RebalanceHandle({ label, onRebalance }: {
  label: string
  onRebalance: (handle: HTMLElement) => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  // The split starts a touch drag from a native listener on its bar; stop the
  // gesture at the button so a tap stays a tap.
  useEffect(() => {
    const handle = ref.current
    if (handle === null) return
    const stop = (event: Event): void => { event.stopPropagation() }
    handle.addEventListener('touchstart', stop)
    return () => { handle.removeEventListener('touchstart', stop) }
  }, [])
  return (
    <button
      ref={ref}
      type="button"
      className={css.rebalance}
      aria-label={label}
      title={label}
      onMouseDown={(event) => { event.stopPropagation() }}
      onClick={(event) => { event.stopPropagation(); onRebalance(event.currentTarget) }}
    >
      <IconRefreshOutline16 size={12} />
    </button>
  )
}

/** Memoized so a session-store notification re-renders the grid chrome without
 * re-rendering every mounted conversation: a cell only changes when its own
 * assignment or busy state changes. */
const CellBody = memo(function CellBody({
  cellId, sessionId, renderConversation, PinnedSessionProvider, retainSession, onNew, busy, t,
}: {
  cellId: CellId
  sessionId: SessionId | undefined
  renderConversation: () => ReactNode
  PinnedSessionProvider: PinnedSeat
  retainSession: (id: SessionId) => () => void
  onNew: (cellId: CellId) => void
  busy: boolean
  t: (key: 'cell.empty.title' | 'cell.empty.action') => string
}) {
  useEffect(() => sessionId === undefined ? undefined : retainSession(sessionId), [retainSession, sessionId])
  if (sessionId === undefined) {
    return (
      <div className={css.empty} data-cell-body data-cell={cellId}>
        <DigitalOceanLogo size={48} className={css.emptyMark} />
        <span className={css.emptyTitle}>{t('cell.empty.title')}</span>
        <button type="button" className={css.emptyButton} disabled={busy} onClick={() => { onNew(cellId) }}>
          {t('cell.empty.action')}
        </button>
      </div>
    )
  }
  return (
    <div className={css.conversation} data-cell-body data-cell={cellId}>
      {PinnedSessionProvider === undefined
        ? renderConversation()
        : <PinnedSessionProvider sessionId={sessionId}>{renderConversation()}</PinnedSessionProvider>}
    </div>
  )
})
