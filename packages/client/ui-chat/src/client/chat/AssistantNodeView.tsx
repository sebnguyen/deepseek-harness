import { memo, useMemo } from 'react'
import type { ChatNodeViewProps, TurnTailOwnerProps } from '../contract/slots.ts'
import { hasAssistantReplyContent, visibleAssistantBlocks } from '../contract/assistant-content.ts'
import { AssistantMarkdown } from './AssistantMarkdown.tsx'

/** Streaming, settled, and interrupted Assistant sections share one keyed renderer instance. */
export const AssistantNodeView = memo(function AssistantNodeView({
  node, useTurnData, openFile, renderMessageImages, fileMentions, t,
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
  // Wire-grammar leakage (`{}` shield markers, leaked `<tool_call>` spans)
  // is stripped before the visibility call — including on the turn-tail
  // owner row, which is exactly where a tool-only or quiet turn leaks them.
  const blocks = useMemo(() => visibleAssistantBlocks(data.blocks), [data.blocks])
  const visible = hasAssistantReplyContent(blocks)
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
