/** Covers the workspace timeline fold and its turn-granularity zoom. */

import { describe, expect, it } from 'vitest'
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { foldFileHistory, groupStopsByTurn, type FileStop } from '../src/client/fold.ts'

/**
 * Build one log entry. These specs judge the fold's joins, so the events are
 * literals: a real store would add envelope fields the fold never reads.
 * @param event - the event envelope and payload under test.
 * @returns the window entry carrying it.
 */
function entry(event: { type: string; seq: number; time: number; data: unknown }): SessionEventLikeEntry {
  return { type: 'event', event: event as unknown as SessionEvent }
}

/** One `tool/call` event for a call that changed a file. */
function call(callId: string, turn: number, step: number, purpose?: string): SessionEventLikeEntry {
  return entry({
    type: 'tool/call',
    seq: 0,
    time: 0,
    data: { turn, step, callId, name: 'writer', arguments: '{}', ...purpose === undefined ? {} : { purpose } },
  })
}

/** One `checkpoint/scan` event carrying the given rows. */
function scan(seq: number, rows: readonly Record<string, unknown>[]): SessionEventLikeEntry {
  return entry({ type: 'checkpoint/scan', seq, time: seq, data: { rows } })
}

describe('foldFileHistory', () => {
  it('joins each row to the tool call that captured it', () => {
    const history = foldFileHistory([
      call('c1', 1, 2, 'first write'),
      scan(7, [{ path: 'a.txt', callId: 'c1', toolName: 'writer', after: 'sha256:one' }]),
      call('c2', 1, 3),
      scan(9, [{ path: 'a.txt', callId: 'c2', toolName: 'writer', before: 'sha256:one', after: 'sha256:two' }]),
    ])
    expect(history.files).toEqual([{
      path: 'a.txt',
      stops: [
        { seq: 7, time: 7, callId: 'c1', toolName: 'writer', purpose: 'first write', turn: 1, step: 2, after: 'sha256:one' },
        { seq: 9, time: 9, callId: 'c2', toolName: 'writer', turn: 1, step: 3, before: 'sha256:one', after: 'sha256:two' },
      ],
    }])
  })

  it('folds absolute row paths relative to the session working directory', () => {
    const history = foldFileHistory([
      scan(4, [
        { path: '/ws/a.txt', callId: 'c1', toolName: 'writer', after: 'sha256:a' },
        { path: '/other/b.txt', callId: 'c1', toolName: 'writer', after: 'sha256:b' },
      ]),
    ], '/ws')
    expect(history.files.map(file => file.path)).toEqual(['/other/b.txt', 'a.txt'])
    const unchanged = foldFileHistory([scan(5, [{ path: '/ws/a.txt', callId: 'c1', toolName: 'writer', after: 'sha256:a' }])])
    expect(unchanged.files[0]?.path).toBe('/ws/a.txt')
  })

  it('prefers the row purpose, keeps a removal stop, and sorts files by path', () => {
    const history = foldFileHistory([
      call('c1', 2, 1, 'from the call'),
      scan(5, [
        { path: 'b/c.txt', callId: 'c1', toolName: 'writer', purpose: 'from the row', after: 'sha256:x' },
        { path: 'a.txt', callId: 'c1', toolName: 'remover', before: 'sha256:y' },
      ]),
    ])
    expect(history.files.map(file => file.path)).toEqual(['a.txt', 'b/c.txt'])
    expect(history.files[1]?.stops[0]?.purpose).toBe('from the row')
    expect(history.files[0]?.stops[0]).toEqual({
      seq: 5, time: 5, callId: 'c1', toolName: 'remover', purpose: 'from the call', turn: 2, step: 1, before: 'sha256:y',
    })
  })

  it('keeps stops whose call facts were never logged, and ignores unrelated entries', () => {
    const transient = entry({ type: 'assistant/live-chunk', seq: 0, time: 0, data: {} })
    const history = foldFileHistory([
      call('c1', 1, 1),
      transient,
      entry({ type: 'assistant/message', seq: 3, time: 3, data: {} }),
      scan(4, [{ path: 'a.txt', callId: 'c9', toolName: 'writer', after: 'sha256:z' }]),
    ])
    expect(history.files[0]?.stops).toEqual([
      { seq: 4, time: 4, callId: 'c9', toolName: 'writer', after: 'sha256:z' },
    ])
  })

  it('folds an empty window into an empty timeline', () => {
    expect(foldFileHistory([])).toEqual({ files: [] })
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
