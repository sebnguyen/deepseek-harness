/**
 * Model-facing `declare_claim` and `abandon_claim` tools over the persisted
 * claim domain, plus the standing declaration requirement contributed as a
 * prompt section.
 * @module @deepseek-ai/dsh-tool-claim
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Claim } from '@deepseek-ai/dsh-claim'
import { createUserMessage, HarnessError } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-projection'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolRunContext } from '@deepseek-ai/dsh-tools'

/** Package name in the Cordis loader. */
export const name = 'tool-claim'

/** Services this plugin binds before registering its tools. */
export const inject = ['agents', 'claims', 'tools', 'systemPrompt', 'sessionProjections']

/** The standing requirement that opens every work turn with a claim. */
export const CLAIM_DEMAND =
  'At the start of a work turn, declare a claim with declare_claim: say why the turn exists (purpose) '
  + 'and what must be true when it is done (satisfy), and bind exactly one shell script that exits 0 only '
  + 'when satisfy holds, and make the check verify the change: run the focused unit tests and lint covering it, '
  + 'not an always-passing assertion. A claim is immutable once declared. Re-run or repair when the check fails; if '
  + 'the condition itself is wrong, abandon_claim it after its check has run at least once and say why. '
  + 'When the turn is about to end, the bound check runs again and any failure is returned to you.'

/** The turn-boundary reminder is plugin-sourced, never attributed to the human. */
const CLAIM_SOURCE: MessageSource = { kind: 'plugin', plugin: 'tool-claim' }

/**
 * Render the turn-boundary declaration reminder. A first-step pre-step
 * injection marks each new turn model-visibly, so the agent never has to
 * infer a turn boundary from the transcript; the loop's pre-step positions
 * are one-based, so step 1 is the turn's first step.
 */
function renderTurnReminder(turn: number): string {
  return `New work turn (turn ${turn}). Declare this turn's claim with declare_claim — purpose, satisfy, and the one bound shell check — before changing anything.`
}

/** Compact status the model reads back after either tool call. */
interface ClaimToolValue {
  readonly claim: {
    readonly id: string
    readonly turn: number
    readonly revision: number
    readonly purpose: string
    readonly satisfy: string
    readonly settlement: string
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
            purpose: { type: 'string', required: true },
            satisfy: { type: 'string', required: true },
            settlement: { type: 'string', required: true },
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

/** Render one current claim as the compact tool status. */
function claimValue(claim: Claim | undefined): ClaimToolValue {
  return claim === undefined
    ? { claim: null }
    : {
      claim: {
        id: claim.id,
        turn: claim.turn,
        revision: claim.revision,
        purpose: claim.purpose,
        satisfy: claim.satisfy,
        settlement: claim.settlement.kind,
      },
    }
}

/** Register the two claim tools and their shared demand section. */
export function apply(ctx: Context): void {
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
    description: 'Declare what this turn is for and what must be true when it is done, and bind the one shell check that proves it. '
      + 'The check must exit 0 only when the condition genuinely holds. A claim is immutable once declared.',
    parameters: {
      purpose: {
        type: 'string',
        required: true,
        description: 'Why this turn exists and what it is meant to accomplish.',
      },
      satisfy: {
        type: 'string',
        required: true,
        description: 'What must be true when the turn is complete.',
      },
      script: {
        type: 'string',
        required: true,
        description: 'Shell script that exits non-zero unless satisfy holds. Exactly one check is bound to the claim.',
      },
    },
    output: CLAIM_OUTPUT,
    execute(args, exec) {
      const agent = liveAgent(ctx, exec)
      return Promise.resolve(claimValue(ctx.claims.declare(agent, { purpose: args.purpose, satisfy: args.satisfy, script: args.script })))
    },
    presentCall: () => present('Declare claim', 'other'),
  }))

  ctx.tools.register(defineTool({
    name: 'abandon_claim',
    description: 'Give up on this turn\'s open claim because it named the wrong satisfy-condition. '
      + 'Refused until its bound check has run at least once. Record why it was wrong.',
    parameters: {
      reason: {
        type: 'string',
        required: true,
        description: 'Why the declared condition was the wrong one.',
      },
    },
    output: CLAIM_OUTPUT,
    execute(args, exec) {
      const agent = liveAgent(ctx, exec)
      return Promise.resolve(claimValue(ctx.claims.abandon(agent, args.reason)))
    },
    presentCall: () => present('Abandon claim', 'other'),
  }))
}
