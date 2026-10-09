/**
 * The wire face this type performs, bound to the Client Remote.
 *
 * The shape mirrors `dsh-host-ide`'s `ide` namespace structurally so this package
 * type-checks against the host's Remote contract without importing host code
 * into the browser bundle.
 */
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { IdeReport } from '@deepseek-ai/dsh-host-ide/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'

/** One readiness snapshot as the `ide` namespace publishes it. */
export interface IdeWireStatus {
  /** True once the bridge's hello has crossed the gateway. */
  readonly ready: boolean
  /** The upstream sha of the twin in play, when one is. */
  readonly twinSha: string | null
  /** Why the frame is absent, when it is. */
  readonly reason: 'no-twin' | 'spawning' | 'disposed' | null
  /** Loopback iframe url with the launch token, once known. */
  readonly frameUrl: string | null
}

/** The `ide` Remote namespace as this client consumes it, envelope and all. */
export interface IdeClientFace {
  status(signal?: AbortSignal): Promise<RemoteResult<IdeWireStatus>>
  events(signal?: AbortSignal): AsyncIterable<IdeWireStatus>
  open(path: string, signal?: AbortSignal): Promise<RemoteResult<void>>
  openNext(signal?: AbortSignal): Promise<RemoteResult<string | null>>
  hello(signal?: AbortSignal): Promise<RemoteResult<boolean>>
  report(
    kind: 'save' | 'activeEditor' | 'diagnostics',
    path: string | null,
    detail: string | null,
    signal?: AbortSignal,
  ): Promise<RemoteResult<void>>
  reports(signal?: AbortSignal): Promise<RemoteResult<readonly IdeReport[]>>
}

/** The file the addressed tab names, in the Host's addressing. */
export interface SessionFileRef {
  readonly sessionId: SessionId
  readonly path: string
}

/**
 * A frame can only be the Host's own loopback child; mirror of the bridge-side
 * guard so the body never iframes a foreign origin.
 * @param frameUrl - the status-provided iframe source.
 * @returns true only for 127.0.0.1, localhost, or [::1] hosts.
 */
export function frameIsLoopback(frameUrl: string): boolean {
  let host: string
  try {
    host = new URL(frameUrl).hostname
  }
  catch {
    return false
  }
  const bare = host.replace(/^\[/, '').replace(/\]$/, '')
  return bare === '127.0.0.1' || bare === 'localhost' || bare === '::1'
}

/** @param address - a tab's `dsh-resource://file/…` address.
 * @returns the session and the path, throwing on any other address shape.
 */
export function sessionFileOf(address: string): SessionFileRef {
  const parsed = parseFileAddress(address)
  if (parsed?.scope !== 'session') throw new Error(`ui-vscode: not a session file address "${address}"`)
  return { sessionId: parsed.sessionId as SessionId, path: parsed.path }
}
