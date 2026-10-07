/**
 * Cross-Node Step span folds. A span opens at its `assistant-step-start` row,
 * closes at its `assistant-step-end` row, and folds the reasoning section, Tool
 * rows, retry rows, and step-bound injected-context rows of the Step; the message
 * section always stands alone. Context rows placed before the Turn's first Step
 * carry no step coordinates and keep standing at the turn head.
 * Consecutive Steps whose message section carries no reply content share one
 * fold whose disclosure rides the first Step's opener and whose counts cover
 * the whole run; a visible message closes the run, so a transcript reads one
 * summary per process run with the replies between.
 */

import type { ChatNode } from '../contract/chat-nodes.ts'
import type { ChatLocationNodeIndex, ChatNodeStore } from '../contract/snapshot.ts'
import { hasAssistantReplyContent } from '../contract/assistant-content.ts'
import {
  FOLDABLE_MEMBER_KINDS, isSubagentDelegationTool, sameStepSpanFold, spanKey, type StepSpanFold,
} from '../contract/span-fold.ts'

/** Step coordinates of one node, when it lives inside an Assistant Step. */
function nodeSpan(node: ChatNode): { readonly turn: number; readonly step: number } | undefined {
  const location = node.location
  if (location.kind !== 'step') return undefined
  return { turn: location.turn.turn, step: location.step.step }
}

function toolRootName(node: ChatNode): string {
  if (node.kind !== 'tool-call') return ''
  const root = node.data.root
  return 'kind' in root ? root.call?.name ?? '' : root.name
}

interface SpanInfo {
  step: number
  startSeq: number | undefined
  openerRunning: boolean
  closed: boolean
  hasMessage: boolean
  members: number
  toolCalls: number
  subagents: number
  thoughts: number
  contexts: number
}

/**
 * Mutable projection of per-Step span folds over the loaded window. A fold is
 * derived from the materialized step nodes, so a span appears the moment its
 * opener row materializes and disappears when the window loses it; every span
 * of one run resolves to the run's single fold, keyed by its first Step.
 */
export class ChatSpanFoldProjector {
  private folds = new Map<string, StepSpanFold>()

  /** Fold attached to one Node's Step span, when the Node lives in a span. */
  get(node: ChatNode | undefined): StepSpanFold | undefined {
    if (node === undefined) return undefined
    const span = nodeSpan(node)
    return span === undefined ? undefined : this.folds.get(spanKey(span.turn, span.step))
  }

  /** Recompute every span from the complete materialized Node set. */
  replace(
    order: readonly string[],
    locations: ChatLocationNodeIndex,
    nodes: ChatNodeStore,
  ): ReadonlySet<string> {
    const turns = new Set<number>()
    for (const key of order) {
      const node = nodes.get(key) as ChatNode | undefined
      const span = node === undefined ? undefined : nodeSpan(node)
      if (span !== undefined) turns.add(span.turn)
    }
    const changing = this.update(turns, locations, nodes)
    for (const key of [...this.folds.keys()]) {
      const [turn] = key.split(':')
      if (turn !== undefined && !turns.has(Number(turn))) {
        this.folds.delete(key)
        changing.add(key)
      }
    }
    return changing
  }

  /** Recompute the span runs of the given Turns. */
  update(
    turns: ReadonlySet<number>,
    locations: ChatLocationNodeIndex,
    nodes: ChatNodeStore,
  ): Set<string> {
    const changing = new Set<string>()
    for (const turn of turns) {
      const next = this.computeTurn(turn, locations, nodes)
      const spanKeys = new Set<string>()
      for (const [key, fold] of next) {
        spanKeys.add(key)
        const current = this.folds.get(key)
        if (!sameStepSpanFold(current, fold)) {
          this.folds.set(key, fold)
          changing.add(key)
        }
      }
      for (const key of [...this.folds.keys()]) {
        const [keyTurn, step] = key.split(':')
        if (keyTurn === String(turn) && step !== undefined && !spanKeys.has(key)) {
          this.folds.delete(key)
          changing.add(key)
        }
      }
    }
    return changing
  }

  private computeTurn(
    turn: number,
    locations: ChatLocationNodeIndex,
    nodes: ChatNodeStore,
  ): Map<string, StepSpanFold> {
    const spans = new Map<number, SpanInfo>()
    for (const key of locations.getTurn(turn)) {
      const node = nodes.get(key) as ChatNode | undefined
      const span = node === undefined ? undefined : nodeSpan(node)
      if (span === undefined || node === undefined) continue
      const info = spans.get(span.step) ?? {
        step: span.step,
        startSeq: undefined,
        openerRunning: false,
        closed: false,
        hasMessage: false,
        members: 0,
        toolCalls: 0,
        subagents: 0,
        thoughts: 0,
        contexts: 0,
      }
      switch (node.kind) {
        case 'assistant-step-start':
          info.startSeq = info.startSeq === undefined
            ? node.anchorSeq
            : Math.min(info.startSeq, node.anchorSeq)
          info.openerRunning = node.data.status === 'running'
          break
        case 'assistant-step-end':
          info.closed = true
          break
        case 'assistant-step-message':
          if (hasAssistantReplyContent(node.data.blocks)) info.hasMessage = true
          break
        default:
          if (FOLDABLE_MEMBER_KINDS.has(node.kind)) {
            info.members += 1
            if (node.kind === 'assistant-step-reason') info.thoughts += 1
            if (node.kind === 'context') info.contexts += 1
            if (node.kind === 'tool-call') {
              if (isSubagentDelegationTool(toolRootName(node))) info.subagents += 1
              else info.toolCalls += 1
            }
          }
      }
      spans.set(span.step, info)
    }
    const folds = new Map<string, StepSpanFold>()
    let run: SpanInfo[] = []
    const closeRun = (): void => {
      // A Step whose opener the window lost keeps its members visible rather
      // than hiding them under a disclosure that never renders; the run folds
      // from its first materially open Step.
      const openIndex = run.findIndex(info => info.startSeq !== undefined)
      const folding = openIndex === -1 ? [] : run.slice(openIndex)
      run = []
      const head = folding[0]
      if (head === undefined || head.startSeq === undefined) return
      const fold: StepSpanFold = {
        turn,
        step: head.step,
        endStep: folding.at(-1)?.step ?? head.step,
        startSeq: head.startSeq,
        members: folding.reduce((sum, info) => sum + info.members, 0),
        toolCalls: folding.reduce((sum, info) => sum + info.toolCalls, 0),
        subagents: folding.reduce((sum, info) => sum + info.subagents, 0),
        thoughts: folding.reduce((sum, info) => sum + info.thoughts, 0),
        contexts: folding.reduce((sum, info) => sum + info.contexts, 0),
        running: folding.some(info => info.openerRunning || !info.closed),
      }
      for (const info of folding) folds.set(spanKey(turn, info.step), fold)
    }
    for (const step of [...spans.values()].sort((left, right) => left.step - right.step)) {
      if (step.hasMessage) {
        closeRun()
        run.push(step)
        closeRun()
        continue
      }
      run.push(step)
    }
    closeRun()
    return folds
  }
}
