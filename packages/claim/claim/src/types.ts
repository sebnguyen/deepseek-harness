/**
 * Pure types of the claim domain: the ONE home of the `claim` projection-key
 * declaration plus the durable payload vocabulary it carries, free of this
 * package's host-side imports (cordis events, dsh-agent, the service). The
 * `./types` subpath serves host consumers and `./client` re-exports it for
 * client aggregates with zero content duplication.
 * @module @deepseek-ai/dsh-claim/types
 */

import type { ClaimId } from './brand.ts'

export type { ClaimId } from './brand.ts'

/**
 * Outcome of one verifier execution.
 * `pass` and `fail` are verdicts about the work; `inconclusive` means the
 * predicate was never evaluated; `tampered` means its inputs changed.
 */
export type VerifierOutcome =
  | 'pass'
  | 'fail'
  | 'inconclusive'
  | 'tampered'

/** Stable machine-routable reason a claim settled without passing. */
export type ClaimBlockCode =
  | 'abandoned'
  | 'repair-budget-exhausted'
  | 'verifier-unavailable'

/**
 * Lifecycle state of one claim. A claim is open exactly while it is `pending`
 * and terminal once it is anything else.
 */
export type ClaimSettlement =
  | { readonly kind: 'pending' }
  | { readonly kind: 'passed' }
  | { readonly kind: 'tampered' }
  | {
    readonly kind: 'blocked'
    /** Stable classification chosen by the settling policy. */
    readonly code: ClaimBlockCode
    /** Non-empty explanation shown to humans and models. */
    readonly message: string
  }

/** One frozen shell predicate bound to a claim. */
export interface Verifier {
  /** Frozen script text, run from a copy outside the model's writable scope. */
  readonly source: string
  /** SHA-256 hex of `source`, taken at binding and rechecked before every run. */
  readonly digest: string
}

/** One verifier execution recorded against a claim. */
export interface VerifierResult {
  readonly outcome: VerifierOutcome
  /** Verifier output, bounded by the settling policy before it is recorded. */
  readonly evidence: string
}

/** Full durable state of one claim, scoped to the turn that declared it. */
export interface Claim {
  /** Stable claim identity. */
  readonly id: ClaimId
  /** Turn this claim belongs to; a turn declares any number of claims. */
  readonly turn: number
  /** Positive revision; every durable mutation increments it. */
  readonly revision: number
  /** Short label for this claim, for human reading. */
  readonly title: string
  /** What must be true when this claim is settled, for human reading. */
  readonly description: string
  /** The one frozen predicate that decides this claim. */
  readonly verifier: Verifier
  /** Every recorded execution, in order. */
  readonly results: readonly VerifierResult[]
  /** Lifecycle state; `pending` exactly while the claim is open. */
  readonly settlement: ClaimSettlement
}

/** Request accepted by {@link ClaimService.declare}. */
export interface DeclareClaimRequest {
  /** Short label for the claim. */
  readonly title: string
  /** What must be true when the claim is settled. */
  readonly description: string
  /** The shell script bound as the claim's one predicate, hashed at declaration. */
  readonly script: string
}

/**
 * The `claim` projection value: every claim this session declared, in turn
 * order, so a reader sees what each turn promised and how it settled. The
 * ledger is the fold's output, not a second store.
 */
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    claim: ClaimProjectionState
  }
  interface SessionProjectionMap {
    /** Turn-ordered ledger of this session's claims; empty before the first. */
    claim: readonly Claim[]
  }
}

/** Strict replay state behind the client `claim` projection value. */
export interface ClaimProjectionState {
  /** Every claim declared in this session, in turn order. */
  readonly claims: readonly Claim[]
  /** First strict replay failure, or null while the durable stream is valid. */
  readonly failure: string | null
}
