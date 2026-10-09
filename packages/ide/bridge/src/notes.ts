/**
 * Line notes as comment threads: the bridge's stable-API controller glue over
 * the checkpoint slotPut seam. The wire face is shaped like the web's
 * `ui-line-note` retained model; the comments face is shaped like
 * `vscode.comments`, so the same glue drives the real controller in the twin.
 */

/** One retained line note as the slot register carries it. */
export interface NoteRecord {
  /** Register-assigned identity of the note. */
  readonly id: string
  /** The 1-based line the note anchors. */
  readonly line: number
  /** The note body. */
  readonly text: string
  /** The line's text at write time; the prompt-snapshot contract. */
  readonly retained: string
  /** Display author of the note. */
  readonly author: string
}

/** The checkpoint slot register narrowed to line notes for one file. */
export interface NotesWireFace {
  list(): Promise<readonly NoteRecord[]>
}

/** One live comment thread reconciliation record for a note. */
export interface NoteThreadState {
  /** The comments-controller thread id the note owns. */
  readonly threadId: string
  /** The body last applied, so unchanged notes converge without churn. */
  readonly text: string
}

/** The `vscode.comments` slice the glue drives. */
export interface CommentsFace {
  createThread(line: number, body: string, author: string): string
  replaceThread(threadId: string, body: string): void
  deleteThread(threadId: string): void
}

/**
 * Reconcile the live comment threads to the register's projection: unchanged
 * notes keep their thread, changed notes replace their body, absent notes
 * lose their thread, and new notes get one. Deterministic thread order
 * follows register order, so two activations converge identically.
 * @param wire - the slot-register face for the addressed file.
 * @param comments - the comments controller face.
 * @param threads - the previous reconciliation's note-to-thread map.
 * @returns the fresh note-to-thread map.
 */
export async function syncNotes(
  wire: NotesWireFace,
  comments: CommentsFace,
  threads: ReadonlyMap<string, NoteThreadState>,
): Promise<Map<string, NoteThreadState>> {
  const records = await wire.list()
  const next = new Map<string, NoteThreadState>()
  const seen = new Set<string>()
  for (const record of records) {
    seen.add(record.id)
    const existing = threads.get(record.id)
    if (existing === undefined) {
      next.set(record.id, { threadId: comments.createThread(record.line, record.text, record.author), text: record.text })
    }
    else {
      if (existing.text !== record.text) comments.replaceThread(existing.threadId, record.text)
      next.set(record.id, { threadId: existing.threadId, text: record.text })
    }
  }
  for (const [noteId, state] of threads) {
    if (!seen.has(noteId)) comments.deleteThread(state.threadId)
  }
  return next
}
