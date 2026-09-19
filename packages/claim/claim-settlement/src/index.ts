/**
 * Turn-boundary settlement: runs each open claim's bound verifier at
 * `agent/turn-stopping`, records the outcome, and steers bounded failure
 * evidence back for repair.
 * @module @deepseek-ai/dsh-claim-settlement
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Claim, VerifierResult } from '@deepseek-ai/dsh-claim'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import { errorText, runVerifier } from './verifier.ts'

/** Package name in the Cordis loader. */
export const name = 'claim-settlement'

/** Services this plugin binds before listening at the turn boundary. */
export const inject = ['agents', 'claims', 'shell']

/** Plugin configuration: the deployment's settlement policy. */
export interface Config {
  /** Repair steers allowed for one claim before it is blocked (default: `3`). */
  repairBudget?: number
  /** Verifier re-runs allowed after an inconclusive result (default: `2`). */
  inconclusiveRetries?: number
  /** Per-run verifier timeout in milliseconds (default: `600000`). */
  verifierTimeoutMs?: number
  /** Evidence lines kept when steering a failure back (default: `40`). */
  evidenceLines?: number
}

/** Schemastery config for the settlement policy. */
export const Config: z<Config> = z.object({
  repairBudget: z.number().step(1).min(0).default(3),
  inconclusiveRetries: z.number().step(1).min(0).default(2),
  verifierTimeoutMs: z.number().step(1).min(1).default(600_000),
  evidenceLines: z.number().step(1).min(1).default(40),
})

/** Fully materialized settlement policy. */
interface ResolvedConfig {
  readonly repairBudget: number
  readonly inconclusiveRetries: number
  readonly verifierTimeoutMs: number
  readonly evidenceLines: number
}

/** The steered failure is plugin-sourced, never attributed to the human. */
const CLAIM_SOURCE: MessageSource = { kind: 'plugin', plugin: 'claim-settlement' }

/** Materialize deployment defaults for one settlement policy. */
function resolveConfig(config: Config): ResolvedConfig {
  return {
    repairBudget: config.repairBudget ?? 3,
    inconclusiveRetries: config.inconclusiveRetries ?? 2,
    verifierTimeoutMs: config.verifierTimeoutMs ?? 600_000,
    evidenceLines: config.evidenceLines ?? 40,
  }
}

/** Keep the tail of verifier output, bounded so a steer stays affordable. */
function bounded(evidence: string, lines: number): string {
  const kept = evidence.split('\n').slice(-lines).join('\n').trim()
  return kept.length === 0 ? '(no output)' : kept
}

/** Render the repair instruction steered back into the open turn. */
function renderFailure(claim: Claim, result: VerifierResult, lines: number): string {
  return [
    `The bound verifier for your claim failed (${result.outcome}).`,
    `Claimed satisfy-condition: ${claim.satisfy}`,
    '',
    'Verifier output:',
    bounded(result.evidence, lines),
    '',
    'Repair the work and let the verifier run again, or abandon_claim with a reason if this claim named the wrong condition.',
  ].join('\n')
}

/** Count how many recorded results carry one outcome. */
function countOutcome(claim: Claim, outcome: VerifierResult['outcome']): number {
  return claim.results.filter(result => result.outcome === outcome).length
}

/**
 * Read the open turn's claim, treating a turn that already closed or an agent
 * that left the registry as "nothing to settle" so this listener cannot throw
 * at the boundary and replace the turn's verdict with an error.
 */
function openClaimOrNone(ctx: Context, agent: Agent): Claim | undefined {
  try {
    return ctx.claims.openClaim(agent)
  } catch {
    // Only the claim service's open-turn and liveness rejections reach here, and both mean there is nothing to settle.
    return undefined
  }
}

/**
 * Settle or repair after one recorded verdict.
 *
 * A pass closes the claim; a tampered script blocks it without retry. A failure
 * steers its evidence back until `repairBudget` is spent, then blocks. An
 * inconclusive result retries the verifier rather than the model, and blocks
 * once `inconclusiveRetries` is spent, so a broken verifier cannot consume the
 * model's repair capacity.
 */
function settleOrRepair(
  ctx: Context,
  agent: Agent,
  claim: Claim,
  result: VerifierResult,
  resolved: ResolvedConfig,
): void {
  switch (result.outcome) {
    case 'pass':
      ctx.claims.settle(agent, { kind: 'passed' })
      return
    case 'tampered':
      ctx.claims.settle(agent, { kind: 'tampered' })
      return
    case 'inconclusive':
      if (countOutcome(claim, 'inconclusive') > resolved.inconclusiveRetries) {
        ctx.claims.settle(agent, {
          kind: 'blocked',
          code: 'verifier-unavailable',
          message: 'the bound verifier could not complete; the claim is unproven',
        })
      }
      return
    case 'fail':
      if (countOutcome(claim, 'fail') > resolved.repairBudget) {
        ctx.claims.settle(agent, {
          kind: 'blocked',
          code: 'repair-budget-exhausted',
          message: `the bound verifier still failed after ${resolved.repairBudget} repair attempts`,
        })
        return
      }
      agent.steer(createUserMessage({
        content: [{ type: 'text', text: renderFailure(claim, result, resolved.evidenceLines) }],
        source: CLAIM_SOURCE,
      }))
      return
    /* v8 ignore next 2 -- VerifierOutcome is a closed union covered above */
    default:
      return
  }
}

/**
 * Register the turn-boundary settlement listener.
 * @param ctx - Context carrying the agent registry, the claim service, and the shell seam.
 * @param config - deployment settlement policy.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
    const claim = openClaimOrNone(ctx, agent)
    if (claim === undefined || claim.settlement.kind !== 'pending') return
    try {
      const result = await runVerifier(ctx, claim.verifier, resolved.verifierTimeoutMs, signal)
      const recorded = ctx.claims.record(agent, result)
      settleOrRepair(ctx, agent, recorded, result, resolved)
    } catch (error) {
      // A listener throw would close the turn as an error, replacing the verdict.
      const current = openClaimOrNone(ctx, agent)
      if (current !== undefined && current.settlement.kind === 'pending') {
        ctx.claims.settle(agent, {
          kind: 'blocked',
          code: 'verifier-unavailable',
          message: `claim settlement failed: ${errorText(error)}`,
        })
      }
    }
  })
}
