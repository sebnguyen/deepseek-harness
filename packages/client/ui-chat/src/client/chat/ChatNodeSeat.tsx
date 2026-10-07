import { memo, useCallback, useMemo } from 'react'
import { JsonBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConversationLocationDataStore, ConversationTurnDataMap } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatNodeOwnerProps, ChatViewSlotProps } from '../contract/slots.ts'
import type { ChatNode } from '../contract/chat-nodes.ts'
import { FOLDABLE_MEMBER_KINDS, spanKey } from '../contract/span-fold.ts'
import { useFoldedHidden } from './fold-hidden.ts'
import { StepSpanDisclosure } from './StepSpanDisclosure.tsx'
import css from './ChatView.module.css'

interface ChatNodeSeatProps extends ChatNodeOwnerProps {
  readonly nodeKey: string
  readonly useChatNode: ChatViewSlotProps['useChatNode']
  readonly useChatNodeProcess: ChatViewSlotProps['useChatNodeProcess']
  readonly useStore: ChatViewSlotProps['useStore']
  readonly actions: ChatViewSlotProps['actions']
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

/** Subscribe, apply the Step span fold, and dispatch one stable Context key. */
export const ChatNodeSeat = memo(function ChatNodeSeat({
  nodeKey, useChatNode, useChatNodeProcess,
  cwd, openFile, openSkill, inspectCall, forkAt,
  loadImage, renderMessageImages, fileMentions, useStore, actions, renderSlot, t,
}: ChatNodeSeatProps) {
  const node = useChatNode(nodeKey)
  const routedNode = node as ChatNode | undefined
  const turn = turnOf(routedNode)
  const fold = useChatNodeProcess(nodeKey)
  const span = fold === undefined ? undefined : spanKey(fold.turn, fold.step)
  const open = useStore(state => span !== undefined && state.openSpans.includes(span))
  // The message section always stands alone; the span's opener hosts the
  // disclosure and its folded members hide while the span stays closed.
  const member = routedNode !== undefined
    && fold !== undefined
    && FOLDABLE_MEMBER_KINDS.has(routedNode.kind)
  const ownStep = routedNode?.location.kind === 'step'
    ? routedNode.location.step.step
    : undefined
  // A run folds under its first Step: only the head opener renders the
  // disclosure, later openers decline it.
  const showDisclosure = routedNode?.kind === 'assistant-step-start'
    && fold !== undefined
    && fold.step === ownStep
    && (fold.members > 0 || fold.running)
  const processMember = member && fold.members > 0
  const memberOpen = processMember && open
  const processHidden = member && !memberOpen
  // The process rail groups a span's disclosure and its folded members under
  // one left rule; only seats that carry either draw it.
  const railProcess = showDisclosure || processMember
  const revealSpan = useCallback(() => {
    if (span !== undefined) actions.setSpanOpen(span, true)
  }, [actions, span])
  const setOpen = useCallback((value: boolean) => {
    if (span !== undefined) actions.setSpanOpen(span, value)
  }, [actions, span])
  // An automatic collapse that would hide keyboard focus opens the span
  // instead and leaves focus in place.
  const keepFocusOpen = useCallback(() => {
    if (processMember && !open && span !== undefined) actions.setSpanOpen(span, true)
  }, [actions, open, processMember, span])
  const { ref: wrapperRef, shellHidden, foldOut } = useFoldedHidden(processHidden, revealSpan)
  const owner = useMemo<ChatNodeOwnerProps | null>(() => node === undefined
    ? null
    : {
      cwd,
      openFile,
      openSkill,
      inspectCall,
      forkAt,
      loadImage,
      renderMessageImages,
      fileMentions,
    }, [
    node, cwd, openFile, openSkill, inspectCall, forkAt,
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
      onFocusCapture={keepFocusOpen}
      data-rail={railProcess ? 'process' : undefined}
      data-turn-process-member={processMember || undefined}
      data-turn-process-hidden={shellHidden || undefined}
      data-fold-out={foldOut || undefined}
    >
      {showDisclosure && (
        <StepSpanDisclosure
          turn={fold.turn}
          step={fold.step}
          endStep={fold.endStep}
          toolCalls={fold.toolCalls}
          thoughts={fold.thoughts}
          subagents={fold.subagents}
          contexts={fold.contexts}
          running={fold.running}
          open={open}
          setOpen={setOpen}
          t={t}
        />
      )}
      {renderSlot('conversation.chat.node', routedOwner, {
        entryKey: routedNode.kind,
        hookContext: turnData,
        fallback: (
          <JsonBlock
            label={t('message.unknownSurface', { type: routedNode.kind })}
            payload={routedNode.data}
            truncatedLabel={total => t('json.truncated', { total })}
          />
        ),
      })}
    </div>
  )
})
