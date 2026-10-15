/**
 * Wire types for the `lineNotes` Remote namespace: note rows projected from
 * the checkpoint slot register, the typed add uplink, and the editor-to-host
 * focus uplink.
 * @module @deepseek-ai/dsh-api-line-notes/types
 */

/** One line note: a comment pinned to one file line, rendered in the editor. */
export interface LineNote {
  /** Stable note identity within its session — the checkpoint slot id. */
  readonly id: string
  /** Session-relative file path the note is pinned to. */
  readonly path: string
  /** 1-based line number. */
  readonly line: number
  /** The note's rendered text. */
  readonly text: string
}

/** `lineNotes.state` response: the session's full note list. */
export interface LineNotesState {
  readonly notes: readonly LineNote[]
}

/**
 * `lineNotes.add` request body (beside the lookup session): the new note's
 * anchor plus the editor's frozen copy of the anchored line.
 */
export interface LineNoteAddRequest {
  /** Session-relative path of the noted file, slash-separated. */
  readonly path: string
  /** 1-based line number. */
  readonly line: number
  /** The note text; trimmed, must stay non-empty. */
  readonly text: string
  /**
   * The line's text at note time, frozen host-side into the blob store. The
   * editor sends its own copy — the client-side note flow does the same.
   */
  readonly retained: string
}

/** `lineNotes.focus` uplink: the user's editor landed on a note. */
export interface LineNoteFocusRequest {
  readonly sessionId: string
  /** Note identity, when the landing could be resolved to one row. */
  readonly noteId?: string
  readonly path: string
  readonly line: number
}
