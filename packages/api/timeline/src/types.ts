/**
 * Wire types for the `timeline` Remote namespace: one ordered row list per
 * session, read back whole (history) or by index window (slice).
 * @module @deepseek-ai/dsh-api-timeline/types
 */

/** One checkpoint row of a session's timeline. */
export interface TimelineRow {
  /** Monotonic checkpoint index within the session. */
  readonly index: number
  /** Human label for the checkpoint (event name or snapshot subject). */
  readonly label: string
  /** ISO-8601 timestamp the row entered the timeline. */
  readonly at: string
}

/** `timeline.history` request. */
export interface TimelineHistoryRequest {
  readonly sessionId: string
}

/** `timeline.history` response: the session's complete ordered rows. */
export interface TimelineHistory {
  readonly sessionId: string
  readonly rows: readonly TimelineRow[]
}

/** `timeline.slice` request: rows `from` inclusive to `to` exclusive. */
export interface TimelineSliceRequest {
  readonly sessionId: string
  readonly from: number
  readonly to: number
}

/** `timeline.slice` response. */
export interface TimelineSlice {
  readonly rows: readonly TimelineRow[]
}
