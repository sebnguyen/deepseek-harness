/**
 * The slice of the gateway this tab talks to, spelled locally.
 *
 * The host `@deepseek-ai/dsh-api-ide` package owns the wire contract; the
 * client keeps its own structural copy here because that package is host-face
 * only and the loader reaches it by runtime name, not by type import. The
 * shape is small enough that a drift would surface at typecheck of exactly
 * one field set.
 */
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** One session's VS Code twin state, mirroring `@deepseek-ai/dsh-api-ide/types`. */
export interface IdeBridgeStatus {
  /** True when a twin dist is configured at all. */
  readonly enabled: boolean
  /** True once the REH answers on its loopback port. */
  readonly ready: boolean
  /** Loopback base URL of the session's REH. */
  readonly url: string | null
  /** The spawn's connection token, for the `tkn` query. */
  readonly tkn: string | null
  /** Absolute workspace root for the session. */
  readonly workspaceRoot: string | null
  /** Human line for the not-ready or failed state. */
  readonly detail: string | null
}

/** The slice of the client Remote this package calls: twin status reads. */
export interface VscodeIdeRemote {
  readonly ideBridge: {
    /**
     * Report the twin state for one session, spawning its REH on first call.
     * @param sessionId - session identity at the address boundary.
     * @param signal - cancels the call.
     * @returns the twin state; failures arrive in-band with `ready: false`.
     */
    status(sessionId: SessionId, signal?: AbortSignal): Promise<RemoteResult<IdeBridgeStatus>>
  }
}
