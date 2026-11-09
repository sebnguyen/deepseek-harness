/**
 * Two-session orchestration projection: the shared sidebar, two pinned
 * conversations, and a rail that exposes the direct parent/child relation.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { OrchestrationModeInjected } from './contract.ts'
import type { OrchestrationKey } from './locales.ts'
import { childIds, selectPeers } from './surface.ts'
import css from './OrchestrationMode.module.css'

type Runtime = PropsRuntime<'layout.mode.entry'>
type Slots = PropsRenderSlots<never>
type PinnedSeat = Slots['PinnedSessionProvider']
type SessionRow = SessionListState['byId'][SessionId]

type OrchestrationModeProps =
  & Runtime
  & Slots
  & InjectFace<OrchestrationModeInjected>
  & PropsLocale<'orchestration'>

/** Render the two-session projection. */
export function OrchestrationMode({
  renderConversation, renderSidebar, useSessions, PinnedSessionProvider,
  openSession, createSession, retainSession, refreshSubagents, t,
}: OrchestrationModeProps) {
  const state = useSessions(value => value)
  const peers = selectPeers(state)
  const first = peers.first
  const second = peers.second
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ids = [first, second].filter((id): id is SessionId => id !== undefined)
    const disposers = [...new Set(ids)].map(id => retainSession(id))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, [first, second, retainSession])

  useEffect(() => {
    if (first !== undefined) refreshSubagents(first)
  }, [first, refreshSubagents])

  const createAndOpen = async (): Promise<void> => {
    if (creating) return
    setCreating(true)
    setError(null)
    try {
      openSession(await createSession())
    } catch {
      setError(t('error.create'))
    } finally {
      setCreating(false)
    }
  }

  const firstRow = first === undefined ? undefined : state.byId[first]
  const secondRow = second === undefined ? undefined : state.byId[second]
  const entries = first === undefined ? [] : state.subagentsByParent[first]?.entries ?? []
  const children = first === undefined ? [] : childIds(state, first)

  return (
    <div className={css.root}>
      <aside className={css.sidebar}>{renderSidebar()}</aside>
      <main className={css.main}>
        <header className={css.head}>
          <div>
            <span className={css.eyebrow}>{t('mode.eyebrow')}</span>
            <h1 className={css.title}>{t('mode.title')}</h1>
            <p className={css.body}>{t('mode.body')}</p>
          </div>
          <span className={css.badge} data-linked={peers.linked ? 'true' : 'false'}>
            {peers.linked ? t('handoff.linked') : t('handoff.independent')}
          </span>
        </header>

        {error !== null && <p className={css.error} role="alert">{error}</p>}

        {first === undefined
          ? (
            <div className={css.empty}>
              <h2 className={css.emptyTitle}>{t('empty.title')}</h2>
              <p className={css.emptyBody}>{t('empty.body')}</p>
              <button
                type="button"
                className={css.emptyAction}
                disabled={creating}
                onClick={() => { void createAndOpen() }}
              >
                {t('empty.new')}
              </button>
            </div>
          )
          : (
            <div className={css.board}>
              <Pane
                role="a"
                label={t('peer.a')}
                sessionId={first}
                row={firstRow}
                renderConversation={renderConversation}
                PinnedSessionProvider={PinnedSessionProvider}
                t={t}
              />

              <aside className={css.handoff}>
                <span className={css.handoffArrow} aria-hidden="true">⇄</span>
                <span className={css.handoffTitle}>{t('handoff.title')}</span>
                <p className={css.handoffText}>
                  {peers.linked ? t('handoff.linked') : t('handoff.independent')}
                </p>
                {children.length === 0
                  ? (
                    <div className={css.handoffEmpty}>
                      <span>{t('handoff.empty')}</span>
                      <small>{t('handoff.hint')}</small>
                    </div>
                  )
                  : (
                    <div className={css.handoffList}>
                      {children.map((id) => {
                        const entry = entries.find(item => item.kind === 'child' && item.id === id)
                        return (
                          <button
                            key={id}
                            type="button"
                            className={css.handoffItem}
                            data-session={id}
                            onClick={() => { openSession(id) }}
                          >
                            <span className={css.handoffLabel}>
                              {entry?.kind === 'child' ? entry.label ?? id : id}
                            </span>
                            <span className={css.handoffMeta}>
                              {entry?.kind === 'child' ? `${entry.mode} · ${entry.activity}` : ''}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
              </aside>

              <Pane
                role="b"
                label={t('peer.b')}
                sessionId={second}
                row={secondRow}
                renderConversation={renderConversation}
                PinnedSessionProvider={PinnedSessionProvider}
                t={t}
                onCreate={createAndOpen}
                creating={creating}
              />
            </div>
          )}
      </main>
    </div>
  )
}

/** One pinned conversation, or the empty state for a missing peer. */
function Pane({
  role, label, sessionId, row, renderConversation, PinnedSessionProvider, t,
  onCreate, creating = false,
}: {
  role: 'a' | 'b'
  label: string
  sessionId: SessionId | undefined
  row: SessionRow | undefined
  renderConversation: () => ReactNode
  PinnedSessionProvider: PinnedSeat
  t: (key: OrchestrationKey) => string
  onCreate?: () => Promise<void>
  creating?: boolean
}) {
  return (
    <section className={css.pane} data-peer={role}>
      <header className={css.paneHead}>
        <div className={css.paneKicker}>{label}</div>
        <h2 className={css.paneTitle}>{row?.displayTitle ?? sessionId ?? t('empty.title')}</h2>
        <div className={css.paneMeta}>
          <span>{row?.parentId === undefined ? t('peer.root') : t('peer.child')}</span>
          <span>{row?.running === true ? t('peer.running') : t('peer.idle')}</span>
        </div>
      </header>
      {sessionId === undefined
        ? (
          <div className={css.emptyPane}>
            <p>{t('empty.second')}</p>
            {onCreate !== undefined && (
              <button
                type="button"
                className={css.emptyAction}
                disabled={creating}
                onClick={() => { void onCreate() }}
              >
                {t('empty.new')}
              </button>
            )}
          </div>
        )
        : (
          <div className={css.conversation}>
            {PinnedSessionProvider === undefined
              ? renderConversation()
              : (
                <PinnedSessionProvider sessionId={sessionId}>
                  {renderConversation()}
                </PinnedSessionProvider>
              )}
          </div>
        )}
    </section>
  )
}
