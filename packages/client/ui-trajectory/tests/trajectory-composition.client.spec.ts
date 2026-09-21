import { describe, expect, it } from 'vitest'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import {
  compositionBackfillThroughSeq, foldCompositionUpTo, tryFoldCompositionUpTo,
} from '../src/client/trajectory-composition.ts'

function surfaceEvent(
  seq: number,
  type: 'user/message' | 'system/message',
  surfaceOp: SessionEvent['surfaceOp'],
): SessionEvent {
  return {
    seq,
    time: seq,
    type,
    data: type === 'system/message'
      ? {
        turn: 1,
        step: 1,
        message: {
          role: 'system',
          content: [{ type: 'text', text: `system-${seq}` }],
          source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' },
          id: `msg-${seq}`,
        },
      }
      : {
        content: [{ type: 'text', text: `user-${seq}` }],
        source: { kind: 'user' },
        role: 'user',
        id: `msg-${seq}`,
      },
    surfaceOp,
  } as SessionEvent
}

describe('trajectory-composition fold', () => {
  it('replays a compaction replace when every shadowed seq is present', () => {
    const events = [
      surfaceEvent(1, 'system/message', 'append'),
      surfaceEvent(2, 'user/message', 'append'),
      surfaceEvent(3, 'user/message', 'append'),
      surfaceEvent(4, 'user/message', { op: 'replace', startSeq: SessionSeq(2), endSeq: SessionSeq(3) }),
    ]
    const nodes = foldCompositionUpTo(events, 4)
    expect(nodes.map(node => node.seq)).toEqual([1, 4])
  })

  it('pages to the session start so the surface head is always covered', () => {
    const events = [
      surfaceEvent(1, 'system/message', 'append'),
      surfaceEvent(4, 'user/message', { op: 'replace', startSeq: SessionSeq(2), endSeq: SessionSeq(3) }),
    ]
    expect(compositionBackfillThroughSeq(events, 4)).toBe(0)
  })

  it('backfills to the session start even when the leading system prompt is absent from the capture', () => {
    // The surface head (system prompt) is not loaded; a replace source is the
    // earliest captured seq. Backfill must still reach the session start so the
    // fold rebuilds from node 0 rather than silently omitting the prompt.
    const events = [
      surfaceEvent(4, 'user/message', { op: 'replace', startSeq: SessionSeq(2), endSeq: SessionSeq(3) }),
    ]
    expect(compositionBackfillThroughSeq(events, 4)).toBe(0)
  })

  it('returns undefined instead of throwing when replace targets are missing', () => {
    const events = [
      surfaceEvent(1, 'system/message', 'append'),
      surfaceEvent(4, 'user/message', { op: 'replace', startSeq: SessionSeq(2), endSeq: SessionSeq(3) }),
    ]
    expect(tryFoldCompositionUpTo(events, 4)).toBeUndefined()
    expect(() => foldCompositionUpTo(events, 4)).toThrow(/invalid current range/)
  })
})
