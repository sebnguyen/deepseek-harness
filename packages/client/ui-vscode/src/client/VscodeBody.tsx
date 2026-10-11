/**
 * The vscode tab's body: one iframe mounted on the session twin's loopback URL.
 *
 * The component never touches process state directly — it polls the host's
 * `ideBridge.status` on a modest interval, and each ready answer forms
 * `url/?tkn=<token>&folder=<workspaceRoot>` as the iframe source. While the
 * host answers not-ready the body shows its progress line; a disabled
 * namespace shows the unavailable line, which is also the state the design
 * note relies on for "no viable twin, no mount" deployments.
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { DigitalOceanLogo, PixelLoader } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
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
 * The vscode type's body, registered under `sidebar.right.pane.tab`.
 * @param props - composed slot props.
 * @returns the iframe mount, or the state line standing in for it.
 */
/** The boot seam and state lines ride the harness theme, not a white flash. */
const FRAME_STYLE = {
  width: '100%',
  height: '100%',
  border: 'none',
  background: 'var(--dsw-alias-bg-base, #121618)',
} as const

/** The boot hero: twinkle mark stacked on the wordmark, state line below. */
const HERO_STYLE = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '14px',
  width: '100%',
  height: '100%',
  padding: '16px',
  boxSizing: 'border-box',
  background: 'var(--dsw-alias-bg-base, #121618)',
} as const

const WORDMARK_STYLE = {
  color: 'var(--dsw-alias-label-primary, #f7f8f8)',
  fontSize: '12px',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
} as const

const DETAIL_STYLE = {
  color: 'var(--dsw-alias-label-secondary, #a0a2a3)',
  fontSize: '12px',
  textAlign: 'center',
  maxWidth: '32em',
} as const

/**
 * The seam the user watches every time the twin spawns: the DO twinkle mark
 * centered over the wordmark with the state line — the same loading canvas
 * the harness boot page paints, instead of a bare text line on stock chrome.
 */
function BootHero({ line, spinning = false }: { readonly line: string; readonly spinning?: boolean }): ReactNode {
  return (
    <div style={HERO_STYLE}>
      {spinning
        ? <PixelLoader mode="twinkle" grid={16} size={128} />
        : <DigitalOceanLogo size={64} />}
      <div style={WORDMARK_STYLE}>DigitalOcean Harness</div>
      <output style={DETAIL_STYLE}>{line}</output>
    </div>
  )
}

/**
 * Last ready-triple per session id, kept module-level so a session switch —
 * which remounts this body per the seat's contract — repaints the ready
 * branch (and therefore a barn-cached frame) immediately instead of
 * re-showing the boot hero for one poll cycle.
 */
const readyCache = new Map<string, IdeBridgeStatus>()

export function VscodeBody({ useTabInfo, sessionId: scopeSessionId, status, t }: VscodeBodyProps): ReactNode {
  const { tab } = useTabInfo()
  // Resource addresses (file rows) carry their session in the URL; page
  // tabs (`sidebar://<kind>`) don't — those take the scope's session, which
  // the seat hands every session-scoped body anyway.
  const sessionId = useMemo(() => {
    const parsed = parseFileAddress(tab.contentId)
    return parsed?.scope === 'session' ? parsed.sessionId as SessionId : scopeSessionId
  }, [tab.contentId, scopeSessionId])
  const [state, setState] = useState<IdeBridgeStatus | undefined>(
    sessionId === undefined ? undefined : readyCache.get(sessionId),
  )

  useEffect(() => {
    if (sessionId === undefined) {
      setState({ enabled: false, ready: false, url: null, tkn: null, workspaceRoot: null, detail: 'no session is live for this tab' })
      return
    }
    const controller = new AbortController()
    let mounted = true
    const tick = async (): Promise<void> => {
      const result = await status(sessionId, controller.signal)
      if (!mounted || controller.signal.aborted) return
      const fallback = { enabled: false, ready: false, url: null, tkn: null, workspaceRoot: null, detail: '' }
      const next = result.ok ? result.value : { ...fallback, detail: result.error.message }
      if (next.ready === true) readyCache.set(sessionId, next)
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

  if (state === undefined) return <BootHero line={t('state.opening')} spinning />
  if (state.enabled !== true) return <BootHero line={t('state.unavailable')} />
  if (state.ready !== true || state.url === null || state.tkn === null) {
    return (
      <BootHero
        line={t(state.detail === null ? 'state.opening' : 'state.failed', { detail: state.detail ?? '' })}
        spinning={state.detail === null}
      />
    )
  }
  const folder = state.workspaceRoot === null ? '' : `&folder=${encodeURIComponent(state.workspaceRoot)}`
  return (
    <iframe
      title="vscode"
      src={`${state.url}/?tkn=${state.tkn}${folder}`}
      style={FRAME_STYLE}
    />
  )
}
