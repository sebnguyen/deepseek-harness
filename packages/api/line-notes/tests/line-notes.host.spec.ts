/**
 * `lineNotes` namespace: notes project the checkpoint slot register, the
 * typed add uplink appends a note slot, and the focus uplink validates
 * before its host-local re-emit.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LineNotes } from '../src/index.ts'
import type { CheckpointSlot } from '@deepseek-ai/dsh-checkpoint/types'
import type { Session } from '@deepseek-ai/dsh-session'

const SIGNAL = new AbortController().signal
const SESSION = { id: 'sid' } as Session

interface CheckpointFake {
  timelines: unknown[]
  puts: Array<{ session: unknown; slot: Record<string, unknown> }>
}

/** A recording fake of the checkpoint service's two methods LineNotes consumes. */
function provideCheckpoint(ctx: Context): CheckpointFake {
  const guard = slot('n-seed', { line: 3, text: 'seeded', path: 'srckept.ts' })
  const fake: CheckpointFake = {
    timelines: [{ path: 'srckept.ts', slots: [guard, slot('w1', { kind: 'worktree', line: 9 })] }],
    puts: [],
  }
  ctx.provide('checkpoint', {
    slots: async () => [...fake.timelines],
    putSlotRemote: async (session: unknown, wire: Record<string, unknown>) => {
      fake.puts.push({ session, slot: wire })
      return wire
    },
  } as never)
  return fake
}

function slot(id: string, overrides: Record<string, unknown>): CheckpointSlot {
  return {
    slotId: id,
    kind: 'note',
    path: 'srckept.ts',
    label: 'seeded',
    line: 3,
    createdAt: 1_726_000_000_000,
    detail: { text: 'seeded' },
    ...overrides,
  } as unknown as CheckpointSlot
}

describe('lineNotes namespace', () => {
  it('projects note-kind slots from the checkpoint register through state', async () => {
    const ctx = new Context()
    provideCheckpoint(ctx)
    await ctx.plugin(LineNotes)
    try {
      const state = await ctx.lineNotes.state(SESSION, SIGNAL)
      expect(state.notes).toEqual([{ id: 'n-seed', path: 'srckept.ts', line: 3, text: 'seeded' }])
    } finally {
      await ctx.fiber.dispose().catch(() => undefined)
    }
  })

  it('adds one note slot into the register and returns its row', async () => {
    const ctx = new Context()
    const checkpoint = provideCheckpoint(ctx)
    await ctx.plugin(LineNotes)
    try {
      const note = await ctx.lineNotes.add(SESSION, {
        path: 'src/a.ts',
        line: 7,
        text: '  remember this  ',
        retained: 'const x = 1',
      }, SIGNAL)
      expect(note.id).toMatch(/^note-[0-9a-f]{12}$/)
      expect(note).toEqual({ id: note.id, path: 'src/a.ts', line: 7, text: 'remember this' })
      expect(checkpoint.puts).toEqual([{
        session: SESSION,
        slot: {
          slotId: note.id,
          kind: 'note',
          path: 'src/a.ts',
          label: 'remember this',
          line: 7,
          retained: 'const x = 1',
          detail: { text: 'remember this' },
        },
      }])
    } finally {
      await ctx.fiber.dispose().catch(() => undefined)
    }
  })

  it('refuses a malformed add request', async () => {
    const ctx = new Context()
    provideCheckpoint(ctx)
    await ctx.plugin(LineNotes)
    try {
      const good = { path: 'src/a.ts', line: 3, text: 'ok', retained: '' }
      await expect(ctx.lineNotes.add(SESSION, { ...good, path: '' }, SIGNAL)).rejects.toThrow(/non-empty/)
      await expect(ctx.lineNotes.add(SESSION, { ...good, line: 0 }, SIGNAL)).rejects.toThrow(/positive safe integer/)
      await expect(ctx.lineNotes.add(SESSION, { ...good, text: '   ' }, SIGNAL)).rejects.toThrow(/non-empty/)
      await expect(ctx.lineNotes.add(SESSION, { ...good, retained: undefined as unknown as string }, SIGNAL))
        .rejects.toThrow(/frozen line text/)
    } finally {
      await ctx.fiber.dispose().catch(() => undefined)
    }
  })

  it('re-emits a focus uplink on the host context and refuses a malformed one', async () => {
    const ctx = new Context()
    provideCheckpoint(ctx)
    await ctx.plugin(LineNotes)
    const seen: unknown[] = []
    ctx.on('lineNotes/focus', (request) => { seen.push(request) })
    try {
      ctx.lineNotes.focus({ sessionId: 'sid', path: '/repo/a.ts', line: 3, noteId: 'n-seed' }, SIGNAL)
      expect(seen).toEqual([{ sessionId: 'sid', path: '/repo/a.ts', line: 3, noteId: 'n-seed' }])
      expect(() => { ctx.lineNotes.focus({ sessionId: 'sid', path: '/repo/a.ts', line: 0 }, SIGNAL) })
        .toThrow(/positive safe integer/)
    } finally {
      await ctx.fiber.dispose().catch(() => undefined)
    }
  })
})
