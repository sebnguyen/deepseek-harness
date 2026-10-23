/** The seat pump: hello regurgitation, namespaced fan-out, and reconnection backoff. */

import { describe, expect, it } from 'vitest'
import { runSeatLoop, SEAT_EVENT_PREFIX, type VscodeRemoteFace } from '../src/seat.ts'

class RemoteFake implements VscodeRemoteFace {
  readonly reports: unknown[] = []
  downlinkOpens = 0
  reportErrors: unknown[] = []
  downlinkError: unknown
  frames: unknown[] = []

  async report(request: unknown): Promise<unknown> {
    const error = this.reportErrors.shift()
    if (error !== undefined) throw error
    this.reports.push(request)
    return { ok: true }
  }

  async *downlink(_request: unknown, signal: AbortSignal): AsyncIterable<unknown> {
    this.downlinkOpens += 1
    if (this.downlinkError !== undefined) throw this.downlinkError
    for (const frame of this.frames) {
      if (signal.aborted) return
      yield frame
    }
    // Stream closed without error — the loop should spin once more.
  }
}

const HELLO_ID = {
  token: 'tkn-9',
  hello: { extensionId: 'dsh.do-harness-bridge', version: '0.1.0', workspaceRoot: '/repo' },
} as const

describe('runSeatLoop', () => {
  it('reports hello once on connect and namespaces every legal frame', async () => {
    const remote = new RemoteFake()
    remote.frames = [
      { type: 'ideBridge/open', path: '/repo/a.ts', line: 3 },
      { type: 'lineNotes/published', path: '/repo/a.ts' },
      { type: 'bogus', path: '/repo/rejected.ts' },
    ]
    const emitted: Array<[string, unknown]> = []
    const controller = new AbortController()
    let sleeps = 0
    const done = runSeatLoop({
      remote,
      identity: HELLO_ID,
      signal: controller.signal,
      emit: (name, frame) => emitted.push([name, frame]),
      sleep: async () => {
        sleeps += 1
        // Halt inside the first inter-cycle pause: exactly one connect cycle ran.
        if (sleeps >= 1) controller.abort()
      },
    })
    await done
    expect(remote.reports).toHaveLength(1)
    expect(remote.reports[0]).toMatchObject({
      token: 'tkn-9',
      event: { type: 'hello', extensionId: 'dsh.do-harness-bridge' },
    })
    expect(emitted).toEqual([
      [`${SEAT_EVENT_PREFIX}ideBridge/open`, { type: 'ideBridge/open', path: '/repo/a.ts', line: 3 }],
      [`${SEAT_EVENT_PREFIX}lineNotes/published`, { type: 'lineNotes/published', path: '/repo/a.ts' }],
      // 'bogus' has no extId/verb shape → refused.
    ])
  })

  it('drops non-object and illegible frames but passes downstream errors to the logger', async () => {
    const remote = new RemoteFake()
    remote.frames = [null, 42, { path: '/repo/no-type' }, { type: 'ideBridge/open', path: '/repo/a.ts' }]
    const emitted: unknown[] = []
    const logs: string[] = []
    const controller = new AbortController()
    const done = runSeatLoop({
      remote,
      identity: HELLO_ID,
      signal: controller.signal,
      emit: (_name, frame) => emitted.push(frame),
      sleep: async () => controller.abort(),
      logger: message => logs.push(message),
    })
    await done
    expect(emitted).toEqual([{ type: 'ideBridge/open', path: '/repo/a.ts' }])
    expect(logs.length).toBeGreaterThan(0)
  })

  it('reconnects with backoff after a report failure and resumes with a fresh hello', async () => {
    const remote = new RemoteFake()
    remote.reportErrors = [new Error('boom')]
    const sleeps: number[] = []
    const controller = new AbortController()
    const done = runSeatLoop({
      remote,
      identity: HELLO_ID,
      signal: controller.signal,
      emit: () => undefined,
      sleep: async (ms) => {
        sleeps.push(ms)
        if (remote.reports.length > 0) controller.abort()
      },
    })
    await done
    expect(remote.reports).toHaveLength(1)
    expect(sleeps.length).toBeGreaterThan(0)
    expect(Math.max(...sleeps)).toBeGreaterThanOrEqual(sleeps[0] ?? 0)
  })

  it('grows the backoff when the downlink dies immediately after each hello', async () => {
    const remote = new RemoteFake()
    remote.downlinkError = new Error('carrier lost')
    const sleeps: number[] = []
    const controller = new AbortController()
    const done = runSeatLoop({
      remote,
      identity: HELLO_ID,
      signal: controller.signal,
      emit: () => undefined,
      sleep: async (ms) => {
        sleeps.push(ms)
        if (sleeps.length >= 3) controller.abort()
      },
    })
    await done
    expect(remote.reports).toHaveLength(3)
    expect(sleeps).toEqual([500, 1000, 2000])
  })

  it('resets the backoff after a cycle stays up for stableAfterMs', async () => {
    const remote = new RemoteFake()
    remote.downlinkError = new Error('carrier lost')
    const sleeps: number[] = []
    const controller = new AbortController()
    const done = runSeatLoop({
      remote,
      identity: HELLO_ID,
      signal: controller.signal,
      emit: () => undefined,
      stableAfterMs: 0,
      sleep: async (ms) => {
        sleeps.push(ms)
        if (sleeps.length >= 3) controller.abort()
      },
    })
    await done
    expect(sleeps).toEqual([500, 500, 500])
  })

  it('stays silent after abort — no reports, no opens', async () => {
    const remote = new RemoteFake()
    const controller = new AbortController()
    controller.abort()
    await runSeatLoop({
      remote,
      identity: HELLO_ID,
      signal: controller.signal,
      emit: () => undefined,
      sleep: () => Promise.resolve(),
    })
    expect(remote.reports).toHaveLength(0)
    expect(remote.downlinkOpens).toBe(0)
  })
})
