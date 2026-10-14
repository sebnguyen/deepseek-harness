/**
 * The tab→twin file forwarder: when the user opens a file through the
 * vscode tab's address, the twin's editor surface follows. The companion
 * direction (twin→tab) is a bridge uplink event — `report`'s
 * `activeEditor` projection — intentionally unhooked until the twin
 * side records it (no write-back loop exists: twin opens do not
 * return traffic today).
 * @module @deepseek-ai/dsh-client-ui-vscode/forward
 */

import { useEffect, useRef } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'

/**
 * One forward request derived from a tab address: which session's twin,
 * and the absolute workspace file to open there.
 */
export interface VscodeForwardRequest {
  readonly sessionId: SessionId
  readonly path: string
}

/**
 * Derive the forward request for one tab address against the session
 * twin's workspace root; `null` when the address is not a session file
 * (page tabs, local addresses, cross-session roots) or the root is
 * unknown — those never translate.
 */
/**
 * An absolute path in any separator spelling the file-address codec preserves:
 * POSIX root, a Windows drive letter, or a UNC share. Session addresses carry
 * absolute paths verbatim (out-of-workspace reads/writes), and an absolute
 * path must forward as-is — prefixing the workspace root would fabricate a
 * `<root>//abs/path` that names no file the user clicked.
 */
export function isAbsoluteFilePath(path: string): boolean {
  return path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\\\')
}

export function forwardRequestOf(
  address: string,
  workspaceRoot: string,
): VscodeForwardRequest | null {
  const parsed = parseFileAddress(address)
  if (parsed === undefined || parsed.scope !== 'session') return null
  const root = workspaceRoot.endsWith('/') ? workspaceRoot.slice(0, -1) : workspaceRoot
  const path = parsed.path === ''
    ? null
    : isAbsoluteFilePath(parsed.path)
      ? parsed.path
      : `${root}/${parsed.path}`
  if (path === null) return null
  return { sessionId: parsed.sessionId as SessionId, path }
}

/** The injected wire call; keeps the hook's surface host-free for specs. */
export type VscodeForwardSend = (request: VscodeForwardRequest) => void

/**
 * Forward the current file address to the session twin on each change.
 * Fires strictly per new address (deduped) and only while the twin is
 * ready; spec-covered through {@link forwardRequestOf}.
 */
export function useVscodeAddressForward(
  address: string,
  ready: boolean,
  workspaceRoot: string | null,
  send: VscodeForwardSend,
): void {
  const last = useRef<string | null>(null)
  useEffect(() => {
    if (!ready || workspaceRoot === null) return
    const request = forwardRequestOf(address, workspaceRoot)
    if (request === null) return
    if (last.current === `${request.sessionId}:(${request.path})`) return
    last.current = `${request.sessionId}:(${request.path})`
    send(request)
  }, [address, ready, workspaceRoot, send])
}
