/**
 * LineNotes: the `lineNotes` Remote namespace.
 *
 * The conversation side publishes each session's notes through
 * {@link LineNotes.publish}; editor engines read them back through
 * `lineNotes.state` (and via `dsh/frame/line-notes` downlink frames on the
 * vscode web client). The editor's `lineNotes.focus` uplink is the
 * back-direction: the user's editor landing on a note is re-emitted as the
 * host-local `lineNotes/focus` event, where consumer surfaces (the
 * conversation view) jump the user to the source message.
 * @module @deepseek-ai/dsh-api-line-notes
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  LineNote,
  LineNoteFocusRequest,
  LineNotesState,
  LineNotesStateRequest,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `lineNotes` Remote namespace. */
    lineNotes: LineNotes
  }
  interface Events {
    /** Re-emit of the editor's `lineNotes.focus` uplink for face-local consumers. */
    'lineNotes/focus'(request: LineNoteFocusRequest): void
  }
}

/** The publisher-side store behind the `lineNotes` remote face. */
export class LineNotes extends TypertRemoteService {
  static readonly inject: readonly string[] = []

  private readonly sessions = new Map<string, LineNote[]>()

  constructor(ctx: Context) {
    super(ctx, 'lineNotes')
  }

  /**
   * Replace one session's note list (host-side publication).
   * @param sessionId - the session the notes belong to.
   * @param notes - the complete note list for the session.
   */
  publish(sessionId: string, notes: readonly LineNote[]): void {
    this.sessions.set(sessionId, notes.map(note => ({ ...note })))
  }

  /** Drop one session's notes (session teardown). */
  clear(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  /** Read the session's full note list. */
  @Remote
  state(request: LineNotesStateRequest, signal: AbortSignal): LineNotesState {
    void signal
    return { notes: [...(this.sessions.get(request.sessionId) ?? [])] }
  }

  /**
   * The editor landed on a note (uplink from any engine). Validated and
   * re-emitted locally; the base service deliberately routes further.
   */
  @Remote
  focus(request: LineNoteFocusRequest, signal: AbortSignal): void {
    void signal
    if (!Number.isSafeInteger(request.line) || request.line < 1) {
      throw new RemoteError('gateway/bad-request', 'focus line must be a positive safe integer', {})
    }
    if (request.path.length === 0) {
      throw new RemoteError('gateway/bad-request', 'focus path must be non-empty', {})
    }
    this.ctx.emit('lineNotes/focus', request)
  }
}
