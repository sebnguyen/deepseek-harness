/**
 * Checkpoint vocabulary for the workspace snapshot timeline. Rows are records:
 * one `checkpoint/scan` row per observed per-file change, attributed to the
 * tool call whose bracket scan captured it. File state at any stop is a query
 * over rows; content lives in the local blob store keyed by sha256 digest.
 * @module dsh-checkpoint/types
 */

import type { ToolCallId } from '@deepseek-ai/dsh-llm'

/** Opaque content digest of one snapshot blob: `sha256:<hex>`. */
export type SnapshotDigest = string & { readonly __snapshotDigest: never }

/**
 * One observed workspace file change attributed to a checkpoint interval.
 * `after` is the post-state digest the blob store must retain; `before` is the
 * prior row's after-digest for the same path where the chain holds, omitted on
 * a first-appearance or gap-marked row.
 */
export interface CheckpointRow {
  /** Session-relative path, slash-separated. */
  readonly path: string
  /** The tool call whose bracket scan captured this change; join `tool/call` for turn/step. */
  readonly callId: ToolCallId
  readonly toolName: string
  /** The captured `tool/call.purpose` line, when the call carried one. */
  readonly purpose?: string
  /** Prior after-digest for this path; omitted when the file first appears. */
  readonly before?: SnapshotDigest
  /** Post-state digest retained in the blob store; omitted when the file left the workspace. */
  readonly after?: SnapshotDigest
  /** True when this scan cannot vouch for continuity from the prior row. */
  readonly gap?: true
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One pruned workspace rescan after a mutating tool call: the rows are the
     * per-file changes the scan attributed to that call. Rows are records only;
     * state at a stop and the per-file timeline are projections over rows.
     * @param rows - changed files since the previous scan, in path order.
     */
    'checkpoint/scan': { rows: CheckpointRow[] }
  }
}
