/**
 * Package-owned durable claim-stream invariants.
 *
 * Two relations are checked here that the projection cannot report. The first
 * crosses owners: `turn/*` boundaries are written by the agent loop while
 * `claim/*` records are written by this package's service, so a claim recorded
 * outside an open turn, or a turn that ends with its claim unsettled, means
 * two independently written streams disagree. The second is internal: the
 * projection latches a malformed payload as `failure` and keeps serving the
 * claims it could decode, while this companion refuses to let that stream pass.
 *
 * @module @deepseek-ai/dsh-claim/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { applyClaimEvent, emptyClaimFoldState } from './fold.ts'
import type { ClaimFoldState } from './fold.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-claim'

/** Cordis companion plugin name. */
export const name = 'claim-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Every event type this companion traces. */
const TRACED = new Set(['turn/start', 'turn/end', 'claim/declared', 'claim/result', 'claim/settled'])

/** Independently observed claim-stream trace, separate from the projection fold. */
interface ClaimTrace {
  /** Turn opened by the latest `turn/start`, or null between turns. */
  openTurn: number | null
  /** Claim ids declared in the open turn and not yet settled. */
  openClaims: Set<string>
}

/** Copy the independent fold before validating one candidate event. */
function cloneState(state: ClaimFoldState): ClaimFoldState {
  return { claims: [...state.claims] }
}

/** Apply one event through the strict claim decoder and attribute failures. */
function applyChecked(state: ClaimFoldState, event: SessionEvent, fail: InvariantFailure): void {
  try {
    applyClaimEvent(state, event)
  } catch (error) {
    /* v8 ignore next -- the strict claim decoder throws Error instances */
    const message = error instanceof Error ? error.message : String(error)
    fail(`session event ${event.seq} violates the durable claim stream: ${message}`)
  }
}

/** Reject a claim record whose own turn field is not the open turn. */
function requireOwnTurn(trace: ClaimTrace, event: SessionEvent, fail: InvariantFailure): void {
  if (trace.openTurn === null) {
    fail(`${event.type} appended outside any open turn`)
    return
  }
  const turn = (event.data as { turn?: unknown }).turn
  if (turn !== trace.openTurn) fail(`${event.type} names turn ${String(turn)} but the open turn is ${trace.openTurn}`)
}

/**
 * Advance one event through both the fold and the cross-owner trace.
 * @param fold - independent claim fold, advanced in place.
 * @param trace - independent turn/claim trace, advanced in place.
 * @param event - committed session event to check.
 * @param fail - invariant failure reporter.
 */
function track(fold: ClaimFoldState, trace: ClaimTrace, event: SessionEvent, fail: InvariantFailure): void {
  if (!TRACED.has(event.type)) return
  applyChecked(fold, event, fail)
  switch (event.type) {
    case 'turn/start':
      trace.openTurn = event.data.turn
      return
    case 'turn/end':
      if (trace.openClaims.size > 0) {
        fail(`turn ${event.data.turn} ended with claims [${[...trace.openClaims].join(', ')}] unsettled: the settling policy did not run`)
      }
      trace.openTurn = null
      trace.openClaims.clear()
      return
    case 'claim/declared':
      requireOwnTurn(trace, event, fail)
      trace.openClaims.add(event.data.id)
      return
    case 'claim/result':
      requireOwnTurn(trace, event, fail)
      return
    case 'claim/settled':
      requireOwnTurn(trace, event, fail)
      trace.openClaims.delete(event.data.id)
      return
    /* v8 ignore next 2 -- TRACED narrows the switch to the cases above */
    default:
      return
  }
}

/** Install an independent incremental fold over every attached session. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const states = new WeakMap<Session, ClaimFoldState>()
  const traces = new WeakMap<Session, ClaimTrace>()
  const staged = new WeakMap<SessionEvent, { session: Session; state: ClaimFoldState; trace: ClaimTrace }>()

  const seed = (session: Session): ClaimTrace => {
    const state = emptyClaimFoldState()
    const trace: ClaimTrace = { openTurn: null, openClaims: new Set() }
    for (const event of session.snapshotEvents()) track(state, trace, event, fail)
    states.set(session, state)
    traces.set(session, trace)
    return trace
  }
  /* v8 ignore next -- session/event always follows list() or session/created seeding */
  const traceFor = (session: Session): ClaimTrace => traces.get(session) ?? seed(session)

  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    const state = cloneState(states.get(session) ?? emptyClaimFoldState())
    const trace = { ...traceFor(session) }
    track(state, trace, event, fail)
    staged.set(event, { session, state, trace })
  }, { global: true })
  ctx.on('session/event', (session, event) => {
    const candidate = staged.get(event)
    /* v8 ignore next 2 -- internal/dispatch stages the exact callback arguments */
    if (candidate === undefined || candidate.session !== session) {
      return fail('session/event reached publication without matching claim-fold validation')
    }
    staged.delete(event)
    states.set(session, candidate.state)
    traces.set(session, candidate.trace)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the claim-stream invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
