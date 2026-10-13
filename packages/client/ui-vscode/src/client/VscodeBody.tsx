/**
 * The vscode tab's body: poll the session twin's state; the ready answer
 * publishes the singleton frame's src intent.
 *
 * The component never touches process state directly — it polls the host's
 * `ideBridge.status` on a modest interval, and each ready answer forms
 * `url/?tkn=<token>&folder=<workspaceRoot>` as the workspace frame source.
 * While the host answers not-ready the body shows its progress line; a
 * disabled namespace shows the unavailable line, which is also the state
 * the design note relies on for "no viable twin, no mount" deployments.
 * The iframe element itself outlives this body: `twin.tsx` hosts the
 * singleton frame in ui-layout's positional `shell.ide` seat, so a session
 * switch on the same workspace re-shows the live workbench instead of
 * reloading it; this body only publishes the ready src on its intent store.
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { BootHero, useTwinIntent } from './twin.tsx'
import type { IdeBridgeStatus } from './rpc.ts'

/** Poll cadence for the status question while the twin warms up. */
const POLL_MS = 1_500

/** The Remote operations one body performs, injected so the component stays host-free. */
export interface VscodeInjected {
  /** Ask the host for the session twin's state. */
  readonly status: (sessionId: SessionId, signal: AbortSignal) => Promise<RemoteResult<IdeBridgeStatus>>
}

/** The body's composed props: the tab runtime, the injected face, and copy. */
export type VscodeBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & InjectFace<VscodeInjected>
  & PropsLocale<'vscode'>

/**
 * Last ready answer per session id, kept module-level so a session switch —
 * which remounts this body per the seat's contract — paints the ready
 * branch (and therefore re-points the singleton frame) immediately instead
 * of re-showing the boot hero for one poll cycle.
 */
const readyCache = new Map<string, IdeBridgeStatus>()

/** Drop every cached ready answer; specs start from a cold cache. */
export function resetVscodeReadyCache(): void {
  readyCache.clear()
}

/**
 * The vscode type's body, registered under `sidebar.right.pane.tab`.
 * @param props - composed slot props.
 * @returns the state line standing in for the twin, or nothing once ready.
 */
export function VscodeBody({ useTabInfo, sessionId: scopeSessionId, status, t }: VscodeBodyProps): ReactNode {
  const { tab } = useTabInfo()
  // Resource addresses (file rows) carry their session in the URL; page
  // tabs (`sidebar://<kind>`) don't — those take the scope's session, which
  // the seat hands every session-scoped body anyway.
  const sessionId = useMemo<SessionId>(() => {
    const parsed = parseFileAddress(tab.contentId)
    return parsed?.scope === 'session' ? parsed.sessionId as SessionId : scopeSessionId
  }, [tab.contentId, scopeSessionId])
  const [state, setState] = useState<IdeBridgeStatus | undefined>(readyCache.get(sessionId))

  useEffect(() => {
    const controller = new AbortController()
    let mounted = true
    const tick = async (): Promise<void> => {
      const result = await status(sessionId, controller.signal)
      if (!mounted || controller.signal.aborted) return
      const fallback = { enabled: false, ready: false, url: null, tkn: null, workspaceRoot: null, detail: '' }
      const next = result.ok ? result.value : { ...fallback, detail: result.error.message }
      if (next.ready) readyCache.set(sessionId, next)
      setState(next)
    }
    void tick()
    const timer = setInterval(() => { void tick() }, POLL_MS)
    return () => {
      mounted = false
      controller.abort()
      clearInterval(timer)
    }
  }, [sessionId, status])

  // The singleton frame's src, published for as long as this body is mounted:
  // the release clears only this body's own publication.
  // dshGlass: the twin runs in glass-frame mode, composited transparent over
  // the harness page behind its iframe (the chat-window look).
  const src = state !== undefined && state.ready && state.url !== null && state.tkn !== null
    ? `${state.url}/?tkn=${state.tkn}${(state.workspaceRoot === null ? '' : `&folder=${encodeURIComponent(state.workspaceRoot)}`)}&dshGlass=1`
    : null
  useTwinIntent(src)

  if (state === undefined) return <BootHero line={t('state.opening')} spinning />
  if (!state.enabled) return <BootHero line={t('state.unavailable')} />
  if (!state.ready || state.url === null || state.tkn === null) {
    return (
      <BootHero
        line={t(state.detail === null ? 'state.opening' : 'state.failed', { detail: state.detail ?? '' })}
        spinning={state.detail === null}
      />
    )
  }
  // Ready: the singleton in the positional seat shows the workspace frame;
  // this body owns nothing visible past publication.
  return null
}
