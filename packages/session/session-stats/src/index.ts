/**
 * Function plugin registering the `sessionStats` projection unit: whole-log
 * turn/step counts and LLM/tool/first-token/decode wall times served through
 * the session-projection seam (registry snapshot, change feed, and every
 * projection carrier), so clients render full-session figures that paging and
 * compaction cannot change. The plugin owns only the fold; delivery is the
 * seam's.
 *
 * @module @deepseek-ai/dsh-session-stats
 */

import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import { sessionCostProjectionDefinition } from './cost-projection.ts'
import { sessionStatsProjectionDefinition } from './projection.ts'

export type * from './types.ts'

/** Cordis plugin name. */
export const name = 'session-stats'
/** The projection registry is the plugin's whole purpose; without it the fiber stays pending. */
export const inject = ['sessionProjections']

/**
 * Plugin config: the cost fold's deployment rates. Absent `pricing` leaves
 * the cost unit unregistered (cost is a deployment policy, not a protocol
 * constant), and once present every bucket needs its own positive rate —
 * a silent half-priced bucket would understate the spend. The flat rates
 * price any model absent from `models`; `models` keys per-model rates by
 * the provider-logged model id.
 */
export interface Config {
  /** USD per-million rates; presence opts the `sessionCost` unit in. */
  pricing?: {
    /** USD charged per million uncached input tokens. */
    inputPerMillionUsd: number
    /** USD charged per million output tokens. */
    outputPerMillionUsd: number
    /** USD charged per million cache-read tokens. */
    cacheReadPerMillionUsd: number
    /** USD charged per million cache-write tokens. */
    cacheWritePerMillionUsd: number
    /** Per-model overrides keyed by the provider-logged model id. */
    models?: Record<string, {
      /** USD per million uncached input tokens for this model. */
      inputPerMillionUsd: number
      /** USD per million output tokens for this model. */
      outputPerMillionUsd: number
      /** USD per million cache-read tokens for this model. */
      cacheReadPerMillionUsd: number
      /** USD per million cache-write tokens for this model. */
      cacheWritePerMillionUsd: number
    }>
  }
}

export const Config: z<Config> = z.object({
  // Schemastery has no record type, so the per-model map rides as `any`;
  // the plugin validates every entry at apply time and throws on malformed
  // rates, so misconfiguration still fails loud at load.
  /** USD per-million rates; presence opts the `sessionCost` unit in. */
  pricing: z.any<NonNullable<Config['pricing']>>().default(undefined as unknown as NonNullable<Config['pricing']>),
})

/**
 * Register the `sessionStats` projection unit, plus `sessionCost` when the
 * deployment declares rates; the registrations are effects on this plugin's
 * fiber, so unloading removes the keys.
 * @param ctx - registrant context carrying the projection registry.
 * @param config - deployment rates for the cost fold.
 * @throws when `pricing` or any per-model entry has malformed rates.
 */
export function apply(ctx: Context, config: Config = {}): void {
  ctx.sessionProjections.register(sessionStatsProjectionDefinition)
  const pricing = config.pricing
  // Schemastery's object coercion can leave an absent `pricing` as an empty
  // shell; an empty object has no rates and must stay unregistered.
  if (pricing !== undefined && Object.keys(pricing).length > 0) {
    ctx.sessionProjections.register(sessionCostProjectionDefinition(pricing))
  }
}
