import type { ChatNode } from '../contract/chat-nodes.ts'
import type {
  ChatLocationNodeIndex, ChatNodeStore, ChatTurnProcessPresentation,
  TurnProcessGroup,
} from '../contract/snapshot.ts'
import { hasAssistantReplyContent } from '../contract/assistant-content.ts'
import {
  isSubagentDelegationTool, TURN_PROCESS_INDEPENDENT_KINDS,
} from '../contract/turn-process.ts'

function nodeTurn(node: ChatNode | undefined): number | undefined {
  const location = node?.location
  return location?.kind === 'turn' || location?.kind === 'step' ? location.turn.turn : undefined
}

function sameGroups(
  left: readonly TurnProcessGroup[],
  right: readonly TurnProcessGroup[],
): boolean {
  return left.length === right.length
    && left.every((group, index) => {
      const other = right[index]
      return other !== undefined
        && group.start === other.start
        && group.boundary === other.boundary
        && group.members === other.members
        && group.toolCalls === other.toolCalls
        && group.subagents === other.subagents
    })
}

function samePresentation(
  left: ChatTurnProcessPresentation | undefined,
  right: ChatTurnProcessPresentation | undefined,
): boolean {
  return left === right || (left !== undefined && right !== undefined
    && left.spec === right.spec
    && left.turn === right.turn
    && left.turnClosed === right.turnClosed
    && left.hasExternalProcess === right.hasExternalProcess
    && left.compactAnswer === right.compactAnswer
    && sameGroups(left.groups, right.groups))
}

function derivePresentation(
  turn: number,
  locations: ChatLocationNodeIndex,
  nodes: ChatNodeStore,
): ChatTurnProcessPresentation | undefined {
  const keys = locations.getTurn(turn)
  const control = keys
    .map(key => nodes.get(key) as ChatNode | undefined)
    .find((node): node is ChatNode<'turn-process'> => node?.kind === 'turn-process')
  if (control === undefined) return undefined

  const spec = control.data
  const location = control.location
  if (location.kind !== 'turn' && location.kind !== 'step') return undefined
  let openingHumanAnchor: number | undefined
  for (const key of keys) {
    const node = nodes.get(key) as ChatNode | undefined
    if ((node?.kind === 'user' || node?.kind === 'steering')
      && node.anchorSeq < spec.controlAnchorSeq) {
      openingHumanAnchor = Math.min(openingHumanAnchor ?? node.anchorSeq, node.anchorSeq)
    }
  }

  let hasExternalProcess = false
  let compactAnswer = true
  // Fold groups: runs of foldable evidence terminated by a visible Assistant
  // reply, which stays rendered between the collapses. Only the run that
  // opens the Turn starts inside the process window; every later run starts
  // at the reply that ended the previous one, and those replies never fold,
  // so each group's start row stays visible and hosts its disclosure.
  const groups: TurnProcessGroup[] = []
  let groupStart = spec.processStartSeq
  let members = 0
  let toolCalls = 0
  let subagents = 0
  const closeGroup = (boundary: number): void => {
    if (members > 0) groups.push({ start: groupStart, boundary, members, toolCalls, subagents })
    members = 0
    toolCalls = 0
    subagents = 0
    groupStart = boundary
  }
  for (const key of keys) {
    const node = nodes.get(key) as ChatNode | undefined
    if (node === undefined || node.kind === 'turn-process') continue
    if ((node.kind === 'user' || node.kind === 'steering')
      && (openingHumanAnchor === undefined || node.anchorSeq > openingHumanAnchor)
      && (spec.answerAnchorSeq === null || node.anchorSeq < spec.answerAnchorSeq)) {
      compactAnswer = false
    }
    if (TURN_PROCESS_INDEPENDENT_KINDS.has(node.kind)
      || node.anchorSeq < spec.processStartSeq
      || (spec.answerAnchorSeq !== null && node.anchorSeq >= spec.answerAnchorSeq)) continue
    if (node.kind === 'assistant-step'
      && hasAssistantReplyContent(node.data.blocks)) {
      closeGroup(node.anchorSeq)
      continue
    }
    hasExternalProcess = hasExternalProcess
      || node.kind !== 'assistant-step' || spec.answerStep === null || node.data.step !== spec.answerStep
    members += 1
    if (node.kind === 'tool-call') {
      const root = node.data.root
      const rootName = 'kind' in root ? root.call?.name ?? '' : root.name
      if (isSubagentDelegationTool(rootName)) subagents += 1
      else toolCalls += 1
    }
  }
  if (spec.answerAnchorSeq === null) {
    // A running Turn's open run streams behind its own collapse.
    if (members > 0) groups.push({ start: groupStart, boundary: null, members, toolCalls, subagents })
  } else {
    closeGroup(spec.answerAnchorSeq)
  }
  return {
    turn,
    spec,
    turnClosed: location.turn.status === 'closed',
    hasExternalProcess,
    compactAnswer,
    groups,
  }
}

/** Mutable projection of cross-Node process layout facts by Turn. */
export class ChatTurnProcessProjector {
  private presentations = new Map<number, ChatTurnProcessPresentation>()

  /**
   * Read the retained process presentation for a Node's Turn.
   * @param node - Current Chat Node.
   * @returns The Turn's process presentation, when present.
   */
  get(node: ChatNode | undefined): ChatTurnProcessPresentation | undefined {
    const turn = nodeTurn(node)
    return turn === undefined ? undefined : this.presentations.get(turn)
  }

  /**
   * Replace every projected Turn.
   * @param order - visible Chat Node order.
   * @param locations - current Chat Location index.
   * @param nodes - current Chat Node store.
   * @returns Turns whose process presentation changed.
   */
  replace(
    order: readonly string[],
    locations: ChatLocationNodeIndex,
    nodes: ChatNodeStore,
  ): ReadonlySet<number> {
    const turns = new Set<number>()
    for (const key of order) {
      const turn = nodeTurn(nodes.get(key) as ChatNode | undefined)
      if (turn !== undefined) turns.add(turn)
    }
    const changed = new Set<number>()
    for (const turn of new Set([...this.presentations.keys(), ...turns])) {
      if (this.set(turn, turns.has(turn) ? derivePresentation(turn, locations, nodes) : undefined)) {
        changed.add(turn)
      }
    }
    return changed
  }

  /**
   * Recompute selected Turns after incremental Node changes.
   * @param turns - affected Turn numbers.
   * @param locations - current Chat Location index.
   * @param nodes - current Chat Node store.
   * @returns Turns whose process presentation changed.
   */
  update(
    turns: ReadonlySet<number>,
    locations: ChatLocationNodeIndex,
    nodes: ChatNodeStore,
  ): ReadonlySet<number> {
    const changed = new Set<number>()
    for (const turn of turns) {
      if (this.set(turn, derivePresentation(turn, locations, nodes))) changed.add(turn)
    }
    return changed
  }

  private set(turn: number, next: ChatTurnProcessPresentation | undefined): boolean {
    const current = this.presentations.get(turn)
    if (samePresentation(current, next)) return false
    if (next === undefined) this.presentations.delete(turn)
    else this.presentations.set(turn, next)
    return true
  }
}
