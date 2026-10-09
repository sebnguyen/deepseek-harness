/**
 * The register read behind the gutter: one observable snapshot per session
 * binding, re-fetched from `remote.checkpoint.slots` whenever the binding's
 * revision bumps, the idiom the file-history fold rides.
 */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { CheckpointSlot, CheckpointSlotTimeline } from '@deepseek-ai/dsh-checkpoint/types'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'

/** One session's live note slots, grouped by session-relative path. */
export interface LineNotesSnapshot {
  /** Note slots per path; absent paths hold no entries. */
  readonly byPath: ReadonlyMap<string, readonly CheckpointSlot[]>
}

/** The snapshot no slot has content for. */
export const EMPTY_LINE_NOTES: LineNotesSnapshot = { byPath: new Map() }

/** The note-fetching face the source closes over. */
export interface LineNotesRemote {
  /** The register as a file-to-slot-array map. */
  readonly slots: (sessionId: string) => Promise<CheckpointSlotTimeline[]>
}

/**
 * Mint one note slot id: `note-` plus twelve random hex characters.
 * @returns a fresh, collision-improbable slot id.
 */
export function mintNoteId(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return `note-${hex}`
}

/** Fold the register's timelines to their note slots by path. */
function foldNotes(timelines: readonly CheckpointSlotTimeline[]): LineNotesSnapshot {
  const byPath = new Map<string, CheckpointSlot[]>()
  for (const timeline of timelines) {
    const notes = timeline.slots.filter(slot => slot.kind === 'note')
    if (notes.length > 0) byPath.set(timeline.path, notes)
  }
  return { byPath }
}

/**
 * One observable register read per binding; stale fetches never land.
 * @param binding - the session binding whose revision bounds staleness.
 * @param remote - the checkpoint namespace face.
 * @returns the snapshot source the session hook exposes.
 */
export function lineNotesSource(binding: SessionBinding, remote: LineNotesRemote): ObservableSnapshot<LineNotesSnapshot> {
  let current: LineNotesSnapshot = EMPTY_LINE_NOTES
  let fetchedKey = ''
  let pending: string | undefined
  const listeners = new Set<() => void>()
  const fetchFor = (key: string): void => {
    pending = key
    void remote.slots(binding.sessionId).then((timelines) => {
      if (pending !== key) return
      current = foldNotes(timelines)
      for (const listener of listeners) listener()
    })
  }
  return {
    getSnapshot: () => {
      const key = `${String(binding.eventSource.getSnapshot().revision)}`
      if (key !== fetchedKey) {
        fetchedKey = key
        fetchFor(key)
      }
      return current
    },
    subscribe: (listener) => {
      listeners.add(listener)
      const stop = binding.eventSource.subscribe(listener)
      return () => {
        listeners.delete(listener)
        stop()
      }
    },
  }
}
