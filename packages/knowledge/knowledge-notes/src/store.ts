/**
 * The note store: one plain JSON file per source-file note under the harness
 * home. Note files are harness state, not model file mutation, so writes go
 * through `node:fs` directly — the same channel session-log persistence uses —
 * instead of the sandbox-fenced `fs` capability. Reads use `ctx.fs` (never
 * fenced) to share its path resolution with the tools. The store is not
 * session state — replay never reads it.
 *
 * @module @deepseek-ai/dsh-knowledge-notes/store
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import type { NoteRecord, NoteState } from './types.ts'
import { sourceHash } from './hash.ts'

/** Tombstone an empty-claim delete leaves: a malformed record reads as no note. */
const TOMBSTONE = '{"deleted":true}'

/**
 * Whether a parsed store document is a well-formed note record. A malformed or
 * mislocated note reads as no note and is never deleted — the file is the
 * author's to fix through `upsert_note`, not the reader's to clean up.
 * @param value - the parsed store document.
 * @param target - the absolute path the record must claim.
 * @returns the validated record, or `undefined` when the document is not one.
 */
function asRecord(value: unknown, target: string): NoteRecord | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (record.target !== target) return undefined
  if (typeof record.claim !== 'string' || record.claim.length === 0) return undefined
  if (typeof record.affirmedAgainst !== 'string' || record.affirmedAgainst.length === 0) return undefined
  if (record.hashScheme !== 'source-norm@1') return undefined
  if (record.author !== 'agent') return undefined
  return record as unknown as NoteRecord
}

/**
 * Write one note file through `node:fs` directly, creating parent directories.
 * This is harness state, outside the sandbox fence — the same channel
 * session-log persistence uses — so a note persists regardless of the session
 * sandbox mode. A non-atomic write is accepted: a torn or truncated file
 * degrades to "no note" on read and is re-affirmed by a later `upsert_note`.
 * @param notePath - absolute note-file path (derived, never a free model path).
 * @param content - the complete document to store.
 * @param signal - caller-owned cancellation.
 */
async function writeNote(notePath: string, content: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  await mkdir(dirname(notePath), { recursive: true })
  await writeFile(notePath, content, 'utf8')
}

/**
 * Read and validate one note file. Every failure mode — absent file, unreadable
 * JSON, tombstone, schema mismatch, `target` disagreeing with the location —
 * yields `undefined`, the same answer as "no note".
 */
export class NoteStore {
  /**
   * @param fs - the filesystem capability used to resolve and read note files.
   * @param root - absolute store root, `<home>/knowledge/notes`.
   */
  constructor(private readonly fs: FileSystem, readonly root: string) {}

  /**
   * Derive the note file's path from the target's absolute path: the leading
   * separator dropped so the absolute path nests beneath the store root.
   * @param displayPath - absolute path of the source file.
   * @returns the absolute note-file path.
   */
  notePathFor(displayPath: string): string {
    const segments = displayPath.split(/[\\/]/u).filter(segment => segment.length > 0)
    return `${this.root}/${segments.join('/')}.json`
  }

  /**
   * Read the note for one resolved target. A note file is keyed by its
   * `target`, so a record found anywhere else is a mislocated note and reads
   * as no note.
   * @param target - the resolved source file.
   * @param signal - caller-owned cancellation.
   * @returns the note record, or `undefined` when none applies.
   */
  async forTarget(target: FsTarget, signal?: AbortSignal): Promise<NoteRecord | undefined> {
    // Note-about-note guard: a path under the store root never carries a note,
    // so reading a note file cannot chain a pointer onto its own read.
    if (target.displayPath === this.root || target.displayPath.startsWith(`${this.root}/`)) return undefined
    const record = await this.readRaw(this.notePathFor(target.displayPath), signal)
    if (record === undefined) return undefined
    return asRecord(record, target.displayPath)
  }

  /**
   * Report the display freshness of a note against its target.
   * @param target - the resolved source file.
   * @param note - the note record previously returned by {@link forTarget}.
   * @param signal - caller-owned cancellation.
   * @returns live, stale, or orphaned.
   */
  async stateOf(target: FsTarget, note: NoteRecord, signal?: AbortSignal): Promise<NoteState> {
    const info = await this.fs.stat(target, signal)
    if (info === undefined) return 'orphaned'
    const hash = sourceHash(await this.fs.readText(target, signal))
    return hash === note.affirmedAgainst ? 'live' : 'stale'
  }

  /**
   * Write one note record. The store is the only writer of note files and
   * writes unconditionally through `node:fs` — harness state, outside the
   * sandbox fence, like session-log persistence — so `upsert_note` persists a
   * note under every session sandbox mode.
   * @param record - the complete record to store.
   * @param signal - caller-owned cancellation.
   */
  async put(record: NoteRecord, signal?: AbortSignal): Promise<void> {
    const notePath = this.notePathFor(record.target)
    await writeNote(notePath, `${JSON.stringify(record, null, 2)}\n`, signal)
  }

  /**
   * Tombstone the note for one target. The filesystem capability has no
   * delete, so an empty-claim delete leaves the tombstone document, which
   * every reader treats exactly as an absent note.
   * @param target - the resolved source file whose note is retracted.
   * @param signal - caller-owned cancellation.
   */
  async remove(target: FsTarget, signal?: AbortSignal): Promise<void> {
    await writeNote(this.notePathFor(target.displayPath), `${TOMBSTONE}\n`, signal)
  }

  /**
   * Build `resolve` options without tripping `exactOptionalPropertyTypes` on an absent signal.
   * @param signal - caller-owned cancellation, when the caller has one.
   * @returns the resolve options.
   */
  private resolveOpts(signal?: AbortSignal): { cwd?: string; signal?: AbortSignal } {
    return signal === undefined ? {} : { signal }
  }

  /**
   * Read one note file's raw parsed document.
   * @param notePath - absolute note-file path.
   * @param signal - caller-owned cancellation.
   * @returns the parsed JSON value, or `undefined` for absence or a malformed file.
   */
  private async readRaw(notePath: string, signal?: AbortSignal): Promise<unknown> {
    let target: FsTarget
    try {
      target = await this.fs.resolve(notePath, this.resolveOpts(signal))
    } catch {
      // v8 ignore next 2 -- unreachable on the local backend, whose resolve never throws; the catch guards foreign backends.
      return undefined
    }
    if ((await this.fs.stat(target, signal))?.type !== 'file') return undefined
    try {
      return JSON.parse(await this.fs.readText(target, signal)) as unknown
    } catch {
      // A hand-edited or truncated note must degrade to "no note" — the pointer
      // stays silent — rather than fail the unrelated read that surfaced it.
      return undefined
    }
  }
}
