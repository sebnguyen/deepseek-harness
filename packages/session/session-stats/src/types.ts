/**
 * Pure types of the session-stats domain: the ONE home of the `sessionStats`
 * projection-key declaration, free of this package's host-side value imports
 * (cordis context, zod, the llm chunk predicate). Two namespace projections
 * serve it — `./types` for host consumers, `./client` for client aggregates —
 * with zero content duplication.
 *
 * @module @deepseek-ai/dsh-session-stats/types
 */

// Marks this file a module so the declaration below AUGMENTS the projection
// table instead of declaring an ambient module.
export {}

/**
 * Whole-log conversation figures, independent of how much history a client
 * has paged in. Counts and wall times all fold from the complete durable log;
 * every field is 0 until its first contributing event lands. Field names
 * mirror the client window fold so an assembly without this unit can fall
 * back to it wholesale.
 */
export interface SessionStatsProjection {
  /** Distinct turns carrying at least one closed step (`step/end`); rejected or empty turns are uncounted. */
  turns: number
  /** Closed steps (`step/end` events) — completed, failed, and cancelled steps alike. */
  steps: number
  /** Summed model wall time (`step/start` → `assistant/message`) over steps that assembled a message. */
  llmMs: number
  /** Summed tool wall time over `tool/call` → `tool/result` pairs matched by callId. */
  toolMs: number
  /** Summed first-token latency (`step/start` → first non-empty delta chunk) over `ttftSteps`. */
  ttftMs: number
  /** Steps carrying a recorded first token. */
  ttftSteps: number
  /** Summed decode wall time (first token → `assistant/message`) over steps that also report output tokens. */
  decodeMs: number
  /** Summed provider output tokens over the same decode-timed steps. */
  decodeTokens: number
  /** Summed decode wall time over the up-to-five most recent decode-timed steps — the recency pool behind the chat pill's recent-speed chip. */
  recent5DecodeMs: number
  /** Summed provider output tokens over the same recent steps. */
  recent5DecodeTokens: number
}

/**
 * Deployment-declared USD per-million-token rates the `sessionCost` fold
 * prices provider usage under. All four rates are required once pricing is
 * opted in: silently leaving a bucket unpriced would understate the spend.
 */
export interface CostPricing {
  /** USD per million uncached input tokens. */
  inputPerMillionUsd: number
  /** USD per million output tokens. */
  outputPerMillionUsd: number
  /** USD per million cache-read tokens. */
  cacheReadPerMillionUsd: number
  /** USD per million cache-write tokens. */
  cacheWritePerMillionUsd: number
  /**
   * Per-model rates keyed by the model id the provider logs on
   * `assistant/message` (`message.source.model`). A recorded event whose
   * model is absent from the map prices under the flat rates above.
   */
  models?: Record<string, CostModelPricing>
}

/**
 * One model's USD per-million-token rates; every bucket is required so no
 * route can price at zero by omission.
 */
export interface CostModelPricing {
  /** USD per million uncached input tokens for this model. */
  inputPerMillionUsd: number
  /** USD per million output tokens for this model. */
  outputPerMillionUsd: number
  /** USD per million cache-read tokens for this model. */
  cacheReadPerMillionUsd: number
  /** USD per million cache-write tokens for this model. */
  cacheWritePerMillionUsd: number
}

/**
 * One model's folded provider usage and the spend priced from it; the four
 * token buckets mirror the whole-log totals so a client can show tokens
 * beside the amount. Each entry rounds its micros independently, so a sum
 * over entries can differ from `costMicros` by a fraction of a cent.
 */
export interface CostModelSpend {
  /** Provider uncached input tokens billed to this model. */
  uncachedInputTokens: number
  /** Provider output tokens billed to this model. */
  outputTokens: number
  /** Provider cache-read tokens billed to this model. */
  cacheReadTokens: number
  /** Provider cache-write tokens billed to this model. */
  cacheWriteTokens: number
  /** Estimated spend under the configured rates, USD micros. */
  costMicros: number
}

/**
 * The rate table the fold prices under, served beside the totals so a
 * client can show WHICH rates produced the figure.
 */
export interface SessionCostRates {
  /** Rates pricing models absent from `models`.
   */
  fallback: CostModelPricing
  /** Per-model rates keyed by the provider-logged model id. */
  models: Record<string, CostModelPricing>
}

/**
 * Whole-log provider usage priced under the deployment's configured rates.
 * Every session folds its own log, so a child subagent session renders its
 * own spend independently of its parent's — per-scope cost without any
 * cross-session scan.
 */
export interface SessionCostProjection {
  /** Provider uncached input tokens folded so far. */
  uncachedInputTokens: number
  /** Provider output tokens folded so far. */
  outputTokens: number
  /** Provider cache-read tokens folded so far. */
  cacheReadTokens: number
  /** Provider cache-write tokens folded so far. */
  cacheWriteTokens: number
  /** Estimated spend under the configured rates, USD micros. */
  costMicros: number
  /**
   * Per-model spend keyed by the provider-logged model id; events without a
   * logged model accumulate under the empty string. Entries sum to the four
   * token totals above.
   */
  perModel: Record<string, CostModelSpend>
  /** The rate table these totals were priced under. */
  rates: SessionCostRates
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Whole-log turn/step counts and wall times; see {@link SessionStatsProjection}. */
    sessionStats: SessionStatsProjection
    /** Whole-log provider usage priced under configured rates; see {@link SessionCostProjection}. */
    sessionCost: SessionCostProjection
  }
}
