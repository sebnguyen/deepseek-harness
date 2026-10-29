/**
 * The Turbo tiling surface. One shared sidebar sits beside a react-mosaic
 * canvas; each leaf is a stable cell pinned to at most one Session. Layout
 * state is the Mosaic tree; cell assignments live in a separate id map so a
 * drag/reorder/remove never has to remap Session ownership.
 */
import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import {
  getLeaves, Mosaic, MosaicContext, MosaicWindow, MosaicWindowContext,
} from 'react-mosaic-component'
import type { MosaicNode } from 'react-mosaic-component'
import './react-mosaic.css'
import { Button, DigitalOceanLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TurboModeInjected } from './contract.ts'
import { appendCell, dropPosition, insertCell, type CellId, type DropPosition } from './surface.ts'
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
  createSession, openSession, retainSession, t,
}: TurboGridProps) {
  const sessions = useSessions(state => state)
  const [tree, setTree] = useState<MosaicNode<CellId> | null>(INITIAL_CELL)
  const [cells, setCells] = useState<Map<CellId, SessionId | undefined>>(
    () => new Map([[INITIAL_CELL, sessions.current as SessionId | undefined]]),
  )
  const nextCell = useRef(2)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ cellId: CellId; position: DropPosition } | null>(null)

  const cellId = useCallback((): CellId => `cell-${nextCell.current++}`, [])

  const addCell = useCallback((sessionId?: SessionId): CellId => {
    const id = cellId()
    setCells(current => new Map(current).set(id, sessionId))
    return id
  }, [cellId])

  const createNode = useCallback((): CellId => addCell(), [addCell])

  const appendSessionCell = useCallback((sessionId: SessionId) => {
    const id = cellId()
    setCells(current => new Map(current).set(id, sessionId))
    setTree(current => appendCell(current, id))
  }, [cellId])

  // The shared sidebar's New Session action creates or reuses a blank Session
  // and makes it current. Give an unassigned blank Session a cell once; a
  // non-blank row selected in the sidebar is not auto-appended (drag it in).
  useEffect(() => {
    if (sessions.phase !== 'ready' || sessions.current === undefined) return
    const current = sessions.current as SessionId
    if ([...cells.values()].includes(current)) return
    const summary = sessions.byId[current] as { blank?: boolean } | undefined
    if (summary?.blank === true) appendSessionCell(current)
  }, [appendSessionCell, cells, sessions.byId, sessions.current, sessions.phase])

  const newSessionForCell = async (target: CellId): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const source = cells.get(target)
      const created = await createSession(source === undefined ? undefined : { sourceSessionId: source })
      setCells(current => new Map(current).set(target, created))
      openSession(created)
    } catch {
      setNotice(t('error.create'))
    } finally {
      setBusy(false)
    }
  }

  const newSessionAndCell = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const created = await createSession()
      const id = addCell(created)
      setTree(current => appendCell(current, id))
      openSession(created)
    } catch {
      setNotice(t('error.create'))
    } finally {
      setBusy(false)
    }
  }

  const changeTree = (next: MosaicNode<CellId> | null, meta?: { type: string; node?: MosaicNode<CellId> }): void => {
    if (meta?.type === 'remove' && meta.node !== undefined) {
      const removed = new Set(getLeaves(meta.node))
      setCells((current) => {
        const following = new Map(current)
        for (const id of removed) following.delete(id)
        return following
      })
    }
    setTree(next)
  }

  const dropSession = (target: CellId, sessionId: SessionId, position: DropPosition): void => {
    if ([...cells.values()].includes(sessionId)) {
      setNotice(t('notice.duplicate'))
      openSession(sessionId)
      return
    }
    if (cells.get(target) === undefined) {
      setCells(current => new Map(current).set(target, sessionId))
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
      <div className={css.canvas}>
        <Mosaic<CellId>
          className={css.mosaic ?? ''}
          value={tree}
          onChange={changeTree}
          createNode={createNode}
          zeroStateView={zeroState}
          resize={{ minimumPaneSizePx: { row: 300, column: 220 }, preview: true }}
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
                    onNew={() => { void newSessionForCell(target) }}
                    busy={busy}
                    t={t}
                  />
                </MosaicWindow>
              </div>
            )
          }}
        />
        {notice !== null && <div className={css.notice} role="status">{notice}</div>}
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

function CellBody({
  cellId, sessionId, renderConversation, PinnedSessionProvider, retainSession, onNew, busy, t,
}: {
  cellId: CellId
  sessionId: SessionId | undefined
  renderConversation: () => ReactNode
  PinnedSessionProvider: PinnedSeat
  retainSession: (id: SessionId) => () => void
  onNew: () => void
  busy: boolean
  t: (key: 'cell.empty.title' | 'cell.empty.action') => string
}) {
  useEffect(() => sessionId === undefined ? undefined : retainSession(sessionId), [retainSession, sessionId])
  if (sessionId === undefined) {
    return (
      <div className={css.empty} data-cell-body data-cell={cellId}>
        <DigitalOceanLogo size={48} className={css.emptyMark} />
        <span className={css.emptyTitle}>{t('cell.empty.title')}</span>
        <button type="button" className={css.emptyButton} disabled={busy} onClick={onNew}>
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
}
