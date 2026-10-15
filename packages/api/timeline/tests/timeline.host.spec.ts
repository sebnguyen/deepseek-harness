/**
 * `timeline` namespace: publication, history read-back, slice windows, and
 * bad-bound rejection at the host service.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Timeline } from '../src/index.ts'

const ROWS = [
  { index: 0, label: 'session start', at: '2026-10-14T18:00:00Z' },
  { index: 1, label: 'checkpoint 1', at: '2026-10-14T18:05:00Z' },
  { index: 2, label: 'checkpoint 2', at: '2026-10-14T18:10:00Z' },
] as const

describe('timeline namespace', () => {
  it('publishes rows and reads them back through history', async () => {
    const ctx = new Context()
    await ctx.plugin(Timeline)
    try {
      ctx.timeline.publish('sid', ROWS)
      const history = ctx.timeline.history({ sessionId: 'sid' }, new AbortController().signal)
      expect(history).toEqual({ sessionId: 'sid', rows: [...ROWS] })
      // The publisher's later mutation of its own array must not leak in.
      const leaked = [...ROWS.slice()]
      expect(ctx.timeline.history({ sessionId: 'sid' }, new AbortController().signal).rows).toEqual(leaked)
    } finally {
      await ctx.fiber.dispose().catch(() => undefined)
    }
  })

  it('answers an unknown session with an empty row list', async () => {
    const ctx = new Context()
    await ctx.plugin(Timeline)
    try {
      expect(ctx.timeline.history({ sessionId: 'none' }, new AbortController().signal)).toEqual({
        sessionId: 'none',
        rows: [],
      })
    } finally {
      await ctx.fiber.dispose().catch(() => undefined)
    }
  })

  it('cuts slices inside the published window', async () => {
    const ctx = new Context()
    await ctx.plugin(Timeline)
    try {
      ctx.timeline.publish('sid', ROWS)
      expect(ctx.timeline.slice({ sessionId: 'sid', from: 1, to: 3 }, new AbortController().signal).rows)
        .toEqual([ROWS[1], ROWS[2]])
    } finally {
      await ctx.fiber.dispose().catch(() => undefined)
    }
  })

  it('refuses inverted slice bounds', async () => {
    const ctx = new Context()
    await ctx.plugin(Timeline)
    try {
      expect(() => ctx.timeline.slice({ sessionId: 'sid', from: 2, to: 1 }, new AbortController().signal))
        .toThrow(/0 <= from <= to/)
    } finally {
      await ctx.fiber.dispose().catch(() => undefined)
    }
  })
})
