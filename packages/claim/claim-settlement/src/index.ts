/**
 * Turn-boundary settlement: runs every open claim's bound verifier at
 * `agent/turn-stopping`, records each outcome, settles each claim, and steers
 * one aggregated result back for repair.
 * @module @deepseek-ai/dsh-claim-settlement
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Claim, VerifierResult } from '@deepseek-ai/dsh-claim'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import { boundedEvidence, errorText, runVerifier } from './verifier.ts'

export { boundedEvidence, runVerifier } from './verifier.ts'

/** Package name in the Cordis loader. */
export const name = 'claim-settlement'

/** Services this plugin binds before listening at the turn boundary. */
export const inject = ['agents', 'claims', 'shell']

/** Plugin configuration: the deployment's settlement policy. */
export interface Config {
  /** Repair steers allowed for one claim before it is blocked (default: `1`). */
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
  repairBudget: z.number().step(1).min(0).default(1),
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

/** One claim plus its just-recorded verdict, for the aggregate steer. */
interface Verdict {
  readonly claim: Claim
  readonly result: VerifierResult
}

/** The steered failure is plugin-sourced, never attributed to the human. */
const CLAIM_SOURCE: MessageSource = { kind: 'plugin', plugin: 'claim-settlement' }

/** Materialize deployment defaults for one settlement policy. */
function resolveConfig(config: Config): ResolvedConfig {
  return {
    repairBudget: config.repairBudget ?? 1,
    inconclusiveRetries: config.inconclusiveRetries ?? 2,
    verifierTimeoutMs: config.verifierTimeoutMs ?? 600_000,
    evidenceLines: config.evidenceLines ?? 40,
  }
}

/** Count how many recorded results carry one outcome. */
function countOutcome(claim: Claim, outcome: VerifierResult['outcome']): number {
  return claim.results.filter(result => result.outcome === outcome).length
}

/**
 * Read the open turn's pending claims, treating a turn that already closed or
 * an agent that left the registry as "nothing to settle" so this listener
 * cannot throw at the boundary and replace the turn's verdict with an error.
 */
function openClaimsOrNone(ctx: Context, agent: Agent): readonly Claim[] {
  try {
    return ctx.claims.openClaims(agent)
  } catch {
    // Only the claim service's open-turn and liveness rejections reach here, and both mean there is nothing to settle.
    return []
  }
}

/**
 * Settle one claim from a recorded verdict. A pass or a tamper closes it; an
 * inconclusive or failing claim is blocked only once its retry budget is
 * spent, and otherwise stays pending for the next boundary run. This never
 * steers — the listener steers once after every claim is judged.
 */
function settleClaim(
  ctx: Context,
  agent: Agent,
  claim: Claim,
  result: VerifierResult,
  resolved: ResolvedConfig,
): void {
  switch (result.outcome) {
    case 'pass':
      ctx.claims.settle(agent, claim.id, { kind: 'passed' })
      return
    case 'tampered':
      ctx.claims.settle(agent, claim.id, { kind: 'tampered' })
      return
    case 'inconclusive':
      if (countOutcome(claim, 'inconclusive') > resolved.inconclusiveRetries) {
        ctx.claims.settle(agent, claim.id, {
          kind: 'blocked',
          code: 'verifier-unavailable',
          message: 'the bound verifier could not complete; the claim is unproven',
        })
      }
      return
    case 'fail':
      if (countOutcome(claim, 'fail') > resolved.repairBudget) {
        ctx.claims.settle(agent, claim.id, {
          kind: 'blocked',
          code: 'repair-budget-exhausted',
          message: `the bound verifier still failed after ${resolved.repairBudget} repair attempts`,
        })
      }
      return
    /* v8 ignore next 2 -- VerifierOutcome is a closed union covered above */
    default:
      return
  }
}

/** Render the aggregate repair message once any claim is left pending to fix. */
function renderRepair(verdicts: readonly Verdict[], resolved: ResolvedConfig): string {
  const lines = verdicts.map(({ claim, result }) => {
    switch (result.outcome) {
      case 'pass':
        return `- "${claim.title}" passed.`
      case 'tampered':
        return `- "${claim.title}" was tampered.`
      case 'inconclusive':
        return `- "${claim.title}" could not be verified (inconclusive).`
      case 'fail':
        return [
          `- "${claim.title}" failed. Claimed condition: ${claim.description}`,
          '  Verifier output:',
          boundedEvidence(result.evidence, resolved.evidenceLines),
        ].join('\n')
      /* v8 ignore next 2 -- VerifierOutcome is a closed union covered above */
      default:
        return `- "${claim.title}" ${result.outcome}.`
    }
  })
  return [
    'The bound verifiers for this turn reported failures:',
    ...lines,
    '',
    'Repair the work, then run the claim again with run_claim, or abandon_claim it by its id when the declared condition itself was wrong.',
    'This boundary steers one failure back per claim; a claim that still fails at the next boundary is blocked.',
  ].join('\n')
}

/**
 * Register the turn-boundary settlement listener.
 * @param ctx - Context carrying the agent registry, the claim service, and the shell seam.
 * @param config - deployment settlement policy.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
    const claims = openClaimsOrNone(ctx, agent)
    if (claims.length === 0) return
    const sandboxPolicyService: SandboxPolicyService | undefined = ctx.get('sandboxPolicy')
    const sandboxPolicy = sandboxPolicyService?.resolve({ session: agent.session })
    const verdicts: Verdict[] = []
    let needsRepair = false
    for (const claim of claims) {
      let result: VerifierResult
      try {
        result = await runVerifier(ctx, claim.verifier, resolved.verifierTimeoutMs, signal, sandboxPolicy)
      } catch (error) {
        // An infrastructure failure is recorded as inconclusive, never a model-facing throw.
        result = { outcome: 'inconclusive', evidence: `claim settlement failed: ${errorText(error)}` }
      }
      const recorded = ctx.claims.record(agent, claim.id, result)
      settleClaim(ctx, agent, recorded, result, resolved)
      const stillPending = ctx.claims.ledger(agent)
        .find(entry => entry.id === claim.id)?.settlement.kind === 'pending'
      if (result.outcome === 'fail' && stillPending) needsRepair = true
      verdicts.push({ claim: recorded, result })
    }
    if (needsRepair) {
      agent.steer(createUserMessage({
        content: [{ type: 'text', text: renderRepair(verdicts, resolved) }],
        source: CLAIM_SOURCE,
      }))
    }
  })
}
