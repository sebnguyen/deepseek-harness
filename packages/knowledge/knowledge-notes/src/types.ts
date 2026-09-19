/**
 * Pure types of the knowledge-notes domain: the note record, its display
 * state, and the ONE home of the `knowledgeNotes` projection-key declaration.
 * Free of this package's host-side value imports.
 *
 * @module @deepseek-ai/dsh-knowledge-notes/types
 */

/** The normalization a stored `affirmedAgainst` hash was computed over. */
export const HASH_SCHEME = 'source-norm@1'

/**
 * One durable note attached to one source file. `target` and `claim` are the
 * only writer-supplied fields; `upsert_note` computes the hash and records the
 * author. One note per source file, keyed by the target's absolute path.
 */
export interface NoteRecord {
  /** Absolute path of the source file this note describes. */
  target: string
  /** The one thing worth knowing before changing the target file. */
  claim: string
  /** Hash of the target's normalized content at the last affirming write. */
  affirmedAgainst: string
  /** Names the normalization; a change to it is a migration, not an invalidation. */
  hashScheme: string
  /** Who wrote the claim. Only `agent` exists today; a person writing a note is a later seam. */
  author: 'agent'
}

/** Display freshness of a note against its target. Never a delete trigger. */
export type NoteState = 'live' | 'stale' | 'orphaned'

/**
 * Per-turn fold state for the turn-boundary notice: source-file paths touched
 * by mutating tools this turn, and whether the obligation notice already went
 * out. Both are derived from the log — the projection IS the store of record;
 * this plugin keeps no per-session map of its own.
 */
export interface KnowledgeNotesTurnState {
  /** Raw `file_path`/`path` arguments of this turn's mutating tool calls, deduped at read time. */
  touched: { turn: number; path: string }[]
  /** Whether this turn already received the refresh-obligation notice. */
  steered: boolean
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Files touched this turn (for the refresh obligation) and whether it already steered. */
    knowledgeNotes: KnowledgeNotesTurnState
  }
}
