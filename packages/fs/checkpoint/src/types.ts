/**
 * Checkpoint vocabulary for the workspace snapshot timeline. Rows are records:
 * one `checkpoint/scan` row per file a committed write handed over, attributed
 * to that call. File state at any stop is a query over rows; content lives in
 * the local blob store keyed by sha256 digest.
 * @module dsh-checkpoint/types
 */

import type { ToolCallId } from '@deepseek-ai/dsh-llm'

/** Opaque content digest of one snapshot blob: `sha256:<hex>`. */
export type SnapshotDigest = string & { readonly __snapshotDigest: never }

/**
 * One file a committed write handed to capture. `after` is the digest of the
 * text the write committed; `before` is the digest of the prior text the write
 * held, omitted when that text was null.
 */
export interface CheckpointRow {
  /** Session-relative path, slash-separated. */
  readonly path: string
  /** The write call that committed this file; join `tool/call` for turn/step. */
  readonly callId: ToolCallId
  readonly toolName: string
  /** The captured `tool/call.purpose` line, when the call carried one. */
  readonly purpose?: string
  /** Digest of the prior text; omitted when the write supplied no before text. */
  readonly before?: SnapshotDigest
  /** Digest of the committed text, retained in the blob store. */
  readonly after?: SnapshotDigest
  /** True when this scan cannot vouch for continuity from the prior row. */
  readonly gap?: true
}

/** One stop of one file over the remote surface, folded like the client fold. */
export interface CheckpointStop {
  /** Sequence number of the `checkpoint/scan` event that carried this stop. */
  readonly seq: number
  /** Wall-clock time of that event. */
  readonly time: number
  /** The write call that committed this file. */
  readonly callId: string
  /** Name of the tool that ran. */
  readonly toolName: string
  /** The call's stated purpose, when one rode the row or its call. */
  readonly purpose?: string
  /** Turn the call belonged to, absent when its `tool/call` event was never logged. */
  readonly turn?: number
  /** Step within that turn, absent with the turn. */
  readonly step?: number
  /** Digest of the prior text; omitted when the write supplied none. */
  readonly before?: SnapshotDigest
  /** Digest of the committed text; always present under the write gate. */
  readonly after?: SnapshotDigest
}

/** One file's stops over the remote surface, oldest first. */
export interface CheckpointTimeline {
  /** Session-relative path, slash-separated. */
  readonly path: string
  readonly stops: readonly CheckpointStop[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One committed write's files: each row is a file whose before and after
     * text the write handed to capture. Rows are records only; state at a stop
     * and the per-file timeline are projections over rows.
     * @param rows - files that write committed, in the order capture recorded them.
     */
    'checkpoint/scan': { rows: CheckpointRow[] }
  }
}
