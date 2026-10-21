import { memo, useMemo } from 'react'
import type { ChatNodeViewProps, TurnTailOwnerProps } from '../contract/slots.ts'
import { hasAssistantReplyContent, sanitizeAssistantReasoningText, visibleAssistantBlocks } from '../contract/assistant-content.ts'
import { AssistantMarkdown } from './AssistantMarkdown.tsx'

/** Streaming, settled, and interrupted Assistant sections share one keyed renderer instance. */
export const AssistantNodeView = memo(function AssistantNodeView({
  node, useTurnData, useProjection, openFile, renderMessageImages, fileMentions, t,
}: ChatNodeViewProps<'assistant-step-message' | 'assistant-step-reason'>) {
  const data = node.data
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  const tail = useTurnData('turn-tail')
  const owner = useMemo<TurnTailOwnerProps | undefined>(() => {
    if (turn?.status !== 'closed' || data.finalNode === undefined) return undefined
    if (tail?.closing?.finalNode.seq !== data.finalNode.seq) return undefined
    return { turn, seq: data.finalNode.seq, openFile }
  }, [data.finalNode, openFile, tail, turn])
  const mentions = useMemo(
    () => owner === undefined ? undefined : fileMentions(owner),
    [fileMentions, owner],
  )
  // Quiet turn shape: hide intermediate prose at render time. Reasoning is
  // NOT hidden — only intermediate assistant messages (prose answers) that
  // are neither the closing answer nor still streaming are suppressed. The
  // model may still think and narrate freely (those tokens stay in context
  // and help it reason); the transcript simply does not paint intermediate
  // prose answers.
  const turnShape = useProjection?.('turnShape' as never) as { shape?: string } | undefined
  const quiet = turnShape?.shape === 'quiet'
  if (quiet && node.kind === 'assistant-step-message') {
    const isFinal = data.finalNode !== undefined || owner !== undefined
    const isStreaming = data.status === 'running'
    if (!isFinal && !isStreaming) return null
  }
  // Wire-grammar leakage (`{}` shield markers, leaked `<tool_call>` spans)
  // is stripped before the visibility call — including on the turn-tail
  // owner row, which is exactly where a tool-only or quiet turn leaks them.
  const blocks = useMemo(() => visibleAssistantBlocks(data.blocks), [data.blocks])
  // The reasoning section carries no reply content by construction; its
  // visibility is a non-empty reasoning text, not the reply predicate.
  const visible = node.kind === 'assistant-step-reason'
    ? blocks.some(block => block.kind === 'reasoning' && sanitizeAssistantReasoningText(block.text) !== '')
    : hasAssistantReplyContent(blocks)
  if (!visible) return null
  return (
    <AssistantMarkdown
      blocks={blocks}
      streaming={data.status === 'running'}
      interrupted={data.status === 'interrupted'}
      renderMessageImages={renderMessageImages}
      mentions={mentions}
      t={t}
    />
  )
})
