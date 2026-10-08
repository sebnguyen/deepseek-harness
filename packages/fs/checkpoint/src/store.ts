/**
 * Content-addressed blob store for checkpoint snapshots. Objects live per
 * session below `<dshHome>/checkpoints/v1/<sessionId>/objects/xx/<sha256>`,
 * mirroring the attachment store's two-level fan-out and 0700 hardening.
 * Writes are idempotent: storing an existing digest is a stat, so repeated
 * scans over unchanged content never rewrite objects.
 * @module dsh-checkpoint/store
 */

import { createHash } from 'node:crypto'
import { appendFile, chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
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

/** Whether one JSON value is a finite mtime/size pair the next diff can trust. */
function readStoredStat(mtimeMs: unknown, size: unknown): ScannedStat | undefined {
  if (typeof mtimeMs !== 'number' || !Number.isFinite(mtimeMs)) return undefined
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return undefined
  return { mtimeMs, size }
}

/** Digest one buffer the way the store addresses it: `sha256:<hex>`. */
export function digestOf(content: string): SnapshotDigest {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}` as SnapshotDigest
}

/**
 * One session's object fan-out. All operations own their directories: the
 * first store hardens each created directory to 0700 and the store root is
 * validated as an ancestor of every object path it composes.
 */
export class CheckpointStore {
  constructor(private readonly sessionRoot: string) { }

  /** Compose the hardened objects root below the per-session directory. */
  private objectsRoot(): string {
    return join(this.sessionRoot, 'objects')
  }

  /** Absolute path of one digest in the two-level fan-out. */
  private objectPath(digest: SnapshotDigest): string {
    const hex = digest.slice('sha256:'.length)
    return join(this.objectsRoot(), hex.slice(0, 2), hex)
  }

  /** Create and harden one directory chain to 0700, walking up to the root. */
  private async ensureDir(target: string): Promise<void> {
    await mkdir(target, { recursive: true, mode: 0o700 })
    await chmod(target, 0o700)
  }

  /**
   * Store one content blob idempotently and return its digest. Existing
   * objects are stat-only; a digest-equal rewrite never touches disk.
   * @param content - the UTF-8 text to retain.
   * @returns the digest addressing the stored object.
   */
  async put(content: string): Promise<SnapshotDigest> {
    const digest = digestOf(content)
    const path = this.objectPath(digest)
    try {
      await stat(path)
      return digest
    } catch {
      // first writer for this digest; fall through to the write
    }
    await this.ensureDir(join(path, '..'))
    await chmod(join(path, '..'), 0o700)
    await writeFile(path, content, { encoding: 'utf8', mode: 0o600 })
    return digest
  }

  /**
   * Read the persisted frontier for this session. Each row is a digest plus,
   * when the file was written by a scan that stored stats, the mtime and size
   * that let the next scan skip an unchanged file. A legacy row that is only a
   * digest string keeps the digest and omits the stat, so that path is read
   * once more. A missing or malformed file is an empty frontier: capture
   * continuity is a cache, and losing it must not fail a scan.
   * @returns the restored digests and the stats that were stored with them.
   */
  async loadFrontier(): Promise<FrontierSnapshot> {
    const empty = (): FrontierSnapshot => ({ stat: new Map(), after: new Map() })
    try {
      const parsed: unknown = JSON.parse(await readFile(join(this.sessionRoot, 'frontier.json'), 'utf8'))
      if (typeof parsed !== 'object' || parsed === null) return empty()
      const stat = new Map<string, ScannedStat>()
      const after = new Map<string, SnapshotDigest>()
      for (const [path, value] of Object.entries(parsed)) {
        // A frontier written before stats were stored is path → digest string.
        if (typeof value === 'string') {
          after.set(path, value as SnapshotDigest)
          continue
        }
        if (typeof value !== 'object' || value === null) continue
        const record = value as { digest?: unknown; mtimeMs?: unknown; size?: unknown }
        if (typeof record.digest !== 'string') continue
        after.set(path, record.digest as SnapshotDigest)
        const stored = readStoredStat(record.mtimeMs, record.size)
        if (stored !== undefined) stat.set(path, stored)
      }
      return { stat, after }
    } catch {
      return empty()
    }
  }

  /**
   * Persist digests and the stat snapshot so a resumed process skips files
   * whose mtime and size are unchanged. A path that has a digest and no stat
   * is written as a digest-only row.
   * @param stat - mtime and size of each path the last walk still contains.
   * @param after - path → digest after that walk.
   */
  async saveFrontier(stat: ReadonlyMap<string, ScannedStat>, after: ReadonlyMap<string, SnapshotDigest>): Promise<void> {
    const body: Record<string, FrontierRecord> = {}
    for (const [path, digest] of [...after].sort(([left], [right]) => left.localeCompare(right))) {
      const scanned = stat.get(path)
      body[path] = scanned === undefined
        ? { digest }
        : { digest, mtimeMs: scanned.mtimeMs, size: scanned.size }
    }
    await this.ensureDir(this.sessionRoot)
    await writeFile(
      join(this.sessionRoot, 'frontier.json'),
      `${JSON.stringify(body)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    )
  }

  /**
   * Read one stored blob. Unknown digests resolve null instead of throwing,
   * because a span whose objects were pruned is a display state, not a fault.
   * @param digest - the digest a row recorded.
   * @returns the stored text, or null when the object is absent.
   */
  async read(digest: SnapshotDigest): Promise<string | null> {
    try {
      return await readFile(this.objectPath(digest), 'utf8')
    } catch {
      return null
    }
  }

  /** Whether one digest is retained. @param digest - the digest to test. */
  async has(digest: SnapshotDigest): Promise<boolean> {
    try {
      await stat(this.objectPath(digest))
      return true
    } catch {
      return false
    }
  }

  /**
   * Append one register row to the session's `slots.jsonl`. Append-only by
   * construction: the register has no rewrite or remove path, and releasing a
   * slot is itself an appended tombstone row.
   * @param record - the put or release row to persist verbatim.
   */
  async appendSlotRow(record: CheckpointSlotRecord): Promise<void> {
    await this.ensureDir(this.sessionRoot)
    await appendFile(
      join(this.sessionRoot, 'slots.jsonl'),
      `${JSON.stringify(record)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    )
  }

  /**
   * Read the register log in write order. A missing file is an empty register.
   * A malformed line — a half-written tail from a crash, or hand-edited garbage —
   * is skipped rather than fatal: the register degrades to its readable prefix,
   * the same posture the frontier cache takes.
   * @returns every parseable row, oldest first.
   */
  async loadSlotRows(): Promise<CheckpointSlotRecord[]> {
    let text: string
    try {
      text = await readFile(join(this.sessionRoot, 'slots.jsonl'), 'utf8')
    } catch {
      return []
    }
    const rows: CheckpointSlotRecord[] = []
    for (const line of text.split('\n')) {
      if (line === '') continue
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        continue
      }
      const record = readSlotRecord(parsed)
      if (record !== undefined) rows.push(record)
    }
    return rows
  }
}

/**
 * One parsed `slots.jsonl` line that names a slot; put rows must additionally
 * carry the core fields the fold renders, release rows only the tombstone key.
 * @param value - the parsed JSON line.
 * @returns the row, or undefined when the line is not a register row.
 */
function readSlotRecord(value: unknown): CheckpointSlotRecord | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  if (typeof row['slotId'] !== 'string' || row['slotId'] === '') return undefined
  if (row['released'] === true) return { slotId: row['slotId'] as CheckpointSlotRecord['slotId'], released: true }
  if (row['released'] !== undefined) return undefined
  if (typeof row['kind'] !== 'string' || row['kind'] === '') return undefined
  if (typeof row['path'] !== 'string') return undefined
  if (typeof row['label'] !== 'string') return undefined
  if (typeof row['createdAt'] !== 'number' || !Number.isFinite(row['createdAt'])) return undefined
  if (typeof row['detail'] !== 'object' || row['detail'] === null) return undefined
  return row as unknown as CheckpointSlotRecord
}
