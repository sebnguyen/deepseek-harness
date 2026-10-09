/** Covers the register projection and its turn-granularity zoom. */

import { describe, expect, it } from 'vitest'
import type { CheckpointSlot, CheckpointSlotId, CheckpointSlotTimeline, SnapshotDigest } from '@deepseek-ai/dsh-checkpoint/types'
import { foldSlotTimelines, groupStopsByTurn, type FileStop } from '../src/client/fold.ts'

/** Plain-string stand-ins for the branded slot fields the Remote would mint. */
interface SlotFixture {
  readonly slotId: string
  readonly createdAt: number
  readonly kind?: string
  readonly path?: string
  readonly label?: string
  readonly turn?: number
  readonly callId?: string
  readonly line?: number
  readonly before?: string
  readonly after?: string
  readonly detail?: Readonly<Record<string, unknown>>
}

/**
 * Build one register slot. These specs judge the projection's field mapping,
 * so the slots are literals: the Remote adds envelope fields the fold never
 * reads, and the branded identity fields are minted here as plain strings.
 * @param fields - the slot members under test.
 * @returns the slot carrying them.
 */
function slot(fields: SlotFixture): CheckpointSlot {
  return {
    kind: fields.kind ?? 'worktree',
    path: fields.path ?? 'a.txt',
    label: fields.label ?? 'writer',
    detail: (fields.detail ?? { toolName: 'writer' }) as CheckpointSlot['detail'],
    slotId: fields.slotId as CheckpointSlotId,
    createdAt: fields.createdAt,
    ...fields.turn === undefined ? {} : { turn: fields.turn },
    ...fields.callId === undefined ? {} : { callId: fields.callId },
    ...fields.line === undefined ? {} : { line: fields.line },
    ...fields.before === undefined ? {} : { before: fields.before as SnapshotDigest },
    ...fields.after === undefined ? {} : { after: fields.after as SnapshotDigest },
  }
}

/** One register timeline over the given slots. */
function timeline(path: string, slots: readonly CheckpointSlot[]): CheckpointSlotTimeline {
  return { path, slots }
}

describe('foldSlotTimelines', () => {
  it('maps each worktree slot onto a stop of its file', () => {
    const history = foldSlotTimelines([timeline('a.txt', [
      slot({ slotId: 'c1', createdAt: 7, turn: 1, after: 'sha256:one', detail: { toolName: 'write' } }),
      slot({ slotId: 'c2', createdAt: 9, turn: 1, before: 'sha256:one', after: 'sha256:two', detail: { toolName: 'edit' } }),
    ])])
    expect(history.files).toEqual([{
      path: 'a.txt',
      stops: [
        { seq: 7, time: 7, callId: 'c1', toolName: 'write', turn: 1, after: 'sha256:one' },
        { seq: 9, time: 9, callId: 'c2', toolName: 'edit', turn: 1, before: 'sha256:one', after: 'sha256:two' },
      ],
    }])
  })

  it('filters out non-worktree slots', () => {
    const history = foldSlotTimelines([timeline('a.txt', [
      slot({ slotId: 'c1', createdAt: 7, after: 'sha256:one' }),
      slot({ slotId: 'note-1', createdAt: 8, kind: 'note', line: 4, detail: { text: 'fix this' } }),
    ])])
    expect(history.files[0]?.stops.map(stop => stop.callId)).toEqual(['c1'])
  })

  it('folds absolute slot paths relative to the session working directory and sorts files by path', () => {
    const history = foldSlotTimelines([
      timeline('/ws/a.txt', [slot({ slotId: 'c1', createdAt: 4, after: 'sha256:a' })]),
      timeline('/other/b.txt', [slot({ slotId: 'c1', createdAt: 4, after: 'sha256:b' })]),
    ], '/ws')
    expect(history.files.map(file => file.path)).toEqual(['/other/b.txt', 'a.txt'])
    const unchanged = foldSlotTimelines([timeline('/ws/a.txt', [slot({ slotId: 'c1', createdAt: 5, after: 'sha256:a' })])])
    expect(unchanged.files[0]?.path).toBe('/ws/a.txt')
  })

  it('names the tool from detail.toolName and falls back to the slot label', () => {
    const history = foldSlotTimelines([timeline('a.txt', [
      slot({ slotId: 'c1', createdAt: 1, label: 'write', detail: { toolName: 'write' }, after: 'sha256:a' }),
      slot({ slotId: 'c2', createdAt: 2, label: 'bash', detail: {}, after: 'sha256:b' }),
    ])])
    expect(history.files[0]?.stops.map(stop => stop.toolName)).toEqual(['write', 'bash'])
  })

  it('uses the call id when scoped and the slot id otherwise, sorting stops by creation time', () => {
    const history = foldSlotTimelines([timeline('a.txt', [
      slot({ slotId: 'c2', callId: 'c2', createdAt: 9, after: 'sha256:b' }),
      slot({ slotId: 'c1', callId: 'c1', createdAt: 7, after: 'sha256:a' }),
      slot({ slotId: 's3', createdAt: 8, after: 'sha256:c' }),
    ])])
    expect(history.files[0]?.stops.map(stop => stop.callId)).toEqual(['c1', 's3', 'c2'])
  })

  it('folds an empty register into an empty timeline', () => {
    expect(foldSlotTimelines([])).toEqual({ files: [] })
  })

  it('drops no capture members for a worktree slot without digests', () => {
    const history = foldSlotTimelines([timeline('a.txt', [slot({ slotId: 'cp', createdAt: 5, label: 'reader', detail: {} })])])
    expect(history.files).toEqual([{
      path: 'a.txt',
      stops: [{ seq: 5, time: 5, callId: 'cp', toolName: 'reader' }],
    }])
  })
})

describe('groupStopsByTurn', () => {
  /** One stop literal for the grouping cases. */
  const stop = (seq: number, turn?: number): FileStop => ({
    seq, time: seq, callId: `c${String(seq)}`, toolName: 'writer', ...turn === undefined ? {} : { turn },
  })

  it('keeps the last stop of each turn as the turn-end state', () => {
    expect(groupStopsByTurn([stop(1, 1), stop(2, 1), stop(3, 2), stop(4, 1)]).map(item => item.seq)).toEqual([2, 3, 4])
  })

  it('leaves stops without a logged turn as their own entries', () => {
    // The untracked stop never merges into a neighbouring turn, and the turn
    // after the gap starts a new entry rather than joining the earlier one.
    expect(groupStopsByTurn([stop(1, 1), stop(2), stop(3, 2)]).map(item => item.seq)).toEqual([1, 2, 3])
  })
})
