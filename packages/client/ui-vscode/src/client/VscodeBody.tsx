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
export function VscodeBody({ useTabInfo, status, t }: VscodeBodyProps): ReactNode {
  const { tab } = useTabInfo()
  const sessionId = useMemo(() => {
    const parsed = parseFileAddress(tab.contentId)
    return parsed?.scope === 'session' ? parsed.sessionId as SessionId : undefined
  }, [tab.contentId])
  const [state, setState] = useState<IdeBridgeStatus | undefined>(undefined)

  useEffect(() => {
    if (sessionId === undefined) {
      setState({ enabled: false, ready: false, url: null, tkn: null, workspaceRoot: null, detail: 'address carried no session' })
      return
    }
    const controller = new AbortController()
    let mounted = true
    const tick = async (): Promise<void> => {
      const result = await status(sessionId, controller.signal)
      if (!mounted || controller.signal.aborted) return
      const fallback = { enabled: false, ready: false, url: null, tkn: null, workspaceRoot: null, detail: '' }
      setState(result.ok ? result.value : { ...fallback, detail: result.error.message })
    }
    void tick()
    const timer = setInterval(() => { void tick() }, POLL_MS)
    return () => {
      mounted = false
      controller.abort()
      clearInterval(timer)
    }
  }, [sessionId, status])

  if (state === undefined) return <output>{t('state.opening')}</output>
  if (state.enabled !== true) return <output>{t('state.unavailable')}</output>
  if (state.ready !== true || state.url === null || state.tkn === null) {
    return <output>{t(state.detail === null ? 'state.opening' : 'state.failed', { detail: state.detail ?? '' })}</output>
  }
  const folder = state.workspaceRoot === null ? '' : `&folder=${encodeURIComponent(state.workspaceRoot)}`
  return (
    <iframe
      title="vscode"
      src={`${state.url}/?tkn=${state.tkn}${folder}`}
      style={{ width: '100%', height: '100%', border: 'none' }}
    />
  )
}
