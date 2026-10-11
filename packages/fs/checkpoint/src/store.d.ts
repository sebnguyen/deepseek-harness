/**
 * Content-addressed blob store for checkpoint snapshots. Objects live per
 * session below `<dshHome>/checkpoints/v1/<sessionId>/objects/xx/<sha256>`,
 * mirroring the attachment store's two-level fan-out and 0700 hardening.
 * Writes are idempotent: storing an existing digest is a stat, so repeated
 * scans over unchanged content never rewrite objects.
 * @module dsh-checkpoint/store
 */
import type { ScannedStat } from './scan.ts'
import type { CheckpointSlotRecord, SnapshotDigest } from './types.ts'
/** One persisted frontier row: the content digest plus the stat the next scan diffs. */
export interface FrontierRecord {
  /** Content digest retained for this path. */
  readonly digest: SnapshotDigest
  /** Modification time from the scan that stored this row, when the row carries a stat. */
  readonly mtimeMs?: number
  /** Byte size from the scan that stored this row, when the row carries a stat. */
  readonly size?: number
}
/** Digests and stats restored from one frontier file. */
export interface FrontierSnapshot {
  /** Paths whose mtime and size were stored; a path absent here is read on the next scan. */
  readonly stat: Map<string, ScannedStat>
  /** Path → digest, including rows that predate stored stats. */
  readonly after: Map<string, SnapshotDigest>
}
/** Digest one buffer the way the store addresses it: `sha256:<hex>`. */
export declare function digestOf(content: string): SnapshotDigest
/**
 * One session's object fan-out. All operations own their directories: the
 * first store hardens each created directory to 0700 and the store root is
 * validated as an ancestor of every object path it composes.
 */
export declare class CheckpointStore {
  private readonly sessionRoot
  constructor(sessionRoot: string)
  /** Compose the hardened objects root below the per-session directory. */
  private objectsRoot
  /** Absolute path of one digest in the two-level fan-out. */
  private objectPath
  /** Create and harden one directory chain to 0700, walking up to the root. */
  private ensureDir
  /**
     * Store one content blob idempotently and return its digest. Existing
     * objects are stat-only; a digest-equal rewrite never touches disk.
     * @param content - the UTF-8 text to retain.
     * @returns the digest addressing the stored object.
     */
  put(content: string): Promise<SnapshotDigest>
  /**
     * Read the persisted frontier for this session. Each row is a digest plus,
     * when the file was written by a scan that stored stats, the mtime and size
     * that let the next scan skip an unchanged file. A legacy row that is only a
     * digest string keeps the digest and omits the stat, so that path is read
     * once more. A missing or malformed file is an empty frontier: capture
     * continuity is a cache, and losing it must not fail a scan.
     * @returns the restored digests and the stats that were stored with them.
     */
  loadFrontier(): Promise<FrontierSnapshot>
  /**
     * Persist digests and the stat snapshot so a resumed process skips files
     * whose mtime and size are unchanged. A path that has a digest and no stat
     * is written as a digest-only row.
     * @param stat - mtime and size of each path the last walk still contains.
     * @param after - path → digest after that walk.
     */
  saveFrontier(stat: ReadonlyMap<string, ScannedStat>, after: ReadonlyMap<string, SnapshotDigest>): Promise<void>
  /**
     * Read one stored blob. Unknown digests resolve null instead of throwing,
     * because a span whose objects were pruned is a display state, not a fault.
     * @param digest - the digest a row recorded.
     * @returns the stored text, or null when the object is absent.
     */
  read(digest: SnapshotDigest): Promise<string | null>
  /** Whether one digest is retained. @param digest - the digest to test. */
  has(digest: SnapshotDigest): Promise<boolean>
  /**
     * Append one register row to the session's `slots.jsonl`. Append-only by
     * construction: the register has no rewrite or remove path, and releasing a
     * slot is itself an appended tombstone row.
     * @param record - the put or release row to persist verbatim.
     */
  appendSlotRow(record: CheckpointSlotRecord): Promise<void>
  /**
     * Read the register log in write order. A missing file is an empty register.
     * A malformed line — a half-written tail from a crash, or hand-edited garbage —
     * is skipped rather than fatal: the register degrades to its readable prefix,
     * the same posture the frontier cache takes.
     * @returns every parseable row, oldest first.
     */
  loadSlotRows(): Promise<CheckpointSlotRecord[]>
}
//# sourceMappingURL=store.d.ts.map
