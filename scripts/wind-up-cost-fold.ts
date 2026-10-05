/**
 * Offline Stage-0/4 fold for the wind-up/wind-down design: read recorded
 * session jsonl logs outside the host, fold each scope's provider-reported
 * usage into token buckets and turns/steps, and price the split against the
 * closed-form in-session oracle so the Stage-4 report compares branch-off
 * against in-session discovery on real provider usage.
 *
 * The physical jsonl row of a current-generation session IS the logical
 * event object (`session-persistence-jsonl` encodes it verbatim), so the
 * fold parses rows directly: line one is the `type: 'session'` header, the
 * rest are events. Zstd-compressed logs are refuse-not-silence: the fold
 * reads raw logs only and says so about compressed ones.
 *
 * The closed form mirrors `artifacts/turn_cost.py` (model v3, the same
 * formula the explorer html renders) statement for statement, so oracle
 * and report share one arithmetic; parity is pinned in the sibling spec.
 *
 * @module scripts/wind-up-cost-fold
 */

import { readFileSync } from 'node:fs'

/** Zstd frame magic, little-endian 0xFD2FB528. */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** Per-scope fold of one session log's billed activity. */
export interface SessionUsageFold {
  /** Session id from the header line. */
  id: string
  /** Distinct `turn/start` events. */
  turns: number
  /** `step/end` events. */
  steps: number
  /** Provider uncached input tokens. */
  uncachedInputTokens: number
  /** Provider output tokens. */
  outputTokens: number
  /** Provider cache-read tokens. */
  cacheReadTokens: number
  /** Provider cache-write tokens. */
  cacheWriteTokens: number
}

function finiteCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * Per-model USD per-million-token rates (DigitalOcean serverless
 * inference, verified 2026-10-01; DO aligns with each provider's published
 * rates). Keys are the model ids this repository's DO and native DeepSeek
 * providers log; cache-write columns are zero where the route defines no
 * cache-miss charge.
 */
export const DO_MODEL_RATES: Record<string, { inputPerMillionUsd: number; outputPerMillionUsd: number; cacheReadPerMillionUsd: number; cacheWritePerMillionUsd: number }> = {
  'glm-5.3-flash': { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.50, cacheReadPerMillionUsd: 0.03, cacheWritePerMillionUsd: 0 },
  'glm-5.3': { inputPerMillionUsd: 1.40, outputPerMillionUsd: 4.40, cacheReadPerMillionUsd: 0.26, cacheWritePerMillionUsd: 0 },
  'minimax-m2.5': { inputPerMillionUsd: 0.30, outputPerMillionUsd: 1.20, cacheReadPerMillionUsd: 0.06, cacheWritePerMillionUsd: 0 },
  'mimo-v2.5-pro': { inputPerMillionUsd: 0.80, outputPerMillionUsd: 3.00, cacheReadPerMillionUsd: 0.16, cacheWritePerMillionUsd: 0 },
  'kimi-k2.6': { inputPerMillionUsd: 0.95, outputPerMillionUsd: 4.00, cacheReadPerMillionUsd: 0.19, cacheWritePerMillionUsd: 0 },
  'qwen3.8-max': { inputPerMillionUsd: 2.00, outputPerMillionUsd: 6.00, cacheReadPerMillionUsd: 0.20, cacheWritePerMillionUsd: 0 },
  // The DO catalog column lists this route under the family row `Gemma 4`.
  'gemma-4-31B-it': { inputPerMillionUsd: 0.18, outputPerMillionUsd: 0.50, cacheReadPerMillionUsd: 0.036, cacheWritePerMillionUsd: 0 },
  'deepseek-v4.1-flash': { inputPerMillionUsd: 0.30, outputPerMillionUsd: 1.20, cacheReadPerMillionUsd: 0.006, cacheWritePerMillionUsd: 0 },
  'deepseek-v4-flash-0731': { inputPerMillionUsd: 0.14, outputPerMillionUsd: 0.28, cacheReadPerMillionUsd: 0.028, cacheWritePerMillionUsd: 0 },
  'deepseek-v4-pro-0813': { inputPerMillionUsd: 1.32, outputPerMillionUsd: 3.96, cacheReadPerMillionUsd: 0.044, cacheWritePerMillionUsd: 0 },
  'deepseek-v4-pro': { inputPerMillionUsd: 1.74, outputPerMillionUsd: 3.48, cacheReadPerMillionUsd: 0.348, cacheWritePerMillionUsd: 0 },
  'deepseek-v4-flash': { inputPerMillionUsd: 0.14, outputPerMillionUsd: 0.28, cacheReadPerMillionUsd: 0.028, cacheWritePerMillionUsd: 0 },
}

/** Usage buckets attributable to one provider-logged model id. */
export interface ModelUsage {
  /** Provider uncached input tokens for this model. */
  uncachedInputTokens: number
  /** Provider output tokens for this model. */
  outputTokens: number
  /** Provider cache-read tokens for this model. */
  cacheReadTokens: number
  /** Provider cache-write tokens for this model. */
  cacheWriteTokens: number
}

/** Per-scope fold with usage attributed to each logged model id. */
export interface ModelUsageFold {
  /** Session id from the header line. */
  id: string
  /** Distinct `turn/start` events. */
  turns: number
  /** `step/end` events. */
  steps: number
  /** Usage keyed by `message.source.model`; unknown records go under the empty key. */
  byModel: Record<string, ModelUsage>
}
/**
 * Fold one recorded session log's rows into billed usage, attributed per
 * provider-logged model id so per-model rates can price each bucket set.
 * @param path - path to a plain (uncompressed) session jsonl log.
 * @returns the per-scope totals split by model.
 * @throws on zstd-compressed logs, missing header, or a malformed body row.
 */
export function foldSessionUsageByModel(path: string): ModelUsageFold {
  const totals = foldSessionUsage(path)
  const lines = readFileSync(path).toString('utf8').split('\n').filter(line => line.trim() !== '')
  const fold: ModelUsageFold = { id: totals.id, turns: totals.turns, steps: totals.steps, byModel: {} }
  for (let index = 1; index < lines.length; index += 1) {
    const event = JSON.parse(lines[index]!) as {
      type?: unknown
      data?: { usage?: unknown; message?: { source?: { model?: unknown } } }
    }
    if (event.type !== 'assistant/message') continue
    const usage = event.data?.usage
    if (typeof usage !== 'object' || usage === null) continue
    const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } = usage as Record<string, unknown>
    const input = finiteCount(inputTokens)
    const output = finiteCount(outputTokens)
    if (input === null || output === null) continue
    const model = typeof event.data?.message?.source?.model === 'string' ? event.data.message.source.model : ''
    const bucket = fold.byModel[model] ??= {
      uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    }
    bucket.uncachedInputTokens += input
    bucket.outputTokens += output
    bucket.cacheReadTokens += finiteCount(cacheReadTokens) ?? 0
    bucket.cacheWriteTokens += finiteCount(cacheWriteTokens) ?? 0
  }
  return fold
}

/**
 * Price per-model usage under a rate table, USD micros. Models absent from
 * the table price under `fallback`; a table miss with no fallback is a
 * configuration hole and throws, naming the models.
 * @param byModel - usage attributed per model id.
 * @param rates - USD per million for the four buckets, keyed by model id.
 * @param fallback - rates for models the table does not declare.
 * @returns estimated spend in millionths of a dollar.
 * @throws when a model has no table entry and no fallback was given.
 */
export function priceModelsMicros(
  byModel: Record<string, ModelUsage>,
  rates: Record<string, { inputPerMillionUsd: number; outputPerMillionUsd: number; cacheReadPerMillionUsd: number; cacheWritePerMillionUsd: number }>,
  fallback?: { inputPerMillionUsd: number; outputPerMillionUsd: number; cacheReadPerMillionUsd: number; cacheWritePerMillionUsd: number },
): number {
  let micros = 0
  const unknown: string[] = []
  for (const [model, usage] of Object.entries(byModel)) {
    const modelRates = rates[model] ?? fallback
    if (modelRates === undefined) { unknown.push(model); continue }
    micros += priceFoldMicros({ id: '', turns: 0, steps: 0, ...usage }, modelRates)
  }
  if (unknown.length > 0) {
    throw new Error(`wind-up-cost-fold: no rate for model(s) ${unknown.join(', ')}; pass flat rates or extend the table`)
  }
  return micros
}

/**
 * Fold one recorded session log's rows into billed usage.
 * @param path - path to a plain (uncompressed) session jsonl log.
 * @returns the per-scope totals.
 * @throws on zstd-compressed logs, missing header, or a malformed body row.
 */
export function foldSessionUsage(path: string): SessionUsageFold {
  const buffer = readFileSync(path)
  if (buffer.subarray(0, 4).equals(ZSTD_MAGIC)) {
    throw new Error(`wind-up-cost-fold: ${path} is zstd-compressed; decompress it (or re-record uncompressed) before folding`)
  }
  const lines = buffer.toString('utf8').split('\n').filter(line => line.trim() !== '')
  let header: { type?: unknown; id?: unknown } | undefined
  try {
    header = JSON.parse(lines[0] ?? '') as { id?: unknown }
  } catch {
    throw new Error(`wind-up-cost-fold: ${path} line 1 is not JSON`)
  }
  if (header === undefined || header.type !== 'session' || typeof header.id !== 'string') {
    throw new Error(`wind-up-cost-fold: ${path} lacks a type:'session' header line`)
  }
  const fold: SessionUsageFold = {
    id: header.id,
    turns: 0,
    steps: 0,
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }
  for (let index = 1; index < lines.length; index += 1) {
    let event: { type?: unknown; data?: { usage?: unknown } }
    try {
      event = JSON.parse(lines[index]!) as typeof event
    } catch {
      throw new Error(`wind-up-cost-fold: ${path} line ${index + 1} is not JSON`)
    }
    switch (event.type) {
      case 'turn/start':
        fold.turns += 1
        break
      case 'step/end':
        fold.steps += 1
        break
      case 'assistant/message': {
        const usage = event.data?.usage
        if (typeof usage !== 'object' || usage === null) break
        const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } = usage as Record<string, unknown>
        const input = finiteCount(inputTokens)
        const output = finiteCount(outputTokens)
        if (input === null || output === null) break
        fold.uncachedInputTokens += input
        fold.outputTokens += output
        fold.cacheReadTokens += finiteCount(cacheReadTokens) ?? 0
        fold.cacheWriteTokens += finiteCount(cacheWriteTokens) ?? 0
        break
      }
      default:
        break
    }
  }
  return fold
}

/**
 * Closed-form cost of one wind-up/wind-down task (model v3): four fixed
 * token pools, D discovery turns then k-D solving turns, fresh tokens at
 * full price, every turn's accumulated prefix re-billed at hit_frac of the
 * input price. Mirrors `artifacts/turn_cost.py::task_cost` exactly.
 * @param xd - discovery input tokens (tool results read while exploring).
 * @param xs - solving input tokens (call results while fixing).
 * @param yd - discovery output tokens (calls and notes).
 * @param ys - solving output tokens (the fix).
 * @param k - total turns.
 * @param d - discovery turns; 0 skips discovery entirely.
 * @param pIn - USD per million input tokens.
 * @param pOut - USD per million output tokens.
 * @param hitFrac - share of the input price the cache echo bills (0, 0.1, 1).
 * @param overhead - fresh overhead tokens per turn.
 * @returns total USD for the session.
 */
export function closedFormTaskCost(
  xd: number, xs: number, yd: number, ys: number,
  k: number, d: number, pIn: number, pOut: number, hitFrac: number, overhead: number,
): number {
  if (d === 0) {
    xd = 0
    yd = 0
  }
  const s = k - d
  const dIn = d > 0 ? xd / d : 0
  const dOut = d > 0 ? yd / d : 0
  const sIn = xs / s
  const sOut = ys / s
  let freshT = 0
  let cacheT = 0
  for (let i = 1; i <= k; i += 1) {
    let fresh: number
    let prefix: number
    if (d > 0 && i <= d) {
      fresh = dIn + dOut + overhead
      prefix = (xd + yd) * (i - 1) / d
    } else {
      fresh = sIn + sOut + overhead
      prefix = (xd + yd) + (xs + ys) * (i - d - 1) / s
    }
    freshT += fresh
    cacheT += hitFrac * prefix
  }
  return (pIn * (freshT + cacheT) + pOut * (yd + ys)) / 1e6
}

/**
 * Price one scope's folded usage under deployment rates, USD micros.
 * @param fold - the folded buckets.
 * @param rates - USD per million for each bucket, same order as the buckets.
 * @returns estimated spend in millionths of a dollar.
 */
export function priceFoldMicros(
  fold: SessionUsageFold,
  rates: { inputPerMillionUsd: number; outputPerMillionUsd: number; cacheReadPerMillionUsd: number; cacheWritePerMillionUsd: number },
): number {
  return Math.round(
    fold.uncachedInputTokens * rates.inputPerMillionUsd
    + fold.outputTokens * rates.outputPerMillionUsd
    + fold.cacheReadTokens * rates.cacheReadPerMillionUsd
    + fold.cacheWriteTokens * rates.cacheWritePerMillionUsd,
  )
}

/** CLI entry: fold and price every named log, then the summed report. */
if (import.meta.url === `file://${process.argv[1]}`) {
  const paths = process.argv.slice(2).filter(arg => !arg.startsWith('--'))
  const doMode = process.argv.includes('--do')
  const rateOr = (flag: string): number | undefined => {
    const at = process.argv.indexOf(flag)
    if (at < 0) return undefined
    const value = Number(process.argv[at + 1])
    if (!Number.isFinite(value) || value < 0) throw new Error(`wind-up-cost-fold: ${flag} needs a non-negative number`)
    return value
  }
  const flatInput = rateOr('--input')
  const flatOutput = rateOr('--output')
  const flatRead = rateOr('--cache-read')
  const flatWrite = rateOr('--cache-write')
  const flat = flatInput !== undefined && flatOutput !== undefined && flatRead !== undefined && flatWrite !== undefined
    ? {
      inputPerMillionUsd: flatInput,
      outputPerMillionUsd: flatOutput,
      cacheReadPerMillionUsd: flatRead,
      cacheWritePerMillionUsd: flatWrite,
    }
    : undefined
  const rates = flat ?? {
    inputPerMillionUsd: NaN, outputPerMillionUsd: NaN, cacheReadPerMillionUsd: NaN, cacheWritePerMillionUsd: NaN,
  }
  if (paths.length === 0) throw new Error('wind-up-cost-fold: pass at least one session jsonl path')
  if (!doMode) {
    if (flat === undefined) throw new Error('wind-up-cost-fold: --input --output --cache-read --cache-write (or --do) required')
    const folds = paths.map(foldSessionUsage)
    const totalMicros = folds.reduce((sum, fold) => sum + priceFoldMicros(fold, rates), 0)
    console.log(JSON.stringify({ folds, totalUsd: totalMicros / 1e6 }, null, 2))
  } else {
    const folds = paths.map(foldSessionUsageByModel)
    const totalMicros = folds.reduce(
      (sum, fold) => sum + priceModelsMicros(fold.byModel, DO_MODEL_RATES, flat),
      0,
    )
    console.log(JSON.stringify({ folds, totalUsd: totalMicros / 1e6 }, null, 2))
  }
}
