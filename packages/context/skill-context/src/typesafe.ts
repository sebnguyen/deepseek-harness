/**
 * TypeSafe Jev evaluator: one Noul question per skill, answered in one call.
 *
 * The provider maps the decision request onto the evaluation endpoint and
 * renormalizes nothing: a Noul answer is already a probability, so the
 * configured threshold is the whole policy. Question ids never reach the
 * model, so each question restates its skill name in the instruction text.
 *
 * @module @deepseek-ai/dsh-skill-context/typesafe
 */

import type { DecisionEvaluator, DecisionRequest, NoulAnswer } from './decision.ts'

/** Endpoint, model, and timeout for one TypeSafe route. */
export interface TypeSafeConfig {
  /** Pinned model identifier, never an alias. */
  readonly model: string
  /** Evaluation endpoint. */
  readonly endpoint: string
  /** Per-call timeout in milliseconds. */
  readonly timeoutMs: number
}

/** One answer as the endpoint reports it. */
interface WireAnswer {
  readonly type?: unknown
  readonly noul?: unknown
}

/** The endpoint's response body for one evaluation. */
interface WireResponse {
  readonly answers?: unknown
}

/**
 * Map a decision request onto the endpoint's body.
 * @param config - the resolved route.
 * @param request - the state and questions to answer.
 * @returns the request body as plain JSON.
 */
export function toRequestBody(config: TypeSafeConfig, request: DecisionRequest): unknown {
  return {
    model: config.model,
    state: request.state,
    questions: Object.fromEntries(
      request.questions.map(question => [
        question.id,
        { type: 'noul', instructions: question.instructions },
      ]),
    ),
  }
}

/**
 * Read one Noul answer per requested question.
 * @param request - the questions that were sent, in order.
 * @param body - the decoded response body.
 * @returns one answer per question, in request order.
 * @throws when a requested id is missing or is not a probability.
 */
export function readNoulAnswers(request: DecisionRequest, body: unknown): readonly NoulAnswer[] {
  const answers = (body as WireResponse | null)?.answers
  if (typeof answers !== 'object' || answers === null) {
    throw new Error('skill-context: the evaluation response carried no answers')
  }
  return request.questions.map((question) => {
    const answer = (answers as Record<string, WireAnswer | undefined>)[question.id]
    const probability = answer?.noul
    if (typeof probability !== 'number' || !Number.isFinite(probability)) {
      throw new Error(`skill-context: the evaluation response omitted a probability for "${question.id}"`)
    }
    return { kind: 'noul', probability } as const
  })
}

/**
 * Build the evaluator for one TypeSafe route.
 * @param config - the resolved route.
 * @param fetchImpl - the fetch implementation, injectable for tests.
 * @returns the evaluator a provider plugin registers.
 */
export function createTypeSafeEvaluator(
  config: TypeSafeConfig,
  fetchImpl: typeof fetch = fetch,
): DecisionEvaluator {
  return async (request, signal) => {
    const timeout = AbortSignal.timeout(config.timeoutMs)
    const combined = AbortSignal.any([signal, timeout])
    const response = await fetchImpl(config.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toRequestBody(config, request)),
      signal: combined,
    })
    if (!response.ok) {
      throw new Error(`skill-context: the evaluation endpoint answered ${String(response.status)}`)
    }
    return readNoulAnswers(request, await response.json())
  }
}
