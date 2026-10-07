/**
 * Content-addressed blob store for checkpoint snapshots. Objects live per
 * session below `<dshHome>/checkpoints/v1/<sessionId>/objects/xx/<sha256>`,
 * mirroring the attachment store's two-level fan-out and 0700 hardening.
 * Writes are idempotent: storing an existing digest is a stat, so repeated
 * scans over unchanged content never rewrite objects.
 * @module dsh-checkpoint/store
 */

import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SnapshotDigest } from './types.ts'

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
  constructor(private readonly sessionRoot: string) {}

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
   * Read the persisted path→digest frontier for this session. A missing or
   * malformed frontier file is an empty frontier: capture continuity is a
   * cache, and losing it must not fail a scan.
   * @returns the frontier map keyed by session-relative path.
   */
  async loadFrontier(): Promise<Map<string, SnapshotDigest>> {
    try {
      const parsed: unknown = JSON.parse(await readFile(join(this.sessionRoot, 'frontier.json'), 'utf8'))
      if (typeof parsed !== 'object' || parsed === null) return new Map()
      const frontier = new Map<string, SnapshotDigest>()
      for (const [path, digest] of Object.entries(parsed)) {
        if (typeof digest === 'string') frontier.set(path, digest as SnapshotDigest)
      }
      return frontier
    } catch {
      return new Map()
    }
  }

  /**
   * Persist the frontier so a resumed process keeps `before` digests truthful
   * without rereading the session log.
   * @param frontier - the post-scan path→digest map.
   */
  async saveFrontier(frontier: ReadonlyMap<string, SnapshotDigest>): Promise<void> {
    await this.ensureDir(this.sessionRoot)
    await writeFile(
      join(this.sessionRoot, 'frontier.json'),
      `${JSON.stringify(Object.fromEntries([...frontier].sort(([left], [right]) => left.localeCompare(right))), null, 0)}\n`,
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
}
