/**
 * The two calls this type performs, bound to the Client Remote, plus the address
 * and wire decoding between them.
 *
 * Content is the consumer's business: the `file` resource carries metadata
 * only, while the complete text arrives here in one `readAll` and leaves in
 * one `write`. A Remote call does not reject: the result carries the failure.
 */
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { WorkspaceFileBytes, WorkspaceFileStat } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'

/** The file one tab edits: the session the calls run under and the path handed to the Host. */
export interface SessionFile {
  /** The Session whose workspace resolves relative paths. */
  readonly sessionId: SessionId
  /** The path the Host receives, absolute or relative to the addressed Session's workspace. */
  readonly path: string
}

/**
 * The session and path one `dsh-resource://file/…` address names.
 *
 * The registry routes only session-scoped `file` addresses to this type, so an
 * address `parseFileAddress` rejects or that carries no session is a programming
 * error and throws.
 * @param address - a tab's `dsh-resource://file/…` address.
 * @returns the session and the path to hand the endpoints.
 */
export function sessionFileOf(address: string): SessionFile {
  const parsed = parseFileAddress(address)
  if (parsed?.scope !== 'session') throw new Error(`ui-editor: not a session file address "${address}"`)
  // The address is the string boundary: its id segment is the Session id it names.
  return { sessionId: parsed.sessionId as SessionId, path: parsed.path }
}

/**
 * Decode complete wire bytes into the editor's text.
 * @param bytes - a successful `readAll` result.
 * @returns the file text; malformed base64 throws.
 */
export function decodeText(bytes: WorkspaceFileBytes): string {
  return new TextDecoder().decode(Uint8Array.from(atob(bytes.data), character => character.charCodeAt(0)))
}

/** The slice of the Client Remote this package calls: one complete read and one save. */
export interface EditorFilesRemote {
  readonly workspaceFiles: {
    /**
     * Read a complete file.
     * @param sessionId - the session whose workspace resolves `path`.
     * @param path - workspace path, absolute or relative to the workspace root.
     * @param signal - cancels the call.
     * @returns the complete bytes with the freshness version, or the failure the Host declares.
     */
    readAll(sessionId: SessionId, path: string, signal?: AbortSignal): Promise<RemoteResult<WorkspaceFileBytes>>
    /**
     * Save a complete file under a version guard.
     * @param sessionId - the session whose workspace resolves `path`.
     * @param path - workspace path, absolute or relative to the workspace root.
     * @param content - the complete new text.
     * @param expectedVersion - version the editor loaded or last saved; undefined saves unguarded.
     * @param signal - cancels the call.
     * @returns the saved file's identity, or the failure the Host declares.
     */
    write(
      sessionId: SessionId,
      path: string,
      content: string,
      expectedVersion: string | undefined,
      signal?: AbortSignal,
    ): Promise<RemoteResult<WorkspaceFileStat>>
  }
  readonly checkpoint: {
    /** One retained snapshot text of this session's store; null when the object is absent. */
    blob(sessionId: SessionId, digest: string): Promise<RemoteResult<string | null>>
    /** Restore one workspace file to a recorded stop's bytes. */
    restore(sessionId: SessionId, path: string, digest: string): Promise<RemoteResult<string>>
  }
}

/**
 * Say what went wrong, in terms of the file rather than of the transport.
 *
 * Codes this editor does not name fall to the generic line carrying the
 * carrier's message.
 * @param t - namespace-bound translate.
 * @param failure - the settled Remote failure.
 * @returns the line to show in place of the editor or on its banner.
 */
export function failureLine(t: TranslateNS<'editor'>, failure: RemoteFailure): string {
  switch (failure.code) {
    case 'workspace-file/not-found': return t('error.notFound')
    case 'workspace-file/too-large': return t('error.tooLarge')
    case 'workspace-file/read-only': return t('error.readOnly')
    case 'workspace-file/stale': return t('error.stale')
    // Carrier and unclassified host failures reach the editor as themselves:
    // this panel knows nothing useful to add to a transport-level message.
    default: return t('error.generic', { message: failure.message })
  }
}
