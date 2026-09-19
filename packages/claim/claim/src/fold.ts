/**
 * Strict replay fold of durable claim facts. Every payload crosses a durable
 * boundary, so each shape is validated before it mutates fold state. The fold
 * reads only the events this package writes; the loop's `turn/*` boundaries
 * stay in the `turnBoundary` projection, which the service consults instead of
 * duplicating turn state here.
 * @module @deepseek-ai/dsh-claim
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Claim, ClaimId, ClaimSettlement, Verifier, VerifierOutcome, VerifierResult } from './types.ts'
import { ClaimError } from './runtime.ts'

/** Every event type the claim fold owns. */
const CLAIM_EVENT_TYPES = new Set(['claim/declared', 'claim/result', 'claim/settled'])

const VERIFIER_OUTCOMES = new Set<string>(['pass', 'fail', 'inconclusive', 'tampered'])
const BLOCK_CODES = new Set<string>([
  'abandoned',
  'repair-budget-exhausted',
  'verifier-unavailable',
])

/**
 * Incremental fold state over one session's claim stream.
 */
export interface ClaimFoldState {
  /** Every claim declared in this session, in turn order. */
  claims: Claim[]
}

/**
 * Create the empty fold state.
 * @returns fold state before any claim event.
 */
export function emptyClaimFoldState(): ClaimFoldState {
  return { claims: [] }
}

/** Reject a malformed durable payload at the replay boundary. */
function invalid(detail: string): never {
  throw new ClaimError(`invalid claim event: ${detail}`, 'CLAIM_INVALID_EVENT')
}

/** Validate a non-empty string field. */
function stringField(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) invalid(`${field} must be a non-empty string`)
  return value
}

/** Validate a positive integer turn number. */
function turnField(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    invalid(`${field} must be a positive safe integer`)
  }
  return value
}

/** Validate the one bound verifier. */
function verifierOf(value: unknown): Verifier {
  if (typeof value !== 'object' || value === null) invalid('verifier must be an object')
  const record = value as Record<string, unknown>
  return {
    source: stringField(record.source, 'verifier.source'),
    digest: stringField(record.digest, 'verifier.digest'),
  }
}

/** Validate one recorded verifier execution. */
function resultOf(value: unknown): VerifierResult {
  if (typeof value !== 'object' || value === null) invalid('result must be an object')
  const record = value as Record<string, unknown>
  const outcome = stringField(record.outcome, 'result.outcome')
  if (!VERIFIER_OUTCOMES.has(outcome)) invalid(`unknown verifier outcome ${outcome}`)
  if (typeof record.evidence !== 'string') invalid('result.evidence must be a string')
  return { outcome: outcome as VerifierOutcome, evidence: record.evidence }
}

/** Validate one settlement. */
function settlementOf(value: unknown): ClaimSettlement {
  if (typeof value !== 'object' || value === null) invalid('settlement must be an object')
  const record = value as Record<string, unknown>
  switch (record.kind) {
    case 'pending':
    case 'passed':
    case 'tampered':
      return { kind: record.kind }
    case 'blocked': {
      const code = stringField(record.code, 'settlement.code')
      if (!BLOCK_CODES.has(code)) invalid(`unknown block code ${code}`)
      return { kind: 'blocked', code: code as never, message: stringField(record.message, 'settlement.message') }
    }
    default:
      return invalid(`unknown settlement kind ${String(record.kind)}`)
  }
}

/** Index the claim an event names, requiring it to be that claim's exact next revision. */
function openRevision(state: ClaimFoldState, event: SessionEvent): number {
  const data = event.data as Record<string, unknown>
  if (typeof data.id !== 'string' || data.id.length === 0) invalid('claim id must be a non-empty string')
  const index = state.claims.findIndex(claim => claim.id === data.id)
  const current = state.claims.find(claim => claim.id === data.id)
  if (current === undefined) invalid('event names a claim that was never declared')
  if (turnField(data.turn, `${event.type}.turn`) !== current.turn) {
    invalid(`${event.type} names turn ${String(data.turn)} but its claim belongs to turn ${current.turn}`)
  }
  if (current.settlement.kind !== 'pending') invalid('claim is already settled')
  if (data.revision !== current.revision + 1) invalid('event revision must be the revision this event produces')
  return index
}

/**
 * Apply one session event to the claim fold.
 * @param state - mutable fold state, advanced in place on success.
 * @param event - durable session event to validate and fold.
 * @throws {@link ClaimError} when the payload is malformed or out of order.
 */
export function applyClaimEvent(state: ClaimFoldState, event: SessionEvent): void {
  if (!CLAIM_EVENT_TYPES.has(event.type)) return
  const data = event.data as Record<string, unknown>
  switch (event.type) {
    case 'claim/declared': {
      const turn = turnField(data.turn, 'claim/declared.turn')
      if (typeof data.id !== 'string' || data.id.length === 0) invalid('claim/declared.id must be a non-empty string')
      const id = data.id as ClaimId
      if (state.claims.some(claim => claim.id === id)) invalid('claim id was already declared')
      if (state.claims.some(claim => claim.turn === turn)) invalid(`turn ${turn} already declared a claim`)
      if (data.revision !== 1) invalid('claim/declared must open at revision 1')
      state.claims.push({
        id,
        turn,
        revision: 1,
        purpose: stringField(data.purpose, 'claim/declared.purpose'),
        satisfy: stringField(data.satisfy, 'claim/declared.satisfy'),
        verifier: verifierOf(data.verifier),
        results: [],
        settlement: { kind: 'pending' },
      })
      return
    }
    case 'claim/result': {
      const index = openRevision(state, event)
      const current = state.claims[index]
      if (current === undefined) invalid('event names a claim that was never declared')
      state.claims[index] = {
        ...current,
        revision: current.revision + 1,
        results: [...current.results, resultOf({ outcome: data.outcome, evidence: data.evidence })],
      }
      return
    }
    case 'claim/settled': {
      const index = openRevision(state, event)
      const current = state.claims[index]
      if (current === undefined) invalid('event names a claim that was never declared')
      state.claims[index] = {
        ...current,
        revision: current.revision + 1,
        settlement: settlementOf(data.settlement),
      }
      return
    }
    /* v8 ignore next 2 -- CLAIM_EVENT_TYPES narrows the switch to the cases above */
    default:
      return invalid(`unhandled claim event ${event.type}`)
  }
}
