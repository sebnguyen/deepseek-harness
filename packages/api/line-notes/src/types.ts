/**
 * Wire types for the `lineNotes` Remote namespace: note rows keyed to one
 * file line, the pull-side state read, and the editor-to-host focus uplink.
 * @module @deepseek-ai/dsh-api-line-notes/types
 */

/** One line note: a comment pinned to one file line, rendered in the editor. */
export interface LineNote {
  /** Stable note identity within its session. */
  readonly id: string
  /** File path the note is pinned to. */
  readonly path: string
  /** 1-based line number. */
  readonly line: number
  /** The note's rendered text. */
  readonly text: string
}

/** `lineNotes.state` request. */
export interface LineNotesStateRequest {
  readonly sessionId: string
}

/** `lineNotes.state` response: the session's full note list. */
export interface LineNotesState {
  readonly notes: readonly LineNote[]
}

/** `lineNotes.focus` uplink: the user's editor landed on a note. */
export interface LineNoteFocusRequest {
  readonly sessionId: string
  /** Note identity, when the landing could be resolved to one row. */
  readonly noteId?: string
  readonly path: string
  readonly line: number
}
