/**
 * Pure draft rules of the model-provider window: what a half-typed cell may
 * still commit, and the settings path operations a passing commit becomes.
 * Every branch here is exercised by the window's spec through the store;
 * no component holds a rule of its own.
 */

import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { formatCapacity, parseCapacity } from '@deepseek-ai/dsh-client-ui-primitives'

/** One row of the provider table as the window drafts it. */
export interface ProviderRow {
  /** Model id sent to the provider. */
  id: string
  /** Stored context window when the profile declares one. */
  contextWindow?: number
  /** Stored output cap when the profile declares one. */
  maxTokens?: number
  /** Stored tune when the profile declares one. */
  tunes?: { temperature?: number; reasoningEffort?: string }
  /** Offered harness efforts, from the entry's reasoningEfforts map. */
  efforts: readonly string[]
}

/**
 * What a capacity read produces.
 * @param text - the cell text as typed.
 * @returns a whole positive token count, or undefined when the text cannot commit.
 */
export function capacityOf(text: string): number | undefined {
  const parsed = parseCapacity(text)
  if (parsed === undefined) return undefined
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

/** Draft diagnostics for one row's cells; absent means the draft passes. */
export interface ProviderDraftErrors {
  /** Temperature draft problem, when the text cannot commit. */
  temp?: string
  /** Context window draft problem. */
  ctx?: string
  /** Max completion draft problem. */
  max?: string
}

/**
 * Judge a row's drafts against the model spec: temperature inside [0,1],
 * capacities whole positive counts over the shared K/M vocabulary, max at
 * most the row's context, context at most the route's ceiling.
 * @param drafts - the three editable texts as typed.
 * @param ceiling - the route's maxContextWindow when configured.
 * @returns per-cell diagnostics; an empty object is a passing draft.
 */
export function draftErrors(
  drafts: { temp: string; ctx: string; max: string },
  ceiling: number | undefined,
): ProviderDraftErrors {
  const errors: ProviderDraftErrors = {}
  const temp = Number(drafts.temp)
  if (drafts.temp.trim().length > 0
    && (!Number.isFinite(temp) || temp < 0 || temp > 1)) {
    errors.temp = 'temperature must parse inside 0-1'
  }
  const ctx = capacityOf(drafts.ctx)
  if (drafts.ctx.trim().length > 0 && ctx === undefined) {
    errors.ctx = 'capacity needs a whole number, optionally suffixed K or M'
  } else if (ctx !== undefined && ceiling !== undefined && ctx > ceiling) {
    errors.ctx = `exceeds the route ceiling ${formatCapacity(ceiling)}`
  }
  const max = capacityOf(drafts.max)
  if (drafts.max.trim().length > 0 && max === undefined) {
    errors.max = 'capacity needs a whole number, optionally suffixed K or M'
  } else if (max !== undefined && ctx !== undefined && max > ctx) {
    errors.max = 'max completion cannot exceed this model\'s context window'
  }
  return errors
}

/**
 * The path operations one passing row commit becomes. Blank drafts unset
 * their field (inherit the catalog capability); a valued draft sets it.
 * @param base - the settings path of the model entry (`models[i]` or `modelOverrides[id]`).
 * @param drafts - passing drafts only; commit callers judge first.
 * @returns ordered set/unset operations against the stored section.
 */
export function rowOps(
  base: readonly string[],
  drafts: { temp: string; ctx: string; max: string; effort: string | undefined },
): SettingsPathOpView[] {
  const ops: SettingsPathOpView[] = []
  const push = (field: string, value: number | string | undefined): void => {
    ops.push(value === undefined
      ? { op: 'unset', path: [...base, ...field.split('.')] }
      : { op: 'set', path: [...base, ...field.split('.')], value })
  }
  if (drafts.temp.trim().length > 0) push('tunes.temperature', Number(drafts.temp))
  else push('tunes.temperature', undefined)
  push('tunes.reasoningEffort', drafts.effort)
  push('contextWindow', capacityOf(drafts.ctx))
  push('maxTokens', capacityOf(drafts.max))
  return ops
}

/**
 * The next stored entry one passing row commit pins for a catalog-derived
 * row: the resolved entry verbatim with the drafted knobs applied — a
 * blank draft deletes its key, a valued one sets it. The element lives in
 * the full array the commit writes, so deletion is a plain key removal.
 * @param raw - the resolved entry the row was built from.
 * @param drafts - the three capacity/temperature texts as typed.
 * @param effort - the chosen reasoning effort, undefined to drop it.
 * @returns the entry the full-array commit stores for this row.
 */
export function entryWith(
  raw: Record<string, unknown>,
  drafts: { temp: string; ctx: string; max: string },
  effort: string | undefined,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...raw }
  const ctxCap = capacityOf(drafts.ctx)
  const maxCap = capacityOf(drafts.max)
  if (ctxCap === undefined) delete next.contextWindow
  else next.contextWindow = ctxCap
  if (maxCap === undefined) delete next.maxTokens
  else next.maxTokens = maxCap
  const tunes: Record<string, unknown> = typeof next.tunes === 'object' && next.tunes !== null
    ? { ...next.tunes as Record<string, unknown> }
    : {}
  if (drafts.temp.trim().length > 0) tunes.temperature = Number(drafts.temp)
  else delete tunes.temperature
  if (effort === undefined) delete tunes.reasoningEffort
  else tunes.reasoningEffort = effort
  if (Object.keys(tunes).length === 0) delete next.tunes
  else next.tunes = tunes
  return next
}

/**
 * Additive adoption entries for one endpoint interrogation: ids the route
 * already lists keep every stored cell untouched; unknown ids append with
 * the adapter's declared capacity, or the route's fallbacks.
 * @param existing - model ids the route already serves.
 * @param discovered - the endpoint's candidate rows, in its own order.
 * @param defaults - the route's capacity fallbacks.
 * @param efforts - the route's effort menu, stamped onto each new entry.
 * @returns new `models` entries to append after the listed rows.
 */
export function adoptionEntries(
  existing: ReadonlySet<string>,
  discovered: readonly { id: string; contextWindow?: number; maxTokens?: number }[],
  defaults: { contextWindow: number; maxTokens: number },
  efforts?: Readonly<Record<string, string | null>>,
): Record<string, unknown>[] {
  const menu = efforts !== undefined && Object.keys(efforts).length > 0 ? efforts : undefined
  const entries: Record<string, unknown>[] = []
  for (const model of discovered) {
    if (existing.has(model.id)) continue
    entries.push({
      id: model.id,
      contextWindow: model.contextWindow ?? defaults.contextWindow,
      maxTokens: model.maxTokens ?? defaults.maxTokens,
      // An empty map is the settings schema's materialization of an omitted
      // route menu. Stamping it makes catalog resolution reject every listed
      // model; omitting the field lets the route menu apply.
      ...menu === undefined ? {} : { reasoningEfforts: { ...menu } },
    })
  }
  return entries
}
