/**
 * Snapshot stop addresses and turn frames: `@` grammar round-trips,
 * gap slots, call-id stop keying, and stop-only frame reconstruction.
 */
import { describe, expect, it } from 'vitest'
import { parseNoteRef } from '../src/snapshot-ref.ts'
import {
  GAP_TURN, findStop, frameDiff, frameForTurn, parseSnapshotRef, serializeSnapshotRef,
  type SnapshotStop,
} from '@deepseek-ai/dsh-client-ui-primitives'

describe('parseSnapshotRef', () => {
  it('parses path, numeric turn, and call id', () => {
    expect(parseSnapshotRef('scan.ts#4#call-7f2')).toEqual({ path: 'scan.ts', turn: 4, callId: 'call-7f2' })
    expect(parseSnapshotRef('dir/a b.ts#12#call-9')).toEqual({ path: 'dir/a b.ts', turn: 12, callId: 'call-9' })
  })

  it('keeps `#` inside the path, splitting only the last two separators', () => {
    expect(parseSnapshotRef('we#ird.ts#2#call-3b8')).toEqual({ path: 'we#ird.ts', turn: 2, callId: 'call-3b8' })
  })

  it('accepts the gap turn slot', () => {
    expect(parseSnapshotRef('scan.ts#gap#call-5e0')).toEqual({ path: 'scan.ts', turn: GAP_TURN, callId: 'call-5e0' })
  })

  it('rejects a path that carries no separators', () => {
    expect(parseSnapshotRef('scan.ts#4#call-a#b')).toBeUndefined()
  })

  it('rejects every malformed shape', () => {
    expect(parseSnapshotRef('scan.ts')).toBeUndefined()
    expect(parseSnapshotRef('#4#call')).toBeUndefined()
    expect(parseSnapshotRef('scan.ts#4#')).toBeUndefined()
    expect(parseSnapshotRef('scan.ts##call')).toBeUndefined()
    expect(parseSnapshotRef('scan.ts#x#call')).toBeUndefined()
    expect(parseSnapshotRef('scan.ts#-1#call')).toBeUndefined()
    expect(parseSnapshotRef('')).toBeUndefined()
  })
})

describe('serializeSnapshotRef', () => {
  it('round-trips parse including the gap slot', () => {
    for (const text of ['scan.ts#4#call-7f2', 'scan.ts#gap#call-5e0', 'a/b#c.ts#1#call-1']) {
      const ref = parseSnapshotRef(text)
      expect(ref).toBeDefined()
      expect(serializeSnapshotRef(ref!)).toBe(text)
    }
  })
})

describe('findStop', () => {
  it('keys stops by call id across files', () => {
    const stops: SnapshotStop[] = [{ callId: 'call-1', turn: 1 }, { callId: 'call-2', turn: 2, after: 'd2' }]
    expect(findStop(parseSnapshotRef('f#2#call-2')!, stops)).toBe(stops[1])
    expect(findStop(parseSnapshotRef('f#9#call-9')!, stops)).toBeUndefined()
  })
})

describe('frameForTurn', () => {
  const stops: SnapshotStop[] = [
    { callId: 'c1', turn: 1, after: 'a1' },
    { callId: 'c2', turn: 2, before: 'a1', after: 'a2' },
    { callId: 'c3', turn: 2, before: 'a2', after: 'a3' },
    { callId: 'c4', turn: 3, before: 'a3' },
  ]

  it('is undefined for a turn the file never touched', () => {
    expect(frameForTurn(stops, 9)).toBeUndefined()
  })

  it('marks the first appearance with no start and the last stop as end', () => {
    expect(frameForTurn(stops, 1)).toEqual({
      turn: 1,
      start: undefined,
      end: { callId: 'c1', after: 'a1' },
      broken: false,
    })
  })

  it('collapses a multi-call turn to first start and last end', () => {
    expect(frameForTurn(stops, 2)).toEqual({
      turn: 2,
      start: { callId: 'c2', before: 'a1' },
      end: { callId: 'c3', after: 'a3' },
      broken: false,
    })
  })

  it('points at the prior stop without an after when that stop left too', () => {
    const edge: SnapshotStop[] = [{ callId: 'c1', turn: 1, before: 'z' }, { callId: 'c2', turn: 2, after: 'a2' }]
    const frame = frameForTurn(edge, 2)
    expect(frame?.start).toEqual({ callId: 'c1' })
    expect(frame?.end).toEqual({ callId: 'c2', after: 'a2' })
  })

  it('falls back to the prior turn end when the first stop lacks before', () => {
    const loose: SnapshotStop[] = [{ callId: 'c1', turn: 1, after: 'a1' }, { callId: 'c2', turn: 2, after: 'a2' }]
    expect(frameForTurn(loose, 2)).toEqual({
      turn: 2,
      start: { callId: 'c1', after: 'a1' },
      end: { callId: 'c2', after: 'a2' },
      broken: false,
    })
  })

  it('carries the gap flag and brokenness without losing the edges', () => {
    const gappy: SnapshotStop[] = [
      { callId: 'c1', turn: 1, after: 'a1' },
      { callId: 'c2', turn: 2, gap: true, before: 'a1', after: 'a2' },
    ]
    expect(frameForTurn(gappy, 2)).toEqual({
      turn: 2,
      start: { callId: 'c2', before: 'a1', gap: true },
      end: { callId: 'c2', after: 'a2' },
      broken: true,
    })
  })

  it('leaves the end absent when the file left the workspace', () => {
    expect(frameForTurn(stops, 3)).toEqual({
      turn: 3,
      start: { callId: 'c4', before: 'a3' },
      end: undefined,
      broken: false,
    })
  })
})

describe('parseNoteRef', () => {
  it('parses path, L-prefixed line, and note id', () => {
    expect(parseNoteRef('notes.md#L3#note-a1b2c3d4e5f6'))
      .toEqual({ path: 'notes.md', line: 3, noteId: 'note-a1b2c3d4e5f6' })
    expect(parseNoteRef('dir/a b.ts#L41#note-000000000000'))
      .toEqual({ path: 'dir/a b.ts', line: 41, noteId: 'note-000000000000' })
  })

  it('keeps a hash inside the path, splitting only the last two separators', () => {
    expect(parseNoteRef('we#ird.ts#L2#note-9'))
      .toEqual({ path: 'we#ird.ts', line: 2, noteId: 'note-9' })
  })

  it('refuses malformed parts', () => {
    expect(parseNoteRef('notes.md#3#note-1')).toBeUndefined()
    expect(parseNoteRef('notes.md#L3#')).toBeUndefined()
    expect(parseNoteRef('#L3#note-1')).toBeUndefined()
    expect(parseNoteRef('notes.md#Lx#note-1')).toBeUndefined()
    expect(parseNoteRef('notes.md#L3')).toBeUndefined()
  })
})

describe('frameDiff', () => {
  it('counts added and removed lines across hunks', () => {
    const before = 'a\nb\nc\nd\ne\nf\ng\nh\n'
    // c rewritten to X and h deleted: three added lines, two removed.
    const after = 'a\nb\nX\nd\ne\nf\ng\nY\nZ\n'
    expect(frameDiff(before, after)).toEqual({ added: 3, removed: 2 })
  })

  it('treats absent sides as empty text', () => {
    expect(frameDiff(undefined, 'x\ny\n')).toEqual({ added: 2, removed: 0 })
    expect(frameDiff('x\ny\n', undefined)).toEqual({ added: 0, removed: 2 })
  })
})
