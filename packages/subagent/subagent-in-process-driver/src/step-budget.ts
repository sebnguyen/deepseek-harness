/**
 * Per-child step budget for in-process runs. The budget counts ACCEPTED
 * pre-steps (retries reuse their assembly and must not double-count). When a
 * capped child tries to settle without finishing, the serial
 * `agent/turn-stopping` dispatch keeps the turn alive with exactly one steered
 * consolidation step, and the `agent/request` waterfall attaches the child's
 * `outputSchema` as `GenerateOptions.structuredOutput` on that step and on the
 * step taken at the cap, letting the adapter grammar-decode the handoff on the
 * wire. A second bare settling, or any exploration step past the consolidation
 * step, is denied: the run settles `error`, which the tool layer reports as a
 * failed delegation.
 * @module @deepseek-ai/dsh-subagent-in-process-driver/step-budget
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type LlmCallConfig, type StructuredOutputSchema } from '@deepseek-ai/dsh-llm'

export interface StepBudgetConfig {
  /** Positive accepted-step ceiling; the consolidation step rides one above it. */
  readonly maxSteps: number
  /** Deployment-owned handoff grammar, attached to schema-forced steps. */
  readonly schema?: StructuredOutputSchema
  /** True once the `structured_output` capture committed; consolidation then skips. */
  readonly captured: () => boolean
}

/**
 * Attach the budget's listener set to a child during its creation window.
 * @param childCtx - the child agent's scoped context (`setup`'s first argument).
 * @param child - the child agent, steered when its exploration budget ends.
 * @param config - the step ceiling plus the optional handoff schema.
 */
export function attachStepBudget(childCtx: Context, child: Agent, config: StepBudgetConfig): void {
  let accepted = 0
  let interposed = false
  let requireSchema = false

  childCtx.on('agent/pre-step', async (_payload, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    // The steered consolidation step is admitted; any exploration step beyond
    // it is denied so the run settles instead of running.
    if (accepted > config.maxSteps && !requireSchema) {
      return { kind: 'reject' }
    }
    accepted += 1
    return decision
  })

  childCtx.on('agent/turn-stopping', () => {
    if (config.captured() || interposed || accepted > config.maxSteps) return
    interposed = true
    requireSchema = true
    child.steer(createUserMessage({
      content: [{
        type: 'text',
        text: config.schema === undefined
          ? 'Your exploration budget is spent. Finish now: your next message is your report and nothing else.'
          : 'Your exploration budget is spent. Finish now: your next message is the structured handoff only; do not keep exploring.',
      }],
      source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-subagent-in-process-driver' },
    }))
  })

  childCtx.on(
    'agent/request',
    async (_payload, next): Promise<LlmCallConfig & { structuredOutput?: StructuredOutputSchema }> => {
      const seed = await next()
      if (config.schema === undefined || (!requireSchema && accepted < config.maxSteps)) return seed
      requireSchema = false
      return { ...seed, structuredOutput: config.schema }
    },
  )
}
