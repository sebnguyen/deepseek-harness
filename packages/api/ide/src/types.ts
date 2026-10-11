/**
 * Shared wire shapes for the `ideBridge` Remote namespace.
 *
 * The status object deliberately survives every failure mode on the wire:
 * a disabled twin, a spawn crash, or a readiness timeout all arrive as
 * `ready: false` with a human line rather than as a thrown Remote error, so
 * the client tab renders state instead of error transport.
 * @module @deepseek-ai/dsh-api-ide/types
 */

/** One session's VS Code twin state as the client tab renders it. */
export interface IdeBridgeStatus {
  /** True when a twin dist is configured at all; false renders the unavailable line. */
  readonly enabled: boolean
  /** True once the REH answers HTTP on its loopback port; the iframe mounts. */
  readonly ready: boolean
  /** Loopback base URL of the session's REH, e.g. "http://127.0.0.1:3481". */
  readonly url: string | null
  /** The connection token this spawn was armed with; goes into the `tkn` query. */
  readonly tkn: string | null
  /** Absolute workspace root for the session, for the `folder` query. */
  readonly workspaceRoot: string | null
  /** Human line for the not-ready or failed state. */
  readonly detail: string | null
}
