import { memo, useCallback, useMemo } from 'react'
import { JsonBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConversationLocationDataStore, ConversationTurnDataMap } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatNodeOwnerProps, ChatViewSlotProps } from '../contract/slots.ts'
import type { ChatNode } from '../contract/chat-nodes.ts'
import type { TurnProcessGroup } from '../contract/snapshot.ts'
import { hasAssistantReplyContent } from '../contract/assistant-content.ts'
import { TURN_PROCESS_INDEPENDENT_KINDS } from '../contract/turn-process.ts'
import { storedTurnProcessEntry } from '../stores.ts'
import { useSearchableHidden } from './searchable-hidden.ts'
import { TurnProcessDisclosure } from './TurnProcessNodeView.tsx'
import css from './ChatView.module.css'

interface ChatNodeSeatProps extends ChatNodeOwnerProps {
  readonly nodeKey: string
  readonly useChatNode: ChatViewSlotProps['useChatNode']
  readonly useChatNodeProcess: ChatViewSlotProps['useChatNodeProcess']
  readonly compactTranscript: boolean
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

const NO_GROUPS: readonly TurnProcessGroup[] = []

/** Subscribe, apply Turn-process visibility, and dispatch one stable Context key. */
export const ChatNodeSeat = memo(function ChatNodeSeat({
  nodeKey, useChatNode, useChatNodeProcess, compactTranscript,
  cwd, openFile, openSkill, inspectCall, forkAt,
  loadImage, renderMessageImages, fileMentions, useStore, actions, renderSlot, t,
}: ChatNodeSeatProps) {
  const node = useChatNode(nodeKey)
  const routedNode = node as ChatNode | undefined
  const turn = turnOf(routedNode)
  const processPresentation = useChatNodeProcess(nodeKey)
  const processSpec = processPresentation?.spec
  const presentationReady = processSpec !== undefined
    && processPresentation !== undefined
    && processPresentation.turn === processSpec.turn
    && compactTranscript
  const closedReady = presentationReady
    && processSpec.answerAnchorSeq !== null
    && processPresentation.turnClosed
  // A running turn folds under one head disclosure while the work streams;
  // settlement hands over to the per-group fold below.
  const runningWindowReady = presentationReady
    && processSpec.answerAnchorSeq === null
  // A closed Turn splits its process rows at every visible Assistant reply:
  // each run collapses where it ends and the replies stay rendered between
  // the controls. The first run rides the turn-process row; every later run
  // rides the reply row that ends it.
  const groups = closedReady ? processPresentation.groups : NO_GROUPS
  const isReplyDivider = routedNode?.kind === 'assistant-step'
    && hasAssistantReplyContent(routedNode.data.blocks)
  const memberEligible = presentationReady
    && routedNode !== undefined
    && !TURN_PROCESS_INDEPENDENT_KINDS.has(routedNode.kind)
    && !isReplyDivider
    && routedNode.anchorSeq >= processSpec.processStartSeq
    && (processSpec.answerAnchorSeq === null
      || routedNode.anchorSeq < processSpec.answerAnchorSeq)
    // A live Turn's retry notices stay in the transcript while the turn
    // runs; only once the answer settles do they fold with the rest.
    && !(routedNode.kind === 'model-retry' && runningWindowReady)
  const memberGroup = closedReady && memberEligible
    ? groups.find(group => routedNode.anchorSeq >= group.start && routedNode.anchorSeq < group.boundary)
    : undefined
  const ownedGroup = closedReady && routedNode !== undefined
    ? routedNode.kind === 'turn-process'
      ? groups[0]
      : isReplyDivider
        ? groups.find(group => group.boundary === routedNode.anchorSeq && group !== groups[0])
        : undefined
    : undefined
  const processAnswer = routedNode !== undefined
    && closedReady
    && routedNode.kind === 'assistant-step'
    && routedNode.data.step === processSpec.answerStep
  // An answer whose reasoning is its only process evidence keeps it behind a
  // 已思考-style control riding the answer row, as before the group split.
  const inlineControl = processAnswer
    && processSpec.inlineReasoning
    && ownedGroup === undefined
    ? { boundary: processSpec.answerAnchorSeq, toolCalls: 0, subagents: 0 }
    : undefined
  const liveControl = runningWindowReady && routedNode?.kind === 'turn-process'
    ? { boundary: 0, toolCalls: processSpec.toolCallCount, subagents: processSpec.subagentCount }
    : undefined
  const controlGroup = ownedGroup ?? inlineControl ?? liveControl
  const foldable = closedReady
    ? groups.length > 0 || inlineControl !== undefined
    : liveControl !== undefined
  const liveMember = runningWindowReady && memberEligible
  const openBoundary = controlGroup?.boundary
    ?? memberGroup?.boundary
    ?? (liveMember ? 0 : undefined)
  const storedEntry = useStore(state => processSpec === undefined || openBoundary === undefined
    ? undefined
    : storedTurnProcessEntry(state, processSpec.turn, openBoundary))
  const processEntry = processSpec !== undefined
    && storedEntry?.answerStep === processSpec.answerStep
    ? storedEntry
    : undefined
  const processOpen = processEntry !== undefined
  const setOpen = useCallback((open: boolean) => {
    if (processSpec === undefined || openBoundary === undefined) return
    actions.setTurnProcessOpen(processSpec.turn, processSpec.answerStep, openBoundary, open)
  }, [actions, processSpec, openBoundary])
  const processMember = memberGroup !== undefined || liveMember
  const compactAnswer = processAnswer
    && groups.length > 0
    && processPresentation.compactAnswer
    && !(ownedGroup !== undefined && processOpen)
  const processHidden = processMember && !processOpen
  const revealProcess = useCallback(() => {
    if (processMember) setOpen(true)
  }, [processMember, setOpen])
  const wrapperRef = useSearchableHidden(processHidden, revealProcess)
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
      turnProcess: processSpec === undefined
        ? undefined
        : { spec: processSpec, foldable, open: processOpen, setOpen },
    }, [
    node, cwd, openFile, openSkill, inspectCall, forkAt,
    loadImage, renderMessageImages, fileMentions,
    processSpec, foldable, processOpen, setOpen,
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
      data-turn-process-member={processMember || undefined}
      data-turn-process-hidden={processHidden || undefined}
      data-turn-process-answer={compactAnswer || undefined}
    >
      {controlGroup !== undefined && processSpec !== undefined && (
        <TurnProcessDisclosure
          turn={processSpec.turn}
          toolCalls={controlGroup.toolCalls}
          subagents={controlGroup.subagents}
          open={processOpen}
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
