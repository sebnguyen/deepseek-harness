/**
 * The durable claim service (`ctx.claims`): immutable verification claims, any
 * number per turn, backed exclusively by the owning session log.
 * @module @deepseek-ai/dsh-claim
 */

import { createHash, randomUUID } from 'node:crypto'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { applyClaimEvent } from './fold.ts'
import type { ClaimFoldState } from './fold.ts'
import { ClaimId } from './brand.ts'
import { ClaimError } from './runtime.ts'
import type {
  Claim,
  ClaimProjectionState,
  ClaimSettlement,
  DeclareClaimRequest,
  Verifier,
  VerifierResult,
} from './types.ts'

/** Upper bound on a claim title: it is a short label, so the detail belongs in `description`. */
const MAX_TITLE_LENGTH = 80

/** Wire schema for the one bound verifier. */
const verifierSchema = zod.object({
  source: zod.string(),
  digest: zod.string(),
})

/** Wire schema for one recorded execution. */
const resultSchema = zod.object({
  outcome: zod.union([zod.literal('pass'), zod.literal('fail'), zod.literal('inconclusive'), zod.literal('tampered')]),
  evidence: zod.string(),
})

/** Wire schema for one lifecycle state. */
const settlementSchema = zod.union([
  zod.object({ kind: zod.literal('pending') }),
  zod.object({ kind: zod.literal('passed') }),
  zod.object({ kind: zod.literal('tampered') }),
  zod.object({ kind: zod.literal('blocked'), code: zod.string(), message: zod.string() }),
])

/** Wire schema for one full claim. */
const claimSchema = zod.object({
  id: zod.string(),
  turn: zod.number(),
  revision: zod.number(),
  title: zod.string(),
  description: zod.string(),
  verifier: verifierSchema,
  results: zod.array(resultSchema),
  settlement: settlementSchema,
})

/** Strict projection state schema: the turn-ordered ledger plus its replay failure. */
const claimProjectionStateSchema = zod.object({
  claims: zod.array(claimSchema),
  failure: zod.string().nullable(),
})

/**
 * Fold one committed event into the strict projection state, latching the
 * first decode failure instead of throwing through the projection registry.
 * @param state - current strict projection state.
 * @param event - committed session event.
 * @returns the advanced state, or the same state once a failure is latched.
 */
export function applyClaimProjection(state: ClaimProjectionState, event: SessionEvent): ClaimProjectionState {
  if (state.failure !== null) return state
  const fold: ClaimFoldState = { claims: [...state.claims] }
  try {
    applyClaimEvent(fold, event)
  } catch (error) {
    /* v8 ignore next -- the strict claim decoder throws Error instances */
    const message = error instanceof Error ? error.message : String(error)
    return { ...state, failure: message }
  }
  return { claims: fold.claims, failure: null }
}

/** The `claim` projection unit: the session's turn-ordered claim ledger. */
export const claimProjectionDefinition = {
  key: 'claim',
  stateSchema: claimProjectionStateSchema as unknown as ZodType<ClaimProjectionState>,
  init: (): ClaimProjectionState => ({ claims: [], failure: null }),
  apply: applyClaimProjection,
  wire: {
    viewSchema: zod.array(claimSchema) as unknown as ZodType<readonly Claim[]>,
    view: (state: ClaimProjectionState) => state.claims,
  },
  stateVersion: 4,
} satisfies ProjectionDefinition<'claim', ClaimProjectionState>

/** Claim service (`ctx.claims`) backed exclusively by the owning session log. */
export class ClaimService extends Service {
  static inject = ['agents', 'sessionProjections']

  private readonly host: Context

  /**
   * @param ctx - Cordis context carrying the agent registry and projection registry.
   */
  constructor(ctx: Context) {
    super(ctx, 'claims')
    this.host = ctx
    ctx.sessionProjections.register(claimProjectionDefinition)
  }

  /**
   * Read every currently-pending claim of the open turn, in declaration order.
   * @param agent - owning live agent.
   * @returns the open turn's pending claims; empty when that turn declared none or settled every claim.
   * @throws {@link ClaimError} when no model turn is open or the agent is not live.
   */
  openClaims(agent: Agent): readonly Claim[] {
    this.assertLive(agent)
    const turn = this.openTurn(agent)
    return this.ledger(agent).filter(claim => claim.turn === turn && claim.settlement.kind === 'pending')
  }

  /**
   * Read every claim this session declared, in turn order.
   * @param agent - owning live agent.
   * @returns the turn-ordered ledger, empty before the first declaration.
   */
  ledger(agent: Agent): readonly Claim[] {
    return this.stateOf(agent).claims
  }

  /**
   * Count recorded failures for one claim.
   * @param agent - owning live agent.
   * @param id - the claim to count for.
   * @returns how many recorded results on that claim carry outcome `fail`.
   */
  failures(agent: Agent, id: ClaimId): number {
    this.assertLive(agent)
    const claim = this.ledger(agent).find(entry => entry.id === id)
    return claim === undefined ? 0 : claim.results.filter(result => result.outcome === 'fail').length
  }

  /**
   * Declare one claim in the currently open turn. A turn may declare any
   * number of claims; each is immutable and settles independently.
   * @param agent - owning live agent.
   * @param request - the claim's title, description, and bound verifier script.
   * @returns the freshly declared claim.
   * @throws {@link ClaimError} when no turn is open or the request is invalid.
   */
  declare(agent: Agent, request: DeclareClaimRequest): Claim {
    this.assertLive(agent)
    const turn = this.openTurn(agent)
    const title = typeof request.title === 'string' ? request.title.trim() : ''
    if (title.length === 0) {
      throw new ClaimError('title must be a non-empty string', 'CLAIM_INVALID_TITLE')
    }
    if (title.length > MAX_TITLE_LENGTH) {
      throw new ClaimError(`title must be at most ${MAX_TITLE_LENGTH} characters`, 'CLAIM_INVALID_TITLE')
    }
    const description = typeof request.description === 'string' ? request.description.trim() : ''
    if (description.length === 0) {
      throw new ClaimError('description must be a non-empty string', 'CLAIM_INVALID_DESCRIPTION')
    }
    const verifier = bindVerifier(request.script)
    const id = ClaimId(randomUUID())
    agent.session.append('claim/declared', {
      id,
      turn,
      revision: 1,
      title,
      description,
      verifier,
    })
    return this.requireCurrent(agent, id)
  }

  /**
   * Record one verifier execution against a claim.
   * @param agent - owning live agent.
   * @param id - the claim to record against.
   * @param result - the execution outcome and its bounded evidence.
   * @returns the advanced claim.
   * @throws {@link ClaimError} when the claim is unknown, not in the open turn, or settled.
   */
  record(agent: Agent, id: ClaimId, result: VerifierResult): Claim {
    const current = this.requireOpen(agent, id)
    agent.session.append('claim/result', {
      id: current.id,
      turn: current.turn,
      revision: current.revision + 1,
      outcome: result.outcome,
      evidence: result.evidence,
    })
    return this.requireCurrent(agent, id)
  }

  /**
   * Close one claim with a terminal settlement.
   * @param agent - owning live agent.
   * @param id - the claim to settle.
   * @param settlement - the terminal settlement to commit.
   * @returns the settled claim.
   * @throws {@link ClaimError} when the claim is unknown, not in the open turn, or settled.
   */
  settle(agent: Agent, id: ClaimId, settlement: ClaimSettlement): Claim {
    const current = this.requireOpen(agent, id)
    agent.session.append('claim/settled', {
      id: current.id,
      turn: current.turn,
      revision: current.revision + 1,
      settlement,
    })
    return this.requireCurrent(agent, id)
  }

  /**
   * Abandon one claim as the model conceding it named the wrong condition.
   * Refused while the bound verifier has not yet run, so a claim cannot be
   * opened and closed without facing its check at least once.
   * @param agent - owning live agent.
   * @param id - the claim to abandon.
   * @param message - non-empty explanation recorded with the abandonment.
   * @returns the settled claim.
   * @throws {@link ClaimError} when the claim is unknown, not in the open turn, settled, or its check has not run.
   */
  abandon(agent: Agent, id: ClaimId, message: string): Claim {
    const current = this.requireOpen(agent, id)
    if (current.results.length === 0) {
      throw new ClaimError('the bound verifier has not run yet', 'CLAIM_VERIFIER_NOT_RUN')
    }
    return this.settle(agent, id, {
      kind: 'blocked',
      code: 'abandoned',
      message: message.trim().length === 0 ? 'abandoned by the model' : message.trim(),
    })
  }

  /** Reject any operation whose agent is not the registry's live instance. */
  private assertLive(agent: Agent): void {
    if (this.host.agents.get(agent.id) !== agent) {
      throw new ClaimError(`agent "${agent.id}" is not the live registry instance`, 'CLAIM_AGENT_NOT_LIVE')
    }
  }

  /**
   * Resolve the turn a claim belongs to from the `turnBoundary` projection the
   * agent loop owns, so this package never duplicates loop state.
   * @param agent - owning live agent.
   * @returns the number of the model turn currently open.
   * @throws {@link ClaimError} when no model turn is open.
   */
  private openTurn(agent: Agent): number {
    const state = this.host.sessionProjections.stateOf(agent.session, 'turnBoundary')
    if (state === undefined || state.openTurnStartSeq === null) {
      throw new ClaimError('claims require an open model turn', 'CLAIM_NO_OPEN_TURN')
    }
    return state.lastTurn
  }

  /** Read the folded claim state without the liveness check. */
  private stateOf(agent: Agent): ClaimProjectionState {
    const state = this.host.sessionProjections.stateOf(agent.session, 'claim')
    /* v8 ignore next -- this service registers the claim unit at construction */
    if (state === undefined) throw new ClaimError('the claim projection unit is not registered', 'CLAIM_NONE_OPEN')
    return state
  }

  /** Require one claim to exist, belong to the open turn, and still be pending. */
  private requireOpen(agent: Agent, id: ClaimId): Claim {
    this.assertLive(agent)
    const turn = this.openTurn(agent)
    const current = this.ledger(agent).find(claim => claim.id === id)
    if (current === undefined) throw new ClaimError(`claim "${id}" does not exist`, 'CLAIM_UNKNOWN')
    if (current.turn !== turn) throw new ClaimError(`claim "${id}" does not belong to the open turn`, 'CLAIM_NONE_OPEN')
    if (current.settlement.kind !== 'pending') throw new ClaimError(`claim "${id}" is already settled`, 'CLAIM_NONE_OPEN')
    return current
  }

  /** Read the ledger entry a just-committed mutation produced. */
  private requireCurrent(agent: Agent, id: ClaimId): Claim {
    const current = this.ledger(agent).find(claim => claim.id === id)
    /* v8 ignore next -- a committed mutation always leaves a readable claim */
    if (current === undefined) throw new ClaimError('claim was not readable after a mutation', 'CLAIM_NONE_OPEN')
    return current
  }
}

/**
 * Freeze one bound verifier by hashing its script.
 * @param source - the script text supplied with the declaration.
 * @returns the immutable binding recorded in the durable claim.
 * @throws {@link ClaimError} when the script is empty.
 */
export function bindVerifier(source: string): Verifier {
  const text = typeof source === 'string' ? source : ''
  if (text.trim().length === 0) {
    throw new ClaimError('a verifier script must be a non-empty string', 'CLAIM_INVALID_SCRIPT')
  }
  return { source: text, digest: createHash('sha256').update(text).digest('hex') }
}

export default ClaimService

export { ClaimError } from './runtime.ts'
export { ClaimId } from './brand.ts'

export type {
  Claim,
  ClaimBlockCode,
  ClaimProjectionState,
  ClaimSettlement,
  DeclareClaimRequest,
  Verifier,
  VerifierOutcome,
  VerifierResult,
} from './types.ts'
export type { ClaimDeclaredMeta, ClaimResultMeta, ClaimSettledMeta } from './domain.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    claims: ClaimService
  }
}
