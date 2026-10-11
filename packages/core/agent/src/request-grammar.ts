/**
 * Request-grammar arbitration: one declared, priority-ordered registry of
 * `structuredOutput`/`toolChoice` writers on top of the `agent/request`
 * waterfall. Free-form listeners that overwrite these fields on whatever
 * seed they receive compose last-write-wins in registration order, which let
 * one consumer's cost guard (ui-quiet's empty-object shield) clobber another
 * consumer's capture schema (the subagent step budget) in whichever order
 * composition happened to register them. Contributions declare a priority
 * instead; the fold applies them ascending, so the writer with the larger
 * priority always lands its value last regardless of listener wiring.
 *
 * The service is mounted by the `agents` service's constructor, so every
 * context that mounts `dsh-agent` — production composition and the shared
 * loop testkit alike — has the seam without a further patch row.
 *
 * @module @deepseek-ai/dsh-agent/request-grammar
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { LlmCallConfig, StructuredOutputSchema, ToolChoice } from '@deepseek-ai/dsh-llm'
import type { Agent } from './types.ts'

/**
 * Canonical writer priorities, most-authoritative last. A deployment adding
 * its own writer picks the band its contribution belongs to rather than a
 * literal, keeping the ordering contract readable.
 */
export const GRAMMAR_PRIORITY = {
  /** Preset/composed defaults; every structural writer overrides them. */
  preset: 100,
  /** Turn-shape preferences (conversation mode); cost hints, never capture. */
  turnShape: 200,
  /** Structured-output capture drivers, e.g. the subagent step budget. */
  structuredOutputDriver: 300,
  /** Staging/escalation constraints; the most authoritative grammar writer. */
  staging: 400,
} as const

/** One augmented request config as several contributions fold over it. */
export type GrammarAugmentedConfig = LlmCallConfig & {
  structuredOutput?: StructuredOutputSchema
  toolChoice?: ToolChoice
}

/** Input handed to one contribution's {@link RequestGrammarContribution.attach}. */
export interface RequestGrammarDraft {
  /** The agent whose model request is being assembled. */
  readonly agent: Agent
  readonly turn: number
  readonly step: number
  /**
   * The merged config as contributed so far, including earlier (lower-
   * priority) contributions' patches. Read freely; write only what you own.
   */
  readonly config: GrammarAugmentedConfig
}

/** The grammar fields one contribution wants on this request. */
export interface RequestGrammarPatch {
  readonly structuredOutput?: StructuredOutputSchema
  readonly toolChoice?: ToolChoice
}

export interface RequestGrammarContribution {
  /** Stable, unique id for diagnostics and duplicate detection. */
  readonly id: string
  /** Lower applies earlier; higher wins on conflicts (see GRAMMAR_PRIORITY). */
  readonly priority: number
  /**
   * Attempt one grammar write for this request. Return `undefined` to leave
   * this writer's fields untouched. Scoped contributors check
   * `draft.agent.id` against their own and abstain for other agents.
   */
  attach(draft: RequestGrammarDraft): RequestGrammarPatch | undefined
}

/**
 * Declared-priority arbitration over request-grammar writes. Replaces the
 * last-writer-wins `agent/request` waterfall for grammar fields
 * (`structuredOutput`, `toolChoice`): every writer contributes a priority
 * with consistent semantics, and one fold listener merges the results —
 * composition order no longer decides which grammar survives.
 */
export class RequestGrammarService extends Service {
  private readonly contributions = new Map<string, RequestGrammarContribution>()

  constructor(ctx: Context) {
    super(ctx, 'request-grammar')
    // One listener folds every contribution, so listener wiring never leaks
    // into the outcome: only declared priority decides order.
    ctx.on('agent/request', this.fold.bind(this))
  }

  /**
   * Register one grammar writer. The returned disposer removes it; callers
   * should hand it to their own `ctx.effect` for fiber lifecycle cleanup.
   * Contributing the same id twice throws, since a duplicate silently
   * re-orders the fold and hides the bug that registered it.
   * @param contribution - writer declaration; `attach` runs per folded seed.
   * @returns disposer deregistering the contribution.
   */
  contribute(contribution: RequestGrammarContribution): () => void {
    if (this.contributions.has(contribution.id)) {
      throw new Error(`request-grammar contribution '${contribution.id}' is already registered`)
    }
    this.contributions.set(contribution.id, contribution)
    return () => {
      this.contributions.delete(contribution.id)
    }
  }

  private async fold(
    payload: { agent: Agent; turn: number; step: number; signal: AbortSignal },
    next: () => Promise<LlmCallConfig>,
  ): Promise<LlmCallConfig> {
    if (this.contributions.size === 0) return next()
    let config: GrammarAugmentedConfig = await next()
    const ordered = [...this.contributions.values()].sort((l, r) => l.priority - r.priority)
    for (const contribution of ordered) {
      const patch = contribution.attach({
        agent: payload.agent,
        turn: payload.turn,
        step: payload.step,
        config,
      })
      if (patch === undefined) continue
      if (patch.structuredOutput !== undefined) config = { ...config, structuredOutput: patch.structuredOutput }
      if (patch.toolChoice !== undefined) config = { ...config, toolChoice: patch.toolChoice }
    }
    return config
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    'request-grammar': RequestGrammarService
  }
}
