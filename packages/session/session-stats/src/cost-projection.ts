/**
 * The `sessionCost` projection unit: whole-log provider token usage priced
 * under deployment-declared per-million rates. Each session folds its own
 * log, so a child subagent session carries its own spend and the client's
 * per-scope projection read yields per-agent cost without any cross-session
 * scan.
 *
 * The fold reads exactly the provider buckets the `tokenUsage` fold reads —
 * `usage.inputTokens` is the uncached prompt remainder (adapters subtract
 * cache counters from it), so the four buckets map one-to-one onto the four
 * configured rates. Micro dollars per token equal the per-million rate, so
 * the accumulation is exact integer-friendly arithmetic with one round at
 * the end. Beside the whole-log totals the fold keeps one spend entry per
 * provider-logged model (`perModel`), so a client can list WHERE the spend
 * went without rescanning the log.
 *
 * @module @deepseek-ai/dsh-session-stats/cost-projection
 */

import { z } from 'zod'
import type { ZodType } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { CostModelPricing, CostModelSpend, CostPricing, SessionCostProjection } from './types.ts'

/** The client-visible unit: the full definition with its wire face present. */
export type SessionCostUnit = {
  key: 'sessionCost'
  stateVersion: number
  stateSchema: ZodType<SessionCostProjection>
  init(header: unknown, inheritedEventCount: unknown): SessionCostProjection
  apply(state: SessionCostProjection, event: SessionEvent): SessionCostProjection
  wire: { viewSchema: ZodType<SessionCostProjection>; view(state: SessionCostProjection): SessionCostProjection }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    sessionCost: SessionCostProjection
  }
}

/** One model's four rates on the wire. */
const modelRatesSchema = z.object({
  inputPerMillionUsd: z.number().nonnegative(),
  outputPerMillionUsd: z.number().nonnegative(),
  cacheReadPerMillionUsd: z.number().nonnegative(),
  cacheWritePerMillionUsd: z.number().nonnegative(),
}).strict()

/** One model's folded spend on the wire. */
const modelSpendSchema = z.object({
  uncachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  costMicros: z.number().nonnegative(),
}).strict()

/** The unit's wire output boundary: the strict view schema. */
const costSchema = z.object({
  uncachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  costMicros: z.number().nonnegative(),
  perModel: z.record(z.string(), modelSpendSchema),
  rates: z.object({
    fallback: modelRatesSchema,
    models: z.any(),
  }).strict(),
}).strict()

/**
 * Provider-reported usage buckets from an untrusted `usage` record, or null
 * unless `inputTokens`/`outputTokens` are finite nonnegatives.
 * @param usage - the assistant/message event's optional usage record.
 * @returns the four token buckets, or null when usage is absent or malformed.
 */
function usageBuckets(usage: unknown): { input: number; output: number; cacheRead: number; cacheWrite: number } | null {
  if (typeof usage !== 'object' || usage === null) return null
  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } = usage as {
    inputTokens?: unknown
    outputTokens?: unknown
    cacheReadTokens?: unknown
    cacheWriteTokens?: unknown
  }
  const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
  if (!finite(inputTokens) || !finite(outputTokens)) return null
  return {
    input: inputTokens,
    output: outputTokens,
    cacheRead: finite(cacheReadTokens) ? cacheReadTokens : 0,
    cacheWrite: finite(cacheWriteTokens) ? cacheWriteTokens : 0,
  }
}

/**
 * Validate one rate record; all four buckets must be finite nonnegatives.
 * @param rates - candidate rates under one path for error messages.
 * @param path - config path the rates were read from.
 * @returns the rates as {@link CostModelPricing}.
 */
function requireRates(rates: unknown, path: string): CostModelPricing {
  if (typeof rates !== 'object' || rates === null) throw new Error(`${path} must be an object of four rates`)
  const record = rates as Record<string, unknown>
  const read = (field: string): number => {
    const value = record[field]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(`${path}.${field} must be a finite non-negative number`)
    }
    return value
  }
  return {
    inputPerMillionUsd: read('inputPerMillionUsd'),
    outputPerMillionUsd: read('outputPerMillionUsd'),
    cacheReadPerMillionUsd: read('cacheReadPerMillionUsd'),
    cacheWritePerMillionUsd: read('cacheWritePerMillionUsd'),
  }
}

/**
 * Resolve the validated rate table: per-model entries plus the flat rates as
 * the unknown-model fallback. Throws on any malformed entry so a
 * misconfigured layer fails at plugin load instead of underpricing live.
 * @param pricing - deployment rates as configured.
 * @returns `{ fallback, models }` with every entry validated.
 */
function rateTable(pricing: CostPricing): { fallback: CostModelPricing; models: Record<string, CostModelPricing> } {
  const fallback = requireRates(pricing, 'pricing')
  const models: Record<string, CostModelPricing> = {}
  for (const [model, rates] of Object.entries(pricing.models ?? {})) {
    models[model] = requireRates(rates, `pricing.models.${model}`)
  }
  return { fallback, models }
}

/**
 * The provider-logged model id of an `assistant/message` event, or undefined
 * for records without `message.source.model`.
 * @param event - the folded event.
 * @returns the wire model id when present and a string.
 */
function eventModel(event: SessionEvent): string | undefined {
  const data = event.data as { message?: { source?: { model?: unknown } } }
  return typeof data.message?.source?.model === 'string' ? data.message.source.model : undefined
}

/**
 * Build the `sessionCost` projection definition under one deployment's
 * rates; the rates live in the definition so the fold stays pure. Each
 * event prices under its recorded model's rates, falling back to the flat
 * rates for models the deployment did not declare.
 * @param pricing - USD per-million rates for the four token buckets, plus per-model overrides.
 * @returns the projection unit registered on `ctx.sessionProjections`.
 */
export function sessionCostProjectionDefinition(pricing: CostPricing): SessionCostUnit {
  const rates = rateTable(pricing)
  return {
    key: 'sessionCost',
    stateVersion: 2,
    stateSchema: costSchema,
    init: (): SessionCostProjection => ({
      uncachedInputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costMicros: 0,
      perModel: {},
      rates,
    }),
    apply: (state: SessionCostProjection, event: SessionEvent): SessionCostProjection => {
      if (event.type !== 'assistant/message') return state
      const buckets = usageBuckets(event.data.usage)
      if (buckets === null) return state
      const model = eventModel(event) ?? ''
      const rate = state.rates.models[model] ?? state.rates.fallback
      const deltaMicros = buckets.input * rate.inputPerMillionUsd
        + buckets.output * rate.outputPerMillionUsd
        + buckets.cacheRead * rate.cacheReadPerMillionUsd
        + buckets.cacheWrite * rate.cacheWritePerMillionUsd
      const prior = state.perModel[model]
      const entry: CostModelSpend = prior === undefined
        ? {
          uncachedInputTokens: buckets.input,
          outputTokens: buckets.output,
          cacheReadTokens: buckets.cacheRead,
          cacheWriteTokens: buckets.cacheWrite,
          costMicros: Math.round(deltaMicros),
        }
        : {
          uncachedInputTokens: prior.uncachedInputTokens + buckets.input,
          outputTokens: prior.outputTokens + buckets.output,
          cacheReadTokens: prior.cacheReadTokens + buckets.cacheRead,
          cacheWriteTokens: prior.cacheWriteTokens + buckets.cacheWrite,
          costMicros: Math.round(prior.costMicros + deltaMicros),
        }
      return {
        uncachedInputTokens: state.uncachedInputTokens + buckets.input,
        outputTokens: state.outputTokens + buckets.output,
        cacheReadTokens: state.cacheReadTokens + buckets.cacheRead,
        cacheWriteTokens: state.cacheWriteTokens + buckets.cacheWrite,
        costMicros: Math.round(state.costMicros + deltaMicros),
        perModel: { ...state.perModel, [model]: entry },
        rates: state.rates,
      }
    },
    wire: {
      viewSchema: costSchema,
      view: (state: SessionCostProjection) => state,
    },
  }
}
