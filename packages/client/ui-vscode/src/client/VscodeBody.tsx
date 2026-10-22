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
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { BootHero, useTwinIntent } from './twin.tsx'
import { useVscodeAddressForward, type VscodeForwardRequest } from './forward.ts'
import { vscodeDebug, vscodeWarn } from './log.ts'
import type { IdeBridgeStatus, IdeOpenRequest } from './rpc.ts'

/** Poll cadence for the status question while the twin warms up. */
const POLL_MS = 1_500

/** The Remote operations one body performs, injected so the component stays host-free. */
export interface VscodeInjected {
  /** Ask the host for the session twin's state. */
  readonly status: (sessionId: SessionId, signal: AbortSignal) => Promise<RemoteResult<IdeBridgeStatus>>
  /**
   * Fire-and-forget: open one workspace file in the session twin. Optional
   * so mount-time guards and legacy compositions without the forwarding
   * channel degrade silently to status-only.
   */
  readonly forwardFile?: (sessionId: SessionId, request: IdeOpenRequest) => void
  /**
   * Fire-and-forget: announce this body's session as the focused one in its
   * workspace twin. Optional for the same legacy compositions as
   * `forwardFile`; without it the twin keeps its spawn-seed session forever.
   */
  readonly activate?: (sessionId: SessionId) => void
}

/** The body's composed props: the tab runtime, the injected face, and copy. */
export type VscodeBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & InjectFace<VscodeInjected>
  & PropsLocale<'vscode'>

/**
 * The vscode type's body, registered under `sidebar.right.pane.tab`.
 * @param props - composed slot props.
 * @returns the state line standing in for the twin, or nothing once ready.
 */
export function VscodeBody({ useTabInfo, sessionId: scopeSessionId, status, forwardFile, activate, t }: VscodeBodyProps): ReactNode {
  const { tab } = useTabInfo()
  // The address the tab was last navigated to, not the record's identity: a
  // `surface` type keeps one record for every file it opens, so `contentId` is
  // the type's page address and the file rides navigation.
  const address = tab.navigation.address
  // Resource addresses (file rows) carry their session in the URL; page
  // tabs (`sidebar://<kind>`) don't — those take the scope's session, which
  // the seat hands every session-scoped body anyway.
  const sessionId = useMemo<SessionId>(() => {
    const parsed = parseFileAddress(address)
    return parsed?.scope === 'session' ? parsed.sessionId as SessionId : scopeSessionId
  }, [address, scopeSessionId])
  // No module cache: every mount starts cold and re-polls, so a value
  // minted by a twin that has since respawned can never be resurrected.
  const [state, setState] = useState<IdeBridgeStatus | undefined>(undefined)
  // Transition-only breadcrumbs: the poll fires every POLL_MS, but only a
  // ready flip says something new about why clicks can/cannot reach a twin.
  const lastLoggedReady = useRef<boolean | undefined>(undefined)

  useEffect(() => {
    const controller = new AbortController()
    let mounted = true
    // One line per body mount: a session switch remounts this body per the
    // seat contract, so this timestamp brackets "user switched session".
    vscodeDebug('body:poll start', { sessionId })
    const tick = async (): Promise<void> => {
      const result = await status(sessionId, controller.signal)
      if (!mounted || controller.signal.aborted) return
      const fallback = { enabled: false, ready: false, url: null, tkn: null, workspaceRoot: null, detail: '' }
      const next = result.ok ? result.value : { ...fallback, detail: result.error.message }
      if (!result.ok) vscodeWarn('status:error', { sessionId, detail: next.detail })
      if (next.ready !== lastLoggedReady.current) {
        lastLoggedReady.current = next.ready
        vscodeDebug('status', {
          sessionId,
          ready: next.ready,
          // Token tail only: enough to correlate "same twin" across a respawn
          // without spilling the bearer into logs.
          t6: next.tkn === null ? null : next.tkn.slice(-6),
          url: next.url,
          workspaceRoot: next.workspaceRoot,
          detail: next.detail,
        })
      }
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

  // File forwarding: the tab's current file address arrives at the twin's
  // editor while the twin is ready. State misses (not-ready, no root) are
  // dropped on the floor — the extension-side seat would have no twin to
  // address anyway.
  const ready = state !== undefined && state.ready && state.tkn !== null
  const workspaceRoot = ready ? state.workspaceRoot : null

  // Session focus: one twin serves every session of a workspace, so the tab
  // announces the focused session on each ready answer's token (a respawned
  // twin gets a fresh activate) and on every session switch.
  const tkn = state?.ready === true ? state.tkn : null
  useEffect(() => {
    if (tkn === null || activate === undefined) return
    vscodeDebug('activate', { sessionId, t6: tkn.slice(-6) })
    activate(sessionId)
  }, [tkn, sessionId, activate])
  const sendForward = useMemo(
    () => (request: VscodeForwardRequest) => {
      forwardFile?.(request.sessionId, { path: request.path })
    },
    [forwardFile],
  )
  useVscodeAddressForward(address, tab.navigation.revision, ready, workspaceRoot, sendForward)

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
