import { memo, useEffect, useMemo, useRef } from 'react'
import { JsonBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConversationLocationDataStore, ConversationTurnDataMap } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatNodeOwnerProps, ChatViewSlotProps } from '../contract/slots.ts'
import type { ChatNode } from '../contract/chat-nodes.ts'
import css from './ChatView.module.css'

interface ChatNodeSeatProps extends ChatNodeOwnerProps {
  readonly nodeKey: string
  readonly live: boolean
  /** Measured content-box heights shared with ChatView's reserved heights. */
  readonly heights: { current: Map<string, number> }
  readonly useChatNode: ChatViewSlotProps['useChatNode']
  readonly renderSlot: ChatViewSlotProps['renderSlot']
  readonly t: ChatViewSlotProps['t']
}

type RoutedChatNodeOwner = {
  [Kind in ChatNode['kind']]: ChatNodeOwnerProps & { readonly node: ChatNode<Kind> }
}[ChatNode['kind']]

function turnDataOf(node: ChatNode | undefined): ConversationLocationDataStore<ConversationTurnDataMap> | undefined {
  const location = node?.location
  return location?.kind === 'turn' || location?.kind === 'step' ? location.turn.data : undefined
}

function turnOf(node: ChatNode | undefined): number | undefined {
  const location = node?.location
  return location?.kind === 'turn' || location?.kind === 'step' ? location.turn.turn : undefined
}

export function measureContentBox(el: HTMLElement): number {
  const st = getComputedStyle(el)
  const box = el.getBoundingClientRect().height
    - (parseFloat(st.paddingTop) || 0)
    - (parseFloat(st.paddingBottom) || 0)
    - (parseFloat(st.borderTopWidth) || 0)
    - (parseFloat(st.borderBottomWidth) || 0)
  return Math.max(0, box)
}

/** Subscribe to one stable node key and dispatch it to its keyed renderer. */
export const ChatNodeSeat = memo(function ChatNodeSeat({
  nodeKey, live, heights, useChatNode, cwd, openFile, openSkill, inspectCall, revealFile, forkAt,
  loadImage, renderMessageImages, fileMentions, renderSlot, t,
}: ChatNodeSeatProps) {
  const node = useChatNode(nodeKey)
  const routedNode = node as ChatNode | undefined
  const turn = turnOf(routedNode)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  const owner = useMemo<ChatNodeOwnerProps | null>(() => node === undefined
    ? null
    : {
      cwd,
      openFile,
      openSkill,
      inspectCall,
      revealFile,
      forkAt,
      loadImage,
      renderMessageImages,
      fileMentions,
    }, [
    node, cwd, openFile, openSkill, inspectCall, revealFile, forkAt,
    loadImage, renderMessageImages, fileMentions,
  ])

  // Measure whenever the content is committed: on mount and each time the row
  // re-enters the live band. A dormant row never measures its own spacer, so
  // it cannot overwrite a good reserved height with zero.
  useEffect(() => {
    if (!live) return
    const el = wrapperRef.current
    if (el === null) return
    heights.current.set(nodeKey, measureContentBox(el))
  }, [nodeKey, heights, live])

  if (routedNode === undefined || owner === null) return null
  const turnData = turnDataOf(routedNode)
  const routedOwner = { ...owner, node: routedNode } as RoutedChatNodeOwner
  // A dormant row reserves its last measured height. An unmeasured row renders
  // no spacer, so the shell collapses exactly like a declined row instead of
  // leaving a stray row margin behind.
  const reserved = heights.current.get(nodeKey) ?? 0

  return (
    <div ref={wrapperRef} className={css.flowItem} data-chat-anchor-key={routedNode.key} data-chat-flow-key={routedNode.key} data-chat-flow-kind={routedNode.kind} data-chat-turn={turn}>
      {live ? (
        renderSlot('conversation.chat.node', routedOwner, {
          entryKey: routedNode.kind,
          hookContext: turnData,
          fallback: (
            <JsonBlock
              label={t('message.unknownSurface', { type: routedNode.kind })}
              payload={routedNode.data}
              truncatedLabel={total => t('json.truncated', { total })}
            />
          ),
        })
      ) : reserved > 0 ? (
        <div aria-hidden="true" data-chat-flow-spacer="" style={{ height: reserved }} />
      ) : null}
    </div>
  )
})
