/**
 * Per-session step pacing: a durable, session-scoped minimum interval between
 * model request dispatches so the previous request's prefix has time to be
 * persisted into the provider's disk cache before the next request needs it.
 * The pacer sleeps in `agent/pre-step` for only the remainder of the interval
 * not already spent on real elapsed time since the previous `step/start`, so a
 * naturally slow turn pays nothing and a fast tool loop pays the gap. Pacing
 * never enters `request/header` and therefore never changes request bytes
 * itself; it trades wall-clock latency for provider cache-hit eligibility.
 *
 * @module @deepseek-ai/dsh-api-session-controller/step-pace
 */

import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { StepPaceProjectionState } from './types.ts'

/** Largest pace a Session may select, in milliseconds; beyond this a turn is unusably slow. */
export const MAX_STEP_PACE_MS = 10_000

/** Milliseconds a pre-step must still wait for one folded pace state at one clock reading. */
export function remainingPaceMs(state: StepPaceProjectionState, now: number): number {
  if (state.ms === null || state.lastStepStartAt === null) return 0
  const elapsed = now - state.lastStepStartAt
  return elapsed >= state.ms ? 0 : state.ms - elapsed
}

/** Resolve once `ms` elapses or the signal aborts, without rejecting. */
export function abortableSleep(signal: AbortSignal, ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(done, ms)
    function done(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

const stepPaceStateSchema = z.object({
  /** Selected minimum interval between request dispatches, or null before any selection. */
  ms: z.number().nullable(),
  /** `time` of the latest `step/start`, or null before the first step. */
  lastStepStartAt: z.number().nullable(),
}) as unknown as z.ZodType<StepPaceProjectionState>

/** Fold one Session event into the step-pace state. */
function applyStepPace(
  state: StepPaceProjectionState,
  event: SessionEvent,
): StepPaceProjectionState {
  if (event.type === 'step-pace') {
    return state.ms === event.data.ms ? state : { ...state, ms: event.data.ms }
  }
  if (event.type === 'step/start') {
    return { ...state, lastStepStartAt: event.time }
  }
  return state
}

/** Render the folded step-pace state for wire projection faces unchanged. */
export function stepPaceWireView(state: StepPaceProjectionState): StepPaceProjectionState {
  return state
}

/** The durable step-pace fold, visible to Clients through the wire projection. */
const stepPaceProjection = {
  key: 'stepPace',
  stateVersion: 1,
  stateSchema: stepPaceStateSchema,
  init: () => ({ ms: null, lastStepStartAt: null }),
  apply: applyStepPace,
  wire: {
    viewSchema: stepPaceStateSchema,
    view: stepPaceWireView,
  },
} satisfies ProjectionDefinition<'stepPace', StepPaceProjectionState>

/** Register the durable step-pace fold for every Session in `ctx`. */
export function installStepPaceProjection(ctx: Context): void {
  ctx.sessionProjections.register(stepPaceProjection)
}

/**
 * Sleep in every accepted pre-step for the unspent remainder of the Session's
 * selected pace, measured from the previous `step/start`, so consecutive fast
 * dispatches leave the provider time to persist the earlier prefix. The wait
 * resolves immediately on turn cancellation and before the very first step of
 * a Session (no previous dispatch to wait for).
 */
export function installStepPacePacer(ctx: Context): void {
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    if (!signal.aborted) {
      const state = ctx.sessionProjections.stateOf(agent.session, 'stepPace') as StepPaceProjectionState
      const wait = remainingPaceMs(state, Date.now())
      if (wait > 0) await abortableSleep(signal, wait)
    }
    return next()
  })
}
