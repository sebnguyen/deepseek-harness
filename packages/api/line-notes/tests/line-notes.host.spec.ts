/**
 * `lineNotes` namespace: publish/state back-and-forth and the focus uplink's
 * validation plus host-local re-emit.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LineNotes } from '../src/index.ts'
import type { LineNoteFocusRequest } from '../src/types.ts'

const NOTES = [
  { id: 'n1', path: '/repo/a.ts', line: 3, text: 'first' },
  { id: 'n2', path: '/repo/b.ts', line: 9, text: 'second' },
] as const

const SIGNAL = new AbortController().signal

describe('lineNotes namespace', () => {
  it('publishes notes and serves them through state', async () => {
    const ctx = new Context()
    await ctx.plugin(LineNotes)
    try {
      ctx.lineNotes.publish('sid', NOTES)
      expect(ctx.lineNotes.state({ sessionId: 'sid' }, SIGNAL).notes).toEqual([...NOTES])
      expect(ctx.lineNotes.state({ sessionId: 'other' }, SIGNAL).notes).toEqual([])
    } finally {
      await ctx.fiber.dispose().catch(() => undefined)
    }
  })

  it('re-emits a focus uplink on the host context', async () => {
    const ctx = new Context()
    await ctx.plugin(LineNotes)
    const seen: LineNoteFocusRequest[] = []
    ctx.on('lineNotes/focus', (request) => { seen.push(request) })
    try {
      ctx.lineNotes.focus({ sessionId: 'sid', path: '/repo/a.ts', line: 3 }, SIGNAL)
      expect(seen).toEqual([{ sessionId: 'sid', path: '/repo/a.ts', line: 3 }])
    } finally {
      await ctx.fiber.dispose().catch(() => undefined)
    }
  })

  it('refuses a malformed focus uplink', async () => {
    const ctx = new Context()
    await ctx.plugin(LineNotes)
    try {
      expect(() => { ctx.lineNotes.focus({ sessionId: 'sid', path: '/repo/a.ts', line: 0 }, SIGNAL) })
        .toThrow(/positive safe integer/)
      expect(() => { ctx.lineNotes.focus({ sessionId: 'sid', path: '', line: 2 }, SIGNAL) })
        .toThrow(/non-empty/)
    } finally {
      await ctx.fiber.dispose().catch(() => undefined)
    }
  })
})
