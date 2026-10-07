/**
 * Per-Step Assistant span Definitions: the opener, the Reasoning and message
 * sections, and the closer. Each owns exactly one Node per Step, so the span —
 * not a seq-window scan — delimits what folds. The message section is the
 * transcript's default visible member; the opener hosts the disclosure that
 * reveals the folded sections and the Step's Tool rows.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  AssistantBlock, AssistantMessageNode, ConversationMatch,
  ConversationNodeContext, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm-retry/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { AssistantChatData, AssistantStepBoundaryChatData } from '../contract/chat-nodes.ts'
import { chatNode } from './common.ts'
import {
  emptyAssistantBlock, isTokenDelta, toAssistantBlock, toAssistantBlocks,
} from './event-projection.ts'

declare module '../contract/chat-nodes.ts' {
  interface ChatNodeDataMap {
    /** Span opener: carries the disclosure for the Step's folded sections. */
    'assistant-step-start': AssistantStepBoundaryChatData
    /** Span closer: the Step's durable end boundary row. */
    'assistant-step-end': AssistantStepBoundaryChatData
    /** Reasoning section of one Assistant Step. */
    'assistant-step-reason': AssistantChatData
    /** Message section of one Assistant Step; the default visible member. */
    'assistant-step-message': AssistantChatData
  }
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationStepDataMap {
    /** Settled message section carried beside the Step's view Nodes. */
    'assistant-step-message': AssistantChatData
  }
}

/** Which Assistant blocks one section Node publishes. */
export type AssistantSection = 'reasoning' | 'message'

interface SectionState {
  readonly turn: number
  readonly step: number
  readonly blocks: readonly (AssistantBlock | undefined)[]
  readonly visibleBlocks: number
  readonly firstVisibleSeq: number | undefined
  readonly firstVisibleTime: number | undefined
  readonly firstTokenTime: number | undefined
  readonly final: ConversationMatch | undefined
  readonly usage: unknown
}

interface BoundaryState {
  readonly turn: number
  readonly step: number
  readonly closed: boolean
}

type ConversationEvent = Parameters<ConversationNodeDefinition['match']>[0]

function initialState(turn: number, step: number): SectionState {
  return {
    turn,
    step,
    blocks: [],
    visibleBlocks: 0,
    firstVisibleSeq: undefined,
    firstVisibleTime: undefined,
    firstTokenTime: undefined,
    final: undefined,
    usage: undefined,
  }
}

function compactBlocks(blocks: readonly (AssistantBlock | undefined)[]): AssistantBlock[] {
  return blocks.filter((block): block is AssistantBlock => block !== undefined)
}

/** Whether one block contributes user-visible content to any section. */
function blockIsVisible(block: AssistantBlock | undefined): boolean {
  if (block === undefined || block.kind === 'tool-call') return false
  if (block.kind === 'text' || block.kind === 'reasoning') return block.text.trim() !== ''
  return true
}

function countVisibleBlocks(blocks: readonly AssistantBlock[]): number {
  let count = 0
  for (const block of blocks) if (blockIsVisible(block)) count++
  return count
}

/** Whether one block belongs to the section this Definition publishes. */
function sectionAccepts(section: AssistantSection, block: AssistantBlock): boolean {
  if (section === 'reasoning') return block.kind === 'reasoning'
  return block.kind !== 'reasoning' && block.kind !== 'tool-call'
}

function sectionBlocks(section: AssistantSection, blocks: readonly AssistantBlock[]): AssistantBlock[] {
  return blocks.filter(block => sectionAccepts(section, block))
}

function hasSectionContent(section: AssistantSection, blocks: readonly AssistantBlock[]): boolean {
  return sectionBlocks(section, blocks).some(blockIsVisible)
}

function updateChunk(
  state: SectionState,
  chunk: StreamChunk,
  seq: number,
  time: number,
): SectionState {
  const blocks = [...state.blocks]
  let changedIndex = -1
  let previousVisible = false
  switch (chunk.type) {
    case 'block-start':
      changedIndex = chunk.index
      previousVisible = blockIsVisible(blocks[chunk.index])
      blocks[chunk.index] = emptyAssistantBlock(chunk.blockType)
      break
    case 'text-delta': {
      const previous = blocks[chunk.index]
      changedIndex = chunk.index
      previousVisible = blockIsVisible(previous)
      blocks[chunk.index] = { kind: 'text', text: (previous?.kind === 'text' ? previous.text : '') + chunk.text }
      break
    }
    case 'reasoning-delta': {
      const previous = blocks[chunk.index]
      changedIndex = chunk.index
      previousVisible = blockIsVisible(previous)
      blocks[chunk.index] = {
        kind: 'reasoning',
        text: (previous?.kind === 'reasoning' ? previous.text : '') + chunk.text,
      }
      break
    }
    case 'tool-call-delta': {
      const previous = blocks[chunk.index]
      changedIndex = chunk.index
      previousVisible = blockIsVisible(previous)
      const base = previous?.kind === 'tool-call'
        ? previous
        : { kind: 'tool-call' as const, callId: '', name: '', argsRaw: '' }
      blocks[chunk.index] = {
        kind: 'tool-call',
        callId: base.callId || String(chunk.id),
        name: chunk.name ?? base.name,
        argsRaw: base.argsRaw + chunk.argumentsDelta,
      }
      break
    }
    case 'block-end':
      changedIndex = chunk.index
      previousVisible = blockIsVisible(blocks[chunk.index])
      blocks[chunk.index] = toAssistantBlock(chunk.block)
      break
    case 'usage':
      return { ...state, usage: chunk.usage }
    default:
      return state
  }
  const visibleBlocks = state.visibleBlocks
    - Number(previousVisible)
    + Number(blockIsVisible(blocks[changedIndex]))
  return {
    ...state,
    blocks,
    visibleBlocks,
    ...visibleBlocks > 0 && state.firstVisibleSeq === undefined
      ? { firstVisibleSeq: seq, firstVisibleTime: time }
      : {},
    ...isTokenDelta(chunk) && state.firstTokenTime === undefined
      ? { firstTokenTime: time }
      : {},
  }
}

function settleMessage(
  state: SectionState,
  match: ConversationMatch,
  event: SessionEvent<'assistant/message'>,
): SectionState {
  const blocks = toAssistantBlocks(event.data.message.content)
  return {
    ...state,
    blocks,
    visibleBlocks: countVisibleBlocks(blocks),
    final: match,
    usage: event.data.usage,
  }
}

function settledNode(
  state: SectionState,
  context: ConversationNodeContext<SectionState>,
): AssistantMessageNode | undefined {
  const final = state.final
  if (final?.event.type !== 'assistant/message') return undefined
  const event = final.event
  return {
    kind: 'assistant',
    seq: event.seq,
    messageId: event.data.message.id,
    time: event.time,
    turn: state.turn,
    step: state.step,
    blocks: toAssistantBlocks(event.data.message.content),
    usage: event.data.usage,
    timing: {
      stepStartTime: context.start?.event.time ?? null,
      firstTokenTime: state.firstTokenTime ?? null,
      completedTime: event.time,
    },
    ...event.data.interrupted === true ? { interrupted: true } : {},
  }
}

function sectionData(
  state: SectionState,
  section: AssistantSection,
  context: ConversationNodeContext<SectionState>,
  settled: AssistantMessageNode | undefined,
): AssistantChatData {
  const all = settled === undefined ? compactBlocks(state.blocks) : settled.blocks
  const blocks = sectionBlocks(section, all)
  const status = settled?.interrupted === true
    ? 'interrupted'
    : settled === undefined ? 'running' : 'settled'
  const time = settled?.time ?? state.firstVisibleTime ?? context.matches[0]?.event.time ?? 0
  return {
    status,
    turn: state.turn,
    step: state.step,
    blocks,
    time,
    ...state.usage === undefined ? {} : { usage: state.usage },
    ...section === 'message' && settled !== undefined ? { finalNode: settled } : {},
  }
}

/**
 * Create one Assistant section Definition owning one Node per Step.
 * @param section - blocks this Definition publishes.
 * @param kind - registered Chat renderer kind.
 * @returns the section Definition.
 */
export function createAssistantSectionDefinition(
  section: AssistantSection,
  kind: 'assistant-step-reason' | 'assistant-step-message',
): ConversationNodeDefinition<SectionState> {
  return {
    kind,
    target: 'chat',
    match: (event: ConversationEvent) => {
      if (event.type === 'step/start') {
        return { id: `${event.data.turn}:${event.data.step}`, role: 'start' }
      }
      if (event.type === 'assistant/live-chunk'
        || (event.type === 'assistant/message' && event.surfaceOp === 'append')) {
        return { id: `${event.data.turn}:${event.data.step}`, role: 'update' }
      }
      return null
    },
    start: (_context, match) => {
      if (match.event.type !== 'step/start') throw new Error(`${kind} start requires step/start`)
      return initialState(match.event.data.turn, match.event.data.step)
    },
    update: (context, match) => {
      if (match.event.type === 'assistant/live-chunk') {
        return updateChunk(context.state, match.event.data.chunk, match.event.seq, match.event.time)
      }
      if (match.event.type === 'assistant/message') {
        return settleMessage(context.state, match, match.event)
      }
      return context.state
    },
    publication: match => match.event.type === 'assistant/live-chunk'
      ? (match.event.data.chunk.type === 'usage' || match.event.data.chunk.type === 'finish'
        ? 'none'
        : 'animation-frame')
      : 'immediate',
    buildLocationData: (context, scope) => {
      if (scope !== 'step' || section !== 'message') return null
      const state = context.state
      if (state === undefined) return null
      const settled = settledNode(state, context)
      if (settled === undefined) return null
      return {
        kind: 'step',
        turn: state.turn,
        step: state.step,
        key: 'assistant-step-message',
        value: sectionData(state, section, context, settled),
      }
    },
    buildViewNode: (context) => {
      const state = context.state
      if (state === undefined) return null
      const settled = settledNode(state, context)
      const visible = settled === undefined
        ? hasSectionContent(section, compactBlocks(state.blocks))
        : hasSectionContent(section, settled.blocks)
      if (!visible) return null
      const anchorSeq = settled?.seq ?? state.firstVisibleSeq ?? context.matches[0]?.event.seq ?? 0
      return chatNode(context, kind, anchorSeq, sectionData(state, section, context, settled))
    },
  }
}

/** Reasoning section of one Assistant Step. */
export const assistantReasonSection = createAssistantSectionDefinition('reasoning', 'assistant-step-reason')

/** Message section of one Assistant Step; the span's default visible member. */
export const assistantMessageSection = createAssistantSectionDefinition('message', 'assistant-step-message')

function boundaryDefinition(
  kind: 'assistant-step-start' | 'assistant-step-end',
  owner: 'step/start' | 'step/end',
): ConversationNodeDefinition<BoundaryState> {
  return {
    kind,
    target: 'chat',
    match: (event: ConversationEvent) => {
      if (event.type === owner) return { id: `${event.data.turn}:${event.data.step}`, role: 'start' }
      // The opener closes on the closer's event; the closer starts on it.
      if (owner === 'step/start' && event.type === 'step/end') {
        return { id: `${event.data.turn}:${event.data.step}`, role: 'update' }
      }
      return null
    },
    start: (_context, match) => {
      if (match.event.type !== owner) throw new Error(`${kind} start requires ${owner}`)
      return {
        turn: match.event.data.turn,
        step: match.event.data.step,
        closed: owner === 'step/end',
      }
    },
    update: (context, match) => match.event.type === 'step/end'
      ? { ...context.state, closed: true }
      : context.state,
    buildViewNode: (context) => {
      const state = context.state
      if (state === undefined) return null
      const start = context.start
      if (start === undefined) return null
      const data: AssistantStepBoundaryChatData = {
        turn: state.turn,
        step: state.step,
        status: state.closed ? 'closed' : 'running',
        time: start.event.time,
      }
      return chatNode(context, kind, start.event.seq, data)
    },
  }
}

/** Span opener: the Step row that hosts the folded-section disclosure. */
export const assistantStepStart = boundaryDefinition('assistant-step-start', 'step/start')

/** Span closer: the Step's durable end boundary row. */
export const assistantStepEnd = boundaryDefinition('assistant-step-end', 'step/end')

/**
 * Register the per-Step Assistant span Definitions.
 * @param ctx - owning UI Conversation context.
 */
export function registerAssistantSpanNodes(ctx: Context): void {
  ctx.uiConversation.events.register(assistantStepStart)
  ctx.uiConversation.events.register(assistantReasonSection)
  ctx.uiConversation.events.register(assistantMessageSection)
  ctx.uiConversation.events.register(assistantStepEnd)
}
