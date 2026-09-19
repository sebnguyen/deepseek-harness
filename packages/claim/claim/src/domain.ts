/**
 * Host-side vocabulary of the claim domain: durable `claim/*` payloads and
 * the strict replay fold. Kept separate from ./types.ts (the pure client-safe
 * outlet) because these declarations pull the session event map into the
 * program.
 * @module @deepseek-ai/dsh-claim
 */

import type {
  ClaimId,
  ClaimSettlement,
  Verifier,
  VerifierOutcome,
} from './types.ts'

/** Payload of `claim/declared`: the one immutable claim opened for a turn. */
export interface ClaimDeclaredMeta {
  readonly id: ClaimId
  /** Turn that declared this claim; recorded so the invariant can compare it. */
  readonly turn: number
  readonly revision: number
  /** Why this turn is being worked. */
  readonly purpose: string
  /** What must be true when the request is complete. */
  readonly satisfy: string
  /** The one frozen predicate that decides this claim. */
  readonly verifier: Verifier
}

/** Payload of `claim/result`: one recorded verifier execution. */
export interface ClaimResultMeta {
  readonly id: ClaimId
  readonly turn: number
  readonly revision: number
  readonly outcome: VerifierOutcome
  /** Verifier output, already bounded by the settling policy. */
  readonly evidence: string
}

/** Payload of `claim/settled`: the terminal settlement of one claim. */
export interface ClaimSettledMeta {
  readonly id: ClaimId
  readonly turn: number
  readonly revision: number
  readonly settlement: ClaimSettlement
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Opens one turn's claim. Log-only: the claim is durable evidence and
     * never part of the model transcript.
     */
    'claim/declared': ClaimDeclaredMeta
    /** Records one verifier execution against the open claim. Log-only. */
    'claim/result': ClaimResultMeta
    /** Closes the open claim. Log-only. */
    'claim/settled': ClaimSettledMeta
  }
}
