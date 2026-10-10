/**
 * Checkpoint-wire projections onto the frame's render records: the seat
 * renders exactly what the web renders from the same `checkpoint` and
 * `session` Remotes — notes become comment threads, stops become the
 * timeline chips — so the vocabulary on the wire is the house one and the
 * twin adds only the VS Code adapter half.
 */
import type {
  CheckpointSlot,
  CheckpointSlotTimeline,
  CheckpointTimeline,
} from '@deepseek-ai/dsh-checkpoint/types'
import type { NoteRecord } from './notes.ts'
import type { StopRecord } from './timeline.ts'

/** The slot kind the comment producer writes; the register keys details by it. */
export const NOTE_KIND = 'note'

function noteText(slot: CheckpointSlot): string | undefined {
  const detail = slot.detail
  return 'text' in detail ? detail.text : undefined
}

/**
 * Project one file's slot register onto the frame's note records: note-kind
 * slots with a pinned line, oldest first, in register order.
 * @param timeline - the per-file slots as `remote.checkpoint.slots` answers.
 * @returns the records the comment reconciliation converges over.
 */
export function notesOf(timeline: CheckpointSlotTimeline): NoteRecord[] {
  const notes: NoteRecord[] = []
  for (const slot of timeline.slots) {
    if (slot.kind !== NOTE_KIND || slot.line === undefined) continue
    const text = noteText(slot)
    if (text === undefined) continue
    // Checkpoint slots carry no retained line text; the thread states the
    // note and the retain snapshot stays a web-side affordance.
    notes.push({ id: slot.slotId, line: slot.line, text, retained: '', author: 'you' })
  }
  return notes
}

/**
 * Project one file's stop register onto the frame's timeline records:
 * stops that carry both a turn and a committed digest, oldest first.
 * @param timeline - the per-file stops as `remote.checkpoint.stops` answers.
 * @returns the records the timeline chip row renders.
 */
export function stopsOf(timeline: CheckpointTimeline): StopRecord[] {
  const stops: StopRecord[] = []
  for (const stop of timeline.stops) {
    if (stop.turn === undefined || stop.after === undefined) continue
    stops.push({ turn: stop.turn, tool: stop.toolName, after: stop.after })
  }
  return stops
}

/**
 * Pick the entry addressing one absolute workspace file from a register
 * answer: paths ride session-relative, the frame knows absolute editor
 * paths, and the seat's workspace root is the session cwd by deployment.
 * @param cwd - the absolute workspace root both sides agree on.
 * @param entries - the register answer's per-path entries.
 * @param absolutePath - the active editor's absolute file path.
 * @returns the matching entry, when the register has one for the file.
 */
export function entryFor<T extends { readonly path: string }>(
  cwd: string,
  entries: readonly T[],
  absolutePath: string,
): T | undefined {
  const base = cwd.replace(/\/$/u, '')
  const relative = absolutePath.startsWith(`${base}/`)
    ? absolutePath.slice(base.length + 1).split('\\').join('/')
    : absolutePath
  return entries.find(entry => entry.path === relative)
}
