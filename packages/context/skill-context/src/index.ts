/**
 * Decision-model skill admission.
 *
 * At every pre-step the plugin judges the model-invocable catalog with
 * `ctx.decision` and emits the body of each skill the judgment admits, as a
 * durable `skill-invocation` injection. A skill whose body is already in the
 * model's window is never emitted again, which makes a repeated judgment emit
 * nothing. The published catalog is not modified: this plugin only adds, so a
 * failed judgment or a missing provider leaves the window exactly as it was.
 *
 * @module @deepseek-ai/dsh-skill-context
 */

import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  isModelInvocable, renderSkillContent,
  type SkillCatalogSnapshot, type SkillDefinition, type SkillInvocationSource, type SkillSummary,
} from '@deepseek-ai/dsh-skill'
import { DecisionService, type DecisionRequest, type NoulAnswer } from './decision.ts'
import { liveSkillNames } from './live-set.ts'
import { createTypeSafeEvaluator } from './typesafe.ts'

export const name = 'skill-context'
export const inject = ['agents', 'skills']

/** Plugin configuration. Every field is a deployment choice validated at load. */
export interface Config {
  /** Whether the pre-step judgment runs. Defaults to `true`. */
  enabled?: boolean
  /** Where judgments come from. `none` keeps the service without an evaluator. */
  provider?: 'typesafe' | 'none'
  /** Probability above which a candidate is admitted, in `(0, 1)`. Defaults to `0.5`. */
  threshold?: number
  /** Maximum skills admitted per step. Defaults to `3`. */
  topK?: number
  /** Pinned model identifier; an alias would retune a threshold without notice. */
  model?: string
  /** Evaluation endpoint. */
  endpoint?: string
  /** Per-call timeout in milliseconds. Defaults to `10000`. */
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  provider: z.union([z.const('typesafe'), z.const('none')]).default('typesafe'),
  threshold: z.number().default(0.5),
  topK: z.number().default(3),
  model: z.string().default(''),
  endpoint: z.string().default('https://api.typesafe.ai/v1/systemone'),
  timeoutMs: z.number().default(10_000),
})

/** What one pre-step judgment produced, or why it produced nothing. */
export type AdmissionPlan =
  | { readonly kind: 'admit'; readonly skills: readonly SkillSummary[] }
  | { readonly kind: 'hold'; readonly reason: 'disabled' | 'incomplete' | 'evaluator-unavailable' | 'nothing-pending' }

/** Everything one admission decision reads. */
export interface AdmissionInput {
  /** The catalog observation for this step. */
  readonly snapshot: SkillCatalogSnapshot
  /** Skill names whose bodies the model's window already holds. */
  readonly live: ReadonlySet<string>
  /** The active evaluator, or undefined when no provider registered one. */
  readonly evaluate: ((request: DecisionRequest, signal: AbortSignal) => Promise<readonly NoulAnswer[]>) | undefined
  /** The step's state, sent as the judgment's material. */
  readonly state: unknown
  /** Abort signal for the judgment. */
  readonly signal: AbortSignal
}

/**
 * Decide which skills this step admits.
 *
 * Holding is the safe outcome in every unclear case: an incomplete observation
 * or a missing evaluator would otherwise judge an incomplete question set and
 * deny a skill the model needed.
 * @param input - the catalog observation, live set, evaluator, and state.
 * @param config - resolved plugin configuration.
 * @returns the admitted skills, or the reason nothing was admitted.
 */
export async function planAdmission(input: AdmissionInput, config: Config): Promise<AdmissionPlan> {
  if (config.enabled === false) return { kind: 'hold', reason: 'disabled' }
  if (!input.snapshot.complete) return { kind: 'hold', reason: 'incomplete' }
  const evaluate = input.evaluate
  if (evaluate === undefined) return { kind: 'hold', reason: 'evaluator-unavailable' }
  const pending = input.snapshot.skills.filter(skill => isModelInvocable(skill) && !input.live.has(skill.name))
  if (pending.length === 0) return { kind: 'hold', reason: 'nothing-pending' }
  const answers = await evaluate({
    state: input.state,
    questions: pending.map(skill => ({
      id: skill.name,
      instructions: `Is this skill needed to complete the task? ${skill.name}: ${skill.description}`,
    })),
  }, input.signal)
  const admitted = pending
    .filter((_, index) => (answers[index]?.probability ?? 0) > (config.threshold ?? 0.5))
    .slice(0, config.topK ?? 3)
  return { kind: 'admit', skills: admitted }
}

/**
 * One durable injection carrying a skill body.
 * @param skill - the admitted skill's renderable definition.
 * @returns the user-role message the loop commits.
 */
export function skillInjection(skill: Pick<SkillDefinition, 'name' | 'provider' | 'resourceBase' | 'content'>) {
  const source: SkillInvocationSource = { kind: 'skill-invocation', name: skill.name, form: 'instructions' }
  return createUserMessage({
    content: [{ type: 'text', text: renderSkillContent(skill) }],
    source,
  })
}

/** Reject configuration that cannot express a decision. */
function resolveConfig(config: Config): Config {
  const threshold = config.threshold ?? 0.5
  if (!(threshold > 0 && threshold <= 1)) {
    throw new Error(`skill-context: threshold must be in (0, 1], got ${String(threshold)}`)
  }
  const topK = config.topK ?? 3
  if (!Number.isInteger(topK) || topK < 1) {
    throw new Error(`skill-context: topK must be a positive integer, got ${String(topK)}`)
  }
  if ((config.provider ?? 'typesafe') === 'typesafe' && (config.model ?? '') === '') {
    throw new Error('skill-context: the typesafe provider requires a pinned model identifier')
  }
  return {
    enabled: config.enabled ?? true,
    provider: config.provider ?? 'typesafe',
    threshold,
    topK,
    model: config.model ?? '',
    endpoint: config.endpoint ?? 'https://api.typesafe.ai/v1/systemone',
    timeoutMs: config.timeoutMs ?? 10_000,
  }
}

/**
 * Mount the decision service, register the configured evaluator, and admit
 * skills at every pre-step.
 * @param ctx - plugin context.
 * @param config - plugin configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  ctx.plugin(DecisionService)
  if ((resolved.provider ?? 'typesafe') === 'typesafe') {
    const evaluate = createTypeSafeEvaluator({
      model: resolved.model ?? '',
      endpoint: resolved.endpoint ?? 'https://api.typesafe.ai/v1/systemone',
      timeoutMs: resolved.timeoutMs ?? 10_000,
    })
    ctx.inject(['decision'], (scope) => {
      const dispose = scope.decision.register(evaluate)
      return () => { dispose() }
    })
  }
  if (resolved.enabled === false) return
  ctx.on('agent/pre-step', async ({ agent, turn, step, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const service = ctx.get('decision')
    const snapshot = await ctx.skills.snapshot({ cwd: agent.session.header.cwd, signal, scope: agent })
    const plan = await planAdmission({
      snapshot,
      live: liveSkillNames(agent.session),
      evaluate: service === undefined ? undefined : (request, callSignal) => service.evaluate(request, callSignal),
      state: { turn, step },
      signal,
    }, resolved)
    if (plan.kind === 'hold') return decision
    const injections = []
    for (const summary of plan.skills) {
      const skill = await ctx.skills.get(summary.name, { cwd: agent.session.header.cwd, signal, scope: agent })
      if (skill !== undefined && isModelInvocable(skill)) injections.push(skillInjection(skill))
    }
    if (injections.length === 0) return decision
    return { ...decision, messages: [...decision.messages, ...injections] }
  })
}
