/**
 * The register read: revision-keyed fetches fold note slots per path,
 * stale fetches never land, and minted ids keep their shape.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import { noteLines } from '../src/client/LineNoteGutter.tsx'
import { lineNotesSource, mintNoteId, EMPTY_LINE_NOTES } from '../src/client/source.ts'
import type { LineNotesRemote } from '../src/client/source.ts'

/** One binding whose revision the test advances by hand. */
function binding(revisionBox: { revision: number }) {
  const listeners = new Set<() => void>()
  return {
    binding: {
      sessionId: 's-1',
      eventSource: {
        getSnapshot: () => revisionBox,
        subscribe: (listener: () => void) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      },
    } as unknown as SessionBinding,
    listeners,
  }
}

describe('mintNoteId', () => {
  it('mints note- prefixed twelve-hex ids, distinct across calls', () => {
    const one = mintNoteId()
    const two = mintNoteId()
    expect(one).toMatch(/^note-[0-9a-f]{12}$/)
    expect(two).toMatch(/^note-[0-9a-f]{12}$/)
    expect(one).not.toBe(two)
  })
})

describe('noteLines', () => {
  it('lists pinned lines and skips slots without one', () => {
    expect(noteLines([
      { slotId: 'note-a', kind: 'note', path: 'a', label: 'x', line: 4, createdAt: 1, detail: { text: 'x' } },
      { slotId: 'note-b', kind: 'note', path: 'a', label: 'y', createdAt: 2, detail: { text: 'y' } },
    ] as never)).toEqual([4])
  })
})

describe('lineNotesSource', () => {
  const TIMELINES = [{
    path: 'notes.txt',
    slots: [{ slotId: 'note-a', kind: 'note', path: 'notes.txt', label: 'careful', line: 2, createdAt: 1, detail: { text: 'careful' } }],
  }]

  it('starts empty, fetches per revision, and folds note slots by path', async () => {
    const box = { revision: 0 }
    const { binding: one, listeners } = binding(box)
    const remote: LineNotesRemote = { slots: vi.fn(() => Promise.resolve(TIMELINES as never)) }
    const source = lineNotesSource(one, remote)
    expect(source.getSnapshot()).toBe(EMPTY_LINE_NOTES)
    const listener = vi.fn()
    const off = source.subscribe(listener)
    await vi.waitFor(() => {
      expect(source.getSnapshot().byPath.get('notes.txt')).toHaveLength(1)
    })
    expect(listener).toHaveBeenCalled()
    expect(listeners.size).toBe(1)
    off()
    expect(listeners.size).toBe(0)
  })

  it('refetches when the revision bumps and drops a stale answer', async () => {
    const box = { revision: 0 }
    const { binding: one } = binding(box)
    let releaseFirst: (() => void) | undefined
    let releaseSecond: (() => void) | undefined
    const first = new Promise<never[]>((resolve) => { releaseFirst = () => { resolve(TIMELINES as never) } })
    const second = new Promise<never[]>((resolve) => { releaseSecond = () => { resolve([]) } })
    const calls: number[] = []
    const remote: LineNotesRemote = {
      slots: vi.fn(() => {
        calls.push(calls.length)
        return calls.length === 1 ? first : second
      }),
    }
    const source = lineNotesSource(one, remote)
    source.getSnapshot()
    box.revision = 1
    source.getSnapshot()
    releaseSecond?.()
    await vi.waitFor(() => {
      expect(source.getSnapshot().byPath.size).toBe(0)
    })
    // The stale first answer settles late and must not land over the newer one.
    releaseFirst?.()
    await Promise.resolve()
    expect(source.getSnapshot().byPath.size).toBe(0)
  })

  it('folds timelines without note slots as no notes', async () => {
    const box = { revision: 0 }
    const { binding: one } = binding(box)
    const remote: LineNotesRemote = {
      slots: vi.fn(() => Promise.resolve([{
        path: 'stop-only.txt',
        slots: [{ slotId: 'c1', kind: 'stop', path: 'stop-only.txt', label: 'w', createdAt: 1 }],
      }] as never)),
    }
    const source = lineNotesSource(one, remote)
    source.getSnapshot()
    await vi.waitFor(() => {
      expect(source.getSnapshot().byPath.size).toBe(0)
      expect(source.getSnapshot()).not.toBe(EMPTY_LINE_NOTES)
    })
  })
})
