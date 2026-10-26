import { memo, useMemo, useRef } from 'react'
import { JsonBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConversationLocationDataStore, ConversationTurnDataMap } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatNodeOwnerProps, ChatViewSlotProps } from '../contract/slots.ts'
import type { ChatNode } from '../contract/chat-nodes.ts'
import { useChatRowWindow } from './row-window.tsx'
import css from './ChatView.module.css'

interface ChatNodeSeatProps extends ChatNodeOwnerProps {
  readonly nodeKey: string
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

/** Subscribe to one stable node key and dispatch it to its keyed renderer. */
export const ChatNodeSeat = memo(function ChatNodeSeat({
  nodeKey, useChatNode, cwd, openFile, openSkill, inspectCall, revealFile, forkAt,
  loadImage, renderMessageImages, fileMentions, renderSlot, t,
}: ChatNodeSeatProps) {
  const node = useChatNode(nodeKey)
  const routedNode = node as ChatNode | undefined
  const turn = turnOf(routedNode)
  // Viewport-window gating: the shell and its data-chat-* identity ride the
  // scroll contract either way; content only mounts near the reader.
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const { live, dormantHeight } = useChatRowWindow(nodeKey, wrapperRef)
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
  if (routedNode === undefined || owner === null) return null
  const turnData = turnDataOf(routedNode)
  // Runtime dispatch owns the correlation: every Node's discriminant is the
  // keyed-slot entry passed alongside that same Node. TypeScript does not
  // distribute an object containing a union into a union of objects itself.
  const routedOwner = { ...owner, node: routedNode } as RoutedChatNodeOwner
  return (
    <div
      ref={wrapperRef}
      className={css.flowItem}
      data-chat-anchor-key={routedNode.key}
      data-chat-flow-key={routedNode.key}
      data-chat-flow-kind={routedNode.kind}
      data-chat-turn={turn}
      data-row-dormant={live ? undefined : ''}
    >
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
      ) : (
        // Dormant row: identity stays queryable, geometry reserved. The
        // data-row-dormant marker opts the shell out of the declined-row
        // display:none rule, and the spacer child keeps the column's adjacent
        // gap rule applying around windows the reader cannot see. Content
        // remounts with the same subscriptions and live history.
        <div aria-hidden="true" style={{ height: dormantHeight }} />
      )}
    </div>
  )
})
