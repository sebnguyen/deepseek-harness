import { describe, expect, it } from 'vitest'
import type {
  ConversationViewBuilder, ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionEventLikeEntry, SessionLiveEventEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import {
  assistantMessageSection, assistantReasonSection, assistantStepEnd, assistantStepStart,
} from '../src/client/conversation-nodes/assistant-sections.ts'
import type { AssistantChatData, AssistantStepBoundaryChatData } from '../src/client/contract/chat-nodes.ts'

const DEFINITIONS = [
  assistantStepStart,
  assistantReasonSection,
  assistantMessageSection,
  assistantStepEnd,
]

class TestEventDefinitions {
  entries() {
    return DEFINITIONS
  }

  fallbackEntry(): undefined {
    return undefined
  }
}

class CapturingViewBuilder implements ConversationViewBuilder<ChatConversationViewNode, readonly ChatConversationViewNode[]> {
  readonly empty: readonly ChatConversationViewNode[] = []
  private current: readonly ChatConversationViewNode[] = []

  replace(input: { readonly nodes: readonly ChatConversationViewNode[] }): readonly ChatConversationViewNode[] {
    this.current = input.nodes
    return this.current
  }

  apply(input: { readonly upserts: readonly ChatConversationViewNode[] }): readonly ChatConversationViewNode[] {
    const byKey = new Map(this.current.map(node => [node.key, node]))
    for (const node of input.upserts) byKey.set(node.key, node)
    this.current = [...byKey.values()]
    return this.current
  }
}

class CapturingView implements ConversationViewDefinition<ChatConversationViewNode, readonly ChatConversationViewNode[]> {
  readonly target = 'chat'
  readonly empty: readonly ChatConversationViewNode[] = []

  create(): ConversationViewBuilder<ChatConversationViewNode, readonly ChatConversationViewNode[]> {
    return new CapturingViewBuilder()
  }
}

function at(
  seq: number,
  type: string,
  data: unknown,
  extra: Record<string, unknown> = {},
): SessionLiveEventEntry {
  return {
    type: 'event',
    event: {
      seq,
      time: 1_700_000_000_000 + seq,
      type,
      data,
      ...extra,
    } as unknown as SessionEvent,
  }
}

function liveChunk(seq: number, turn: number, step: number, chunk: unknown): SessionLiveEventEntry {
  return at(seq, 'assistant/live-chunk', {
    attemptId: 'attempt-1',
    turn,
    step,
    chunk,
  }, { seq: seq - 0.5 })
}

function assistantMessage(
  seq: number,
  turn: number,
  step: number,
  content: readonly unknown[],
  extra: Record<string, unknown> = {},
): SessionLiveEventEntry {
  return at(seq, 'assistant/message', {
    turn,
    step,
    message: {
      id: `message-${seq}`,
      role: 'assistant',
      content,
      source: { kind: 'model', provider: 'fake', model: 'fake' },
    },
    stream: [],
    ...extra,
  }, { surfaceOp: 'append' })
}

function assembler(entries: readonly SessionEventLikeEntry[]): ConversationNodeAssembler {
  const value = new ConversationNodeAssembler(new TestEventDefinitions(), {
    entries: () => [new CapturingView()],
  })
  value.replaceWindow(entries, false)
  value.activateTarget('chat')
  return value
}

function nodes(value: ConversationNodeAssembler): readonly ChatConversationViewNode[] {
  const snapshot = value.snapshot('chat') as readonly ChatConversationViewNode[] | undefined
  if (snapshot === undefined) throw new Error('capturing view was not registered')
  return snapshot
}

function node(value: ConversationNodeAssembler, kind: string): ChatConversationViewNode | undefined {
  return nodes(value).find(candidate => candidate.kind === kind)
}

describe('assistant step span definitions', () => {
  it('publishes opener, sections, and closer for one settled step', () => {
    const value = assembler([
      at(1, 'step/start', { turn: 1, step: 1 }),
      liveChunk(2, 1, 1, { type: 'reasoning-delta', index: 0, text: 'think' }),
      liveChunk(3, 1, 1, { type: 'text-delta', index: 1, text: 'hello' }),
      assistantMessage(4, 1, 1, [
        { type: 'reasoning', text: 'think' },
        { type: 'text', text: 'hello' },
      ]),
      at(5, 'step/end', { turn: 1, step: 1 }),
    ])

    const opener = node(value, 'assistant-step-start')
    const reason = node(value, 'assistant-step-reason')
    const message = node(value, 'assistant-step-message')
    const closer = node(value, 'assistant-step-end')

    expect(opener?.anchorSeq).toBe(1)
    expect(reason?.anchorSeq).toBe(4)
    expect(message?.anchorSeq).toBe(4)
    expect(closer?.anchorSeq).toBe(5)

    expect((opener?.data as AssistantStepBoundaryChatData).status).toBe('closed')
    expect((closer?.data as AssistantStepBoundaryChatData).status).toBe('closed')

    const messageBlocks = (message?.data as AssistantChatData).blocks
    const reasonBlocks = (reason?.data as AssistantChatData).blocks
    expect(messageBlocks.map(block => block.kind)).toEqual(['text'])
    expect(reasonBlocks.map(block => block.kind)).toEqual(['reasoning'])
  })

  it('keeps the sections running until the step closes', () => {
    const value = assembler([
      at(1, 'step/start', { turn: 1, step: 1 }),
      liveChunk(2, 1, 1, { type: 'reasoning-delta', index: 0, text: 'think' }),
      assistantMessage(3, 1, 1, [{ type: 'text', text: 'hello' }]),
    ])

    expect((node(value, 'assistant-step-start')?.data as AssistantStepBoundaryChatData).status).toBe('running')
    expect(node(value, 'assistant-step-end')).toBeUndefined()
    expect((node(value, 'assistant-step-message')?.data as AssistantChatData).status).toBe('settled')
  })

  it('omits a section with no content of its kind', () => {
    const value = assembler([
      at(1, 'step/start', { turn: 1, step: 1 }),
      assistantMessage(2, 1, 1, [{ type: 'text', text: 'only text' }]),
      at(3, 'step/end', { turn: 1, step: 1 }),
    ])

    expect(node(value, 'assistant-step-message')).toBeDefined()
    expect(node(value, 'assistant-step-reason')).toBeUndefined()
  })

  it('carries the durable settlement on the message section only', () => {
    const value = assembler([
      at(1, 'step/start', { turn: 1, step: 1 }),
      assistantMessage(2, 1, 1, [{ type: 'text', text: 'answer' }, { type: 'reasoning', text: 'why' }], {
        usage: { inputTokens: 3, outputTokens: 4 },
      }),
      at(3, 'step/end', { turn: 1, step: 1 }),
    ])

    const message = node(value, 'assistant-step-message')?.data as AssistantChatData
    const reason = node(value, 'assistant-step-reason')?.data as AssistantChatData
    expect(message.finalNode?.messageId).toBe('message-2')
    expect(message.usage).toEqual({ inputTokens: 3, outputTokens: 4 })
    expect(reason.finalNode).toBeUndefined()
  })

  it('publishes the message section as the step location value', () => {
    const value = assembler([
      at(1, 'step/start', { turn: 1, step: 1 }),
      assistantMessage(2, 1, 1, [{ type: 'text', text: 'answer' }]),
      at(3, 'step/end', { turn: 1, step: 1 }),
    ])

    const message = node(value, 'assistant-step-message')
    expect(message?.location.kind).toBe('step')
  })
})
