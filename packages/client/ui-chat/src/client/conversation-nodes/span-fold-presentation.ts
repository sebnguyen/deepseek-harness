/**
 * Cross-Node Step span folds. A span opens at its `assistant-step-start` row,
 * closes at its `assistant-step-end` row, and folds the reasoning section, Tool
 * rows, retry rows, and step-bound injected-context rows of the Step; the message
 * section always stands alone. Context rows placed before the Turn's first Step
 * carry no step coordinates and keep standing at the turn head.
 * Consecutive Steps whose message section carries no reply content share one
 * fold whose disclosure rides the first Step's opener and whose counts cover
 * the whole run; a visible message closes the run, so a transcript reads one
 * summary per process run with the replies between. A user or steering prompt
 * closes the run before the first Step whose events postdate the prompt: a
 * prompt admitted with Step coordinates splits at that Step, and a prompt
 * carrying only turn coordinates (the ordinary spliced submission) splits by
 * log seq — the Step's work after the prompt answers that prompt, so it must
 * not fold above the reader's latest message.
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
  /** A user/steering prompt landed inside the Step; the run ends before it. */
  splitBefore: boolean
  /** First log seq seen in the span; orders the span against turn-scoped prompts. */
  minSeq: number | undefined
  /** Last log seq seen in the span; bounds a covered prompt inside the head. */
  maxSeq: number | undefined
  /** Key of the span's opener row; default disclosure seat. */
  startKey: string | undefined
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
    const splits: number[] = []
    const prompts: { seq: number; key: string }[] = []
    for (const key of locations.getTurn(turn)) {
      const node = nodes.get(key) as ChatNode | undefined
      if (node === undefined) continue
      if (node.kind === 'user' || node.kind === 'steering') prompts.push({ seq: node.anchorSeq, key })
      const span = nodeSpan(node)
      if (span === undefined) {
        // A spliced prompt without Step coordinates still orders between
        // Steps by log seq; record it as a run split.
        if (node.kind === 'user' || node.kind === 'steering') splits.push(node.anchorSeq)
        continue
      }
      const info = spans.get(span.step) ?? {
        step: span.step,
        startSeq: undefined,
        openerRunning: false,
        closed: false,
        hasMessage: false,
        splitBefore: false,
        minSeq: undefined,
        maxSeq: undefined,
        startKey: undefined,
        members: 0,
        toolCalls: 0,
        subagents: 0,
        thoughts: 0,
        contexts: 0,
      }
      info.minSeq = info.minSeq === undefined
        ? node.anchorSeq
        : Math.min(info.minSeq, node.anchorSeq)
      info.maxSeq = info.maxSeq === undefined
        ? node.anchorSeq
        : Math.max(info.maxSeq, node.anchorSeq)
      switch (node.kind) {
        case 'assistant-step-start':
          info.startSeq = info.startSeq === undefined
            ? node.anchorSeq
            : Math.min(info.startSeq, node.anchorSeq)
          info.startKey ??= node.key
          info.openerRunning = node.data.status === 'running'
          break
        case 'assistant-step-end':
          info.closed = true
          break
        case 'assistant-step-message':
          if (hasAssistantReplyContent(node.data.blocks)) info.hasMessage = true
          break
        case 'user':
        case 'steering':
          info.splitBefore = true
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
      // The disclosure rides the run head's opener, except when a prompt
      // landed inside that span: then it rides the prompt row, so the pill
      // never paints above the reader's message.
      let disclosureKey = head.startKey ?? ''
      for (const prompt of prompts) {
        if (prompt.seq > head.startSeq && prompt.seq <= (head.maxSeq ?? head.startSeq)) {
          disclosureKey = prompt.key
          break
        }
      }
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
        disclosureKey,
        running: folding.some(info => info.openerRunning || !info.closed),
      }
      for (const info of folding) folds.set(spanKey(turn, info.step), fold)
    }
    const orderedSplits = splits.sort((left, right) => left - right)
    let splitAt = 0
    for (const step of [...spans.values()].sort((left, right) => left.step - right.step)) {
      if (step.splitBefore) closeRun()
      while (splitAt < orderedSplits.length) {
        const splitSeq = orderedSplits[splitAt]
        if (splitSeq === undefined || splitSeq >= (step.minSeq ?? Number.POSITIVE_INFINITY)) break
        splitAt += 1
        closeRun()
      }
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
