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

/** Identity of one slot in one session's register; the producer mints it. */
export type CheckpointSlotId = string & { readonly __checkpointSlotId: never }

/** Core record every slot carries; what the generic client renders and filters. */
export interface CheckpointSlot {
  readonly slotId: CheckpointSlotId
  /** Producer kind key; the merged detail map is keyed by it. */
  readonly kind: string
  /** Session-relative path, slash-separated, relativized like CheckpointRow.path. */
  readonly path: string
  /** Producer-supplied one-liner: tooltip and transcript chip text. */
  readonly label: string
  /** Optional turn scope; the remote fold joins `tool/call` for absent turns. */
  readonly turn?: number
  /** Optional tool-call scope; the worktree producer mints its slotId from it. */
  readonly callId?: string
  /** Line anchor when the producer has one; the note kind pins it. */
  readonly line?: number
  /** Shadow snapshots in the blob store; digests only, both optional. */
  readonly before?: SnapshotDigest
  readonly after?: SnapshotDigest
  /** Host-assigned creation time in Unix epoch milliseconds. */
  readonly createdAt: number
  /** Per-producer payload from the merged detail map. */
  readonly detail: CheckpointSlotDetail
}

/** Per-producer payload; declaration-merged like SessionEventMap. */
export interface CheckpointSlotDetailMap {
  /** A line the user pinned; the comment producer. */
  readonly note: { readonly text: string }
  /** A committed write the capture gate recorded; slotId reuses the call id. */
  readonly worktree: { readonly toolName: string; readonly purpose?: string }
}

/** The wire-safe union of every merged payload; the register's stored payload type. */
export type CheckpointSlotDetail = CheckpointSlotDetailMap[keyof CheckpointSlotDetailMap]

/** The fields a producer passes to `CheckpointService.putSlot`. */
export interface CheckpointSlotPut {
  readonly slotId: string
  readonly kind: string
  readonly path: string
  readonly label: string
  readonly turn?: number
  readonly callId?: string
  readonly line?: number
  readonly before?: SnapshotDigest
  readonly after?: SnapshotDigest
  readonly retained?: string
  readonly detail: CheckpointSlotDetail
}

/** The wire twin of {@link CheckpointSlotPut}: a fresh digest crosses as a plain string. */
export type CheckpointSlotPutWire = Omit<CheckpointSlotPut, 'after'> & { readonly after?: string }

/** One file's live slots over the remote surface, oldest first. */
export interface CheckpointSlotTimeline {
  /** Session-relative path, slash-separated. */
  readonly path: string
  readonly slots: readonly CheckpointSlot[]
}

/**
 * One persisted row of `slots.jsonl`. Put rows carry the full slot; release
 * rows carry only the tombstone key. The register is append-only and
 * undeletable: no writer ever removes or rewrites a row.
 */
export type CheckpointSlotRecord =
  | (CheckpointSlot & { readonly released?: never })
  | { readonly slotId: CheckpointSlotId; readonly released: true }

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
