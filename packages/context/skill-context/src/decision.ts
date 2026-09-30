/**
 * Decision capability definition: typed questions in, typed answers out.
 *
 * The definition owns `ctx.decision` and carries no provider vocabulary, so a
 * provider plugin registers an evaluator and no Consumer imports provider
 * types. One evaluator is active at a time: a second registration fails rather
 * than silently replacing the first.
 *
 * @module @deepseek-ai/dsh-skill-context/decision
 */

import { Service, type Context } from '@deepseek-ai/cordis'

/** One typed question: a judgment to make about the shared state. */
export interface DecisionQuestion {
  /** Stable identifier; the question id is never sent to the model. */
  readonly id: string
  /** The exact condition to judge, stated literally. */
  readonly instructions: string
}

/** A Noul answer: the probability that the instruction holds, in `[0, 1]`. */
export interface NoulAnswer {
  readonly kind: 'noul'
  readonly probability: number
}

/** One state evaluated against every question in a single provider call. */
export interface DecisionRequest {
  /** The material to judge. Text only at the provider boundary. */
  readonly state: unknown
  /** Every question to answer about that state. */
  readonly questions: readonly DecisionQuestion[]
}

/**
 * Provider implementation. Answers are returned in request order.
 * @param request - the state and the questions to answer.
 * @param signal - aborts the provider call.
 * @returns one answer per question.
 */
export type DecisionEvaluator = (
  request: DecisionRequest,
  signal: AbortSignal,
) => Promise<readonly NoulAnswer[]>

/** Removes one registered evaluator. */
export type DecisionDisposer = () => void

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The decision capability, present once this package's plugin is mounted. */
    decision: DecisionService
  }
}

/** Decision capability: the active evaluator plus its registration contract. */
export class DecisionService extends Service {
  private evaluator: DecisionEvaluator | undefined

  /**
   * @param ctx - plugin context receiving the `decision` key.
   */
  constructor(ctx: Context) {
    super(ctx, 'decision')
  }

  /**
   * Register the active evaluator.
   * @param evaluator - the provider implementation.
   * @returns the disposer that removes it.
   * @throws when an evaluator is already registered.
   */
  register(evaluator: DecisionEvaluator): DecisionDisposer {
    if (this.evaluator !== undefined) {
      throw new Error('dsh-decision: an evaluator is already registered')
    }
    this.evaluator = evaluator
    return () => {
      if (this.evaluator === evaluator) this.evaluator = undefined
    }
  }

  /**
   * Evaluate every question against one state.
   * @param request - the state and the questions to answer.
   * @param signal - aborts the provider call.
   * @returns one answer per question, in request order.
   * @throws when no evaluator is registered.
   */
  async evaluate(request: DecisionRequest, signal: AbortSignal): Promise<readonly NoulAnswer[]> {
    const evaluator = this.evaluator
    if (evaluator === undefined) throw new Error('dsh-decision: no evaluator is registered')
    return evaluator(request, signal)
  }
}
