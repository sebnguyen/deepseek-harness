/**
 * Step pace: durable fold, pre-step pacing, and the setStepPace command.
 * The pacer must wait exactly the unspent remainder of the selected interval
 * since the previous `step/start`, skip before the first step, price naturally
 * slow turns at zero, and cut the wait short on turn cancellation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionCommandController } from '../src/commands.ts'
import { ApiSessionAgentController } from '../src/agent.ts'
import {
  MAX_STEP_PACE_MS,
  abortableSleep,
  installStepPacePacer,
  installStepPaceProjection,
  remainingPaceMs,
  stepPaceWireView,
} from '../src/step-pace.ts'
import type { StepPaceProjectionState } from '../src/types.ts'

const BASE = Date.parse('2026-07-14T00:00:00.000Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(BASE)
})

afterEach(() => {
  vi.useRealTimers()
})

async function mount(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  installStepPaceProjection(ctx)
  installStepPacePacer(ctx)
  return ctx
}

function fakeAgent(session: Session): Agent {
  return {
    id: SessionId('pace'),
    options: {},
    session,
    inbox: unsupportedInbox(),
    status: 'running',
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => { throw new Error('no injection') },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

/** Run one pre-step waterfall and settle it, returning wall-clock ms spent. */
async function firePreStep(ctx: Context, agent: Agent, signal: AbortSignal): Promise<number> {
  const started = Date.now()
  let resolvedAt = -1
  const decision = agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages: [], turn: 1, step: 2, signal },
    () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
  ).then((result) => {
    resolvedAt = Date.now()
    return result
  })
  await vi.advanceTimersByTimeAsync(MAX_STEP_PACE_MS)
  await decision
  return resolvedAt - started
}

describe('abortableSleep', () => {
  it('resolves immediately for an already-aborted signal', async () => {
    const abort = new AbortController()
    abort.abort()
    const started = Date.now()
    await abortableSleep(abort.signal, 60_000)
    expect(Date.now() - started).toBe(0)
  })

  it('resolves after the full interval when never aborted', async () => {
    const started = Date.now()
    const sleeping = abortableSleep(new AbortController().signal, 750)
    await vi.advanceTimersByTimeAsync(750)
    await sleeping
    expect(Date.now() - started).toBe(750)
  })
})

describe('remainingPaceMs', () => {
  it('renders the folded state unchanged for wire faces', () => {
    const state = { ms: 1500, lastStepStartAt: BASE }
    expect(stepPaceWireView(state)).toBe(state)
  })

  it('is zero before any selection or first step', () => {
    expect(remainingPaceMs({ ms: null, lastStepStartAt: 5 }, BASE)).toBe(0)
    expect(remainingPaceMs({ ms: 1000, lastStepStartAt: null }, BASE)).toBe(0)
  })

  it('is zero once the interval elapsed and the exact remainder before', () => {
    expect(remainingPaceMs({ ms: 1000, lastStepStartAt: BASE }, BASE + 1000)).toBe(0)
    expect(remainingPaceMs({ ms: 1000, lastStepStartAt: BASE }, BASE + 250)).toBe(750)
  })
})

describe('stepPace projection', () => {
  it('folds selections and step dispatch times', async () => {
    const ctx = await mount()
    const session = ctx.sessions.create()
    expect(ctx.sessionProjections.stateOf(session, 'stepPace')).toEqual({ ms: null, lastStepStartAt: null })
    session.append('step-pace', { ms: 1500 })
    session.append('step/start', { turn: 1, step: 1 })
    expect(ctx.sessionProjections.stateOf(session, 'stepPace')).toEqual({ ms: 1500, lastStepStartAt: BASE })
    // Same-ms selections fold to the retained state object.
    session.append('step-pace', { ms: 1500 })
    const state = ctx.sessionProjections.stateOf(session, 'stepPace') as StepPaceProjectionState
    expect(state.ms).toBe(1500)
    // Unrelated events leave the fold untouched.
    session.append('turn/start', { turn: 2 })
    expect(ctx.sessionProjections.stateOf(session, 'stepPace')).toEqual({ ms: 1500, lastStepStartAt: BASE })
  })
})

describe('pre-step pacer', () => {
  it('waits exactly the unspent remainder after a step dispatch', async () => {
    const ctx = await mount()
    const session = ctx.sessions.create()
    session.append('step-pace', { ms: 1200 })
    session.append('step/start', { turn: 1, step: 1 })
    vi.advanceTimersByTime(200)
    const waited = await firePreStep(ctx, fakeAgent(session), new AbortController().signal)
    expect(waited).toBe(1000)
  })

  it('pays nothing before the first step, without a selection, or after a slow turn', async () => {
    const ctx = await mount()
    const session = ctx.sessions.create()
    session.append('step-pace', { ms: 1200 })
    expect(await firePreStep(ctx, fakeAgent(session), new AbortController().signal))
      .toBeLessThan(1200)
    const unpaced = ctx.sessions.create()
    unpaced.append('step/start', { turn: 1, step: 1 })
    expect(await firePreStep(ctx, fakeAgent(unpaced), new AbortController().signal)).toBe(0)
    const slow = ctx.sessions.create()
    slow.append('step-pace', { ms: 1200 })
    slow.append('step/start', { turn: 1, step: 1 })
    vi.advanceTimersByTime(5000)
    expect(await firePreStep(ctx, fakeAgent(slow), new AbortController().signal)).toBe(0)
  })

  it('skips the wait entirely when the turn was cancelled before pre-step', async () => {
    const ctx = await mount()
    const session = ctx.sessions.create()
    session.append('step-pace', { ms: 5000 })
    session.append('step/start', { turn: 1, step: 1 })
    const abort = new AbortController()
    abort.abort()
    expect(await firePreStep(ctx, fakeAgent(session), abort.signal)).toBe(0)
  })

  it('cuts the wait short when the turn is cancelled mid-pace', async () => {
    const ctx = await mount()
    const session = ctx.sessions.create()
    session.append('step-pace', { ms: 5000 })
    session.append('step/start', { turn: 1, step: 1 })
    const agent = fakeAgent(session)
    const abort = new AbortController()
    const started = Date.now()
    let resolvedAt = -1
    const decision = agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [], turn: 1, step: 2, signal: abort.signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
    ).then((result) => {
      resolvedAt = Date.now()
      return result
    })
    await vi.advanceTimersByTimeAsync(300)
    abort.abort()
    await decision
    expect(resolvedAt - started).toBeLessThan(5000)
  })
})

describe('setStepPace command', () => {
  async function commandHarness(): Promise<{ commands: SessionCommandController; sessionId: SessionId; session: Session }> {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(TypertRegistry)
    const session = ctx.sessions.create()
    ctx.agents.register({
      id: session.id,
      session,
      status: 'running',
      ctx,
      options: {},
      inbox: { nextTurn: [], nextStep: [] },
      send: () => {},
      followup: () => {},
      steer: () => {},
      inject: () => {},
      cancel: () => {},
      runMaintenance: (task: (signal: AbortSignal) => Promise<void>) => task(new AbortController().signal),
      whenIdle: () => Promise.resolve(),
    } as unknown as Agent)
    const agents = new ApiSessionAgentController(ctx)
    const commands = new SessionCommandController(ctx, agents, process.cwd())
    return { commands, sessionId: session.id, session }
  }

  it('persists one valid selection per Session', async () => {
    const { commands, sessionId, session } = await commandHarness()
    expect(await commands.setStepPace({ sessionId, ms: 2500 })).toEqual({ ms: 2500 })
    expect(session.snapshotEvents().at(-1)).toMatchObject({ type: 'step-pace', data: { ms: 2500 } })
    expect(await commands.setStepPace({ sessionId, ms: 0 })).toEqual({ ms: 0 })
  })

  it.each([
    [-1, 'negative'],
    [0.5, 'fractional'],
    [MAX_STEP_PACE_MS + 1, 'above the ceiling'],
  ])('rejects a %s pace', async (ms) => {
    const { commands, sessionId } = await commandHarness()
    await expect(commands.setStepPace({ sessionId, ms }))
      .rejects.toThrow('step pace must be a whole number of milliseconds')
  })
})
