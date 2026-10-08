import type { ChatNode } from './chat-nodes.ts'

/** One Assistant Step span's derived fold state. */
export interface StepSpanFold {
  readonly turn: number
  readonly step: number
  /** Last Step the fold's run covers; equals `step` for single-Step runs. */
  readonly endStep: number
  /** Durable anchor of the span opener row. */
  readonly startSeq: number
  /** Foldable member rows the span hides while closed. */
  readonly members: number
  readonly toolCalls: number
  readonly subagents: number
  /** Member rows carrying reasoning content. */
  readonly thoughts: number
  /** Step-bound injected-context rows folded with the span. */
  readonly contexts: number
  /** Node row the disclosure rides: the span opener, or the prompt row it
   * covers when the span answers a prompt logged inside it. */
  readonly disclosureKey: string
  /** Whether the Step's durable end has not arrived yet. */
  readonly running: boolean
}

/** Node kinds whose rows fold into their Step span instead of standing alone. */
export const FOLDABLE_MEMBER_KINDS: ReadonlySet<string> = new Set([
  'assistant-step-reason',
  'tool-call',
  'model-retry',
  'context',
])

/**
 * Stable identity of one Assistant Step span.
 * @param turn - owning turn.
 * @param step - owning step.
 * @returns the Session-local span key.
 */
export function spanKey(turn: number, step: number): string {
  return `${turn}:${step}`
}

/**
 * Compare span folds by their published fields.
 * @param left - previous fold, if any.
 * @param right - next fold, if any.
 * @returns whether both describe the same fold.
 */
export function sameStepSpanFold(
  left: StepSpanFold | undefined,
  right: StepSpanFold | undefined,
): boolean {
  return left === right || (left !== undefined && right !== undefined
    && left.turn === right.turn
    && left.step === right.step
    && left.endStep === right.endStep
    && left.startSeq === right.startSeq
    && left.members === right.members
    && left.toolCalls === right.toolCalls
    && left.subagents === right.subagents
    && left.thoughts === right.thoughts
    && left.contexts === right.contexts
    && left.disclosureKey === right.disclosureKey
    && left.running === right.running)
}

/**
 * Recognize the shipped subagent delegation name and its configured variants.
 * Control tools use distinct names such as `send_message` and `list_agents`.
 * @param name - durable Tool-call name.
 * @returns whether the call creates or forks a subagent.
 */
export function isSubagentDelegationTool(name: string): boolean {
  return name === 'subagent' || name.startsWith('subagent_')
}

/** Foldable member kinds, typed for `ChatNode['kind']` exhaustiveness at the call site. */
export type FoldableMemberKind = ChatNode['kind']
