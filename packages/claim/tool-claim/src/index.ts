/**
 * Model-facing `declare_claim`, `run_claim`, and `abandon_claim` tools over the
 * persisted claim domain, plus the standing declaration requirement contributed
 * as a prompt section.
 * @module @deepseek-ai/dsh-tool-claim
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ClaimId } from '@deepseek-ai/dsh-claim'
import type { Claim } from '@deepseek-ai/dsh-claim'
import { boundedEvidence, runVerifier } from '@deepseek-ai/dsh-claim-settlement'
import { createUserMessage, HarnessError } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-projection'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolRunContext } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

/** Package name in the Cordis loader. */
export const name = 'tool-claim'

/** Services this plugin binds before registering its tools. */
export const inject = ['agents', 'claims', 'tools', 'systemPrompt', 'sessionProjections', 'shell']

/** Plugin configuration: the deployment's in-turn verifier run policy. */
export interface Config {
  /** Per-run verifier timeout in milliseconds (default: `600000`). */
  verifierTimeoutMs?: number
  /** Evidence lines kept in a `run_claim` result (default: `40`). */
  evidenceLines?: number
}

/** Schemastery config for the in-turn verifier run policy. */
export const Config: z<Config> = z.object({
  verifierTimeoutMs: z.number().step(1).min(1).default(600_000),
  evidenceLines: z.number().step(1).min(1).default(40),
})

/** Fully materialized in-turn verifier run policy. */
interface ResolvedConfig {
  readonly verifierTimeoutMs: number
  readonly evidenceLines: number
}

/** Materialize deployment defaults for the in-turn verifier run policy. */
function resolveConfig(config: Config): ResolvedConfig {
  return {
    verifierTimeoutMs: config.verifierTimeoutMs ?? 600_000,
    evidenceLines: config.evidenceLines ?? 40,
  }
}

/** The standing requirement that opens every work turn with one or more claims. */
export const CLAIM_DEMAND =
  'At the start of a work turn, declare one or more claims with declare_claim — declare more than one claim when '
  + 'the turn promises several independent conditions, one claim per independent condition. Give each claim a brief '
  + 'title of a few words, and put the full detail of what must be true when it is settled in the description. Bind '
  + 'exactly one shell script that exits 0 only when that description holds, and make the check verify the change: '
  + 'run the focused unit tests and lint covering it, not an always-passing assertion. A claim is immutable in '
  + 'content once declared: its title, description, and script never change. Settle your claims yourself with '
  + 'run_claim inside the turn: a pass closes the claim, and a fail is recorded with its evidence so you can repair '
  + 'the work and run_claim again, or abandon_claim it by id once its check has run and the condition itself was '
  + 'wrong. A claim you never run is still verified at the turn boundary, which steers its failure back once; after '
  + 'that single repair round a still-failing claim is blocked. The turn must be complete before the boundary '
  + 'verifier runs, so finish all edits, test runs, and repairs inside the turn and never end a turn with work still '
  + 'in flight. Do not cycle: use the one boundary repair round to fix the work, not to declare replacement claims '
  + 'round after round.'

/** The turn-boundary reminder is plugin-sourced, never attributed to the human. */
const CLAIM_SOURCE: MessageSource = { kind: 'plugin', plugin: 'tool-claim' }

/**
 * Render the turn-boundary declaration reminder. A first-step pre-step
 * injection marks each new turn model-visibly, so the agent never has to
 * infer a turn boundary from the transcript; the loop's pre-step positions
 * are one-based, so step 1 is the turn's first step.
 */
function renderTurnReminder(turn: number): string {
  return `New work turn (turn ${turn}). Declare this turn's claims with declare_claim — one claim per independent `
    + 'condition, each with a short title, a full description, and one bound shell check — before changing anything, '
    + 'and settle them with run_claim before you end the turn.'
}

/** Compact status the model reads back after either tool call. */
interface ClaimToolValue {
  readonly claim: {
    readonly id: string
    readonly turn: number
    readonly revision: number
    readonly title: string
    readonly description: string
    readonly settlement: string
    /** Only a `run_claim` result carries the outcome it just observed. */
    readonly outcome?: string
    /** Only a `run_claim` result carries evidence, bounded to the configured tail. */
    readonly evidence?: string
  } | null
}

/** Wire schema for the compact claim-tool result. */
const CLAIM_VALUE_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        claim: { type: 'null', required: true },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        claim: {
          type: 'object',
          additionalProperties: false,
          required: true,
          properties: {
            id: { type: 'string', required: true },
            turn: { type: 'integer', required: true },
            revision: { type: 'integer', required: true },
            title: { type: 'string', required: true },
            description: { type: 'string', required: true },
            settlement: { type: 'string', required: true },
            outcome: { type: 'string' },
            evidence: { type: 'string' },
          },
        },
      },
    },
  ],
} as const

/** Compact JSON tool result, matching the sibling goal tools. */
const CLAIM_OUTPUT = {
  schema: CLAIM_VALUE_SCHEMA,
  render: (_args: unknown, value: ClaimToolValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

/** Generic, args-only pending presentation shared by the claim tools. */
function present(title: string, kind: 'read' | 'other'): GenericCallView {
  return { card: 'generic', title, kind }
}

/** Resolve the exact live calling agent, or reject the call. */
function liveAgent(ctx: Context, exec: ToolRunContext): Agent {
  const agent = exec.agent
  if (agent === undefined) {
    throw new HarnessError('claim tools require a calling agent', 'CLAIM_TOOL_AGENT_REQUIRED')
  }
  if (ctx.agents.get(agent.id) !== agent) {
    throw new HarnessError('claim tools require the exact live calling agent', 'CLAIM_TOOL_AGENT_REQUIRED')
  }
  return agent
}

/** Render one claim as the compact tool status. */
function claimValue(claim: Claim | undefined): ClaimToolValue {
  return claim === undefined
    ? { claim: null }
    : {
      claim: {
        id: claim.id,
        turn: claim.turn,
        revision: claim.revision,
        title: claim.title,
        description: claim.description,
        settlement: claim.settlement.kind,
      },
    }
}

/** Render one settled or re-run claim as the compact `run_claim` status. */
function runValue(claim: Claim, outcome: string, evidence: string, evidenceLines: number): ClaimToolValue {
  return {
    claim: {
      id: claim.id,
      turn: claim.turn,
      revision: claim.revision,
      title: claim.title,
      description: claim.description,
      settlement: claim.settlement.kind,
      outcome,
      evidence: boundedEvidence(evidence, evidenceLines),
    },
  }
}

/** Register the three claim tools and their shared demand section. */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)

  ctx.systemPrompt.section({
    name: 'tool:claim',
    order: ctx.systemPrompt.getSectionOrder('TOOL_CLAIM'),
    text: CLAIM_DEMAND,
  })

  ctx.on('agent/pre-step', async ({ agent, turn, step }, next) => {
    const decision = await next()
    if (decision.kind !== 'enter' || step !== 1) return decision
    if (ctx.agents.get(agent.id) !== agent) return decision
    const reminder = createUserMessage({
      content: [{ type: 'text', text: renderTurnReminder(turn) }],
      source: CLAIM_SOURCE,
    })
    return { ...decision, messages: [...decision.messages, reminder] }
  })

  ctx.tools.register(defineTool({
    name: 'declare_claim',
    description: 'Declare one claim for this turn: a short title, a description of what must be true when it is '
      + 'settled, and the one bound shell check that proves it. The check must exit 0 only when the description '
      + 'genuinely holds. A claim is immutable in content once declared; a turn may declare several claims, one per '
      + 'independent condition.',
    parameters: {
      title: {
        type: 'string',
        required: true,
        description: 'A short label for this claim (a few words). Keep it brief — put the full detail in `description`.',
      },
      description: {
        type: 'string',
        required: true,
        description: 'Everything this claim promises — the full detail of what must be true when the claim is settled.',
      },
      script: {
        type: 'string',
        required: true,
        description: 'Shell script that exits non-zero unless the description holds. Exactly one check is bound to the claim.',
      },
    },
    output: CLAIM_OUTPUT,
    execute(args, exec) {
      const agent = liveAgent(ctx, exec)
      const request = { title: args.title, description: args.description, script: args.script }
      return Promise.resolve(claimValue(ctx.claims.declare(agent, request)))
    },
    presentCall: () => present('Declare claim', 'other'),
  }))

  ctx.tools.register(defineTool({
    name: 'run_claim',
    description: 'Run one open claim\'s bound check now, inside the turn. A pass settles the claim as passed; a fail '
      + 'is recorded with its evidence and the claim stays open, so you can repair the work and run_claim it again, or '
      + 'abandon_claim it once its check has run. Returns the outcome and the bounded verifier output.',
    parameters: {
      id: {
        type: 'string',
        required: true,
        description: 'The claim id, as returned by declare_claim.',
      },
    },
    output: CLAIM_OUTPUT,
    async execute(args, exec) {
      const agent = liveAgent(ctx, exec)
      const open = ctx.claims.openClaims(agent).find(claim => claim.id === args.id)
      if (open === undefined) {
        throw new HarnessError(`claim "${args.id}" is not an open claim of this turn`, 'CLAIM_UNKNOWN')
      }
      const result = await runVerifier(ctx, open.verifier, resolved.verifierTimeoutMs, exec.signal)
      ctx.claims.record(agent, open.id, result)
      if (result.outcome === 'pass') ctx.claims.settle(agent, open.id, { kind: 'passed' })
      if (result.outcome === 'tampered') ctx.claims.settle(agent, open.id, { kind: 'tampered' })
      const current = ctx.claims.ledger(agent).find(claim => claim.id === open.id)
      /* v8 ignore next -- a recorded claim always stays readable in the ledger */
      if (current === undefined) throw new HarnessError('claim was not readable after recording', 'CLAIM_UNKNOWN')
      return runValue(current, result.outcome, result.evidence, resolved.evidenceLines)
    },
    presentCall: () => present('Run claim', 'other'),
  }))

  ctx.tools.register(defineTool({
    name: 'abandon_claim',
    description: 'Give up on one claim because it named the wrong condition. Refused until its bound check has run '
      + 'at least once — call run_claim first if it has not. Record why it was wrong.',
    parameters: {
      id: {
        type: 'string',
        required: true,
        description: 'The claim id, as returned by declare_claim.',
      },
      reason: {
        type: 'string',
        required: true,
        description: 'Why the declared condition was the wrong one.',
      },
    },
    output: CLAIM_OUTPUT,
    execute(args, exec) {
      const agent = liveAgent(ctx, exec)
      return Promise.resolve(claimValue(ctx.claims.abandon(agent, ClaimId(args.id), args.reason)))
    },
    presentCall: () => present('Abandon claim', 'other'),
  }))
}
