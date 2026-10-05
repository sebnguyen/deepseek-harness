import { memo, useCallback, useMemo } from 'react'
import { JsonBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConversationLocationDataStore, ConversationTurnDataMap } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatNodeOwnerProps, ChatViewSlotProps } from '../contract/slots.ts'
import type { ChatNode } from '../contract/chat-nodes.ts'
import type { TurnProcessGroup } from '../contract/snapshot.ts'
import { hasAssistantReplyContent } from '../contract/assistant-content.ts'
import { TURN_PROCESS_INDEPENDENT_KINDS } from '../contract/turn-process.ts'
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
const NO_ENTRIES: readonly Readonly<import('../contract/store.ts').TurnProcessViewEntry>[] = []

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
  const runningWindowReady = presentationReady
    && processSpec.answerAnchorSeq === null
  // Live and settled Turns share one split: process rows collapse at every
  // visible Assistant reply, replies stay rendered between the controls, and
  // a running Turn's open run streams behind its own tail collapse. The run
  // that starts the Turn rides the turn-process row; a settled later run
  // rides the reply row that ends it; a live tail past the first reply rides
  // the reply row it began after.
  const groups = presentationReady ? processPresentation.groups : NO_GROUPS
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
  const memberGroup = memberEligible
    ? groups.find(group => routedNode.anchorSeq >= group.start
      && (group.boundary === null || routedNode.anchorSeq < group.boundary))
    : undefined
  // Every group's start lands on a row that never folds itself: the Turn
  // control for the run that opens the window, the reply ending the previous
  // run for every later one. The control sits in the visible column just
  // above its rows and expands downward.
  const ownedGroups = routedNode === undefined || processSpec === undefined
    ? NO_GROUPS
    : groups.filter(group => group.start === processSpec.processStartSeq
      ? routedNode.kind === 'turn-process'
      : group.start === routedNode.anchorSeq)
  const processAnswer = routedNode !== undefined
    && closedReady
    && routedNode.kind === 'assistant-step'
    && routedNode.data.step === processSpec.answerStep
  // A Turn whose single run owns the answer too folds from the head control;
  // the answer row then reveals that run's reasoning through the same entry.
  const revealGroup = processAnswer && processSpec.inlineReasoning
    ? groups.find(group => group.boundary === processSpec.answerAnchorSeq
      && group.start === processSpec.processStartSeq)
    : undefined
  // A reasoning-only answer keeps its single-run collapse beside the reply.
  const inlineControl = processAnswer
    && processSpec.inlineReasoning
    && ownedGroups.length === 0
    ? {
      start: processSpec.processStartSeq, boundary: processSpec.answerAnchorSeq,
      members: 0, toolCalls: 0, subagents: 0,
    }
    : undefined
  const inlineStart = inlineControl !== undefined ? inlineControl.start : revealGroup?.start
  const foldable = groups.length > 0 || inlineControl !== undefined
  const openStarts = [
    ...ownedGroups.map(group => group.start),
    memberGroup === undefined ? -1 : memberGroup.start,
    inlineStart ?? -1,
  ].filter(start => start >= 0)
  const storedEntries = useStore((state) => {
    if (processSpec === undefined || openStarts.length === 0) return NO_ENTRIES
    return state.turnProcesses.filter(entry => entry.turn === processSpec.turn
      && entry.answerStep === processSpec.answerStep
      && openStarts.includes(entry.group))
  })
  const setGroupOpen = useCallback((start: number, open: boolean) => {
    if (processSpec === undefined) return
    actions.setTurnProcessOpen(processSpec.turn, processSpec.answerStep, start, open)
  }, [actions, processSpec])
  const inlineOpen = inlineStart !== undefined
    && storedEntries.some(entry => entry.group === inlineStart)
  const processMember = memberGroup !== undefined
  const memberOpen = memberGroup !== undefined
    && storedEntries.some(entry => entry.group === memberGroup.start)
  const compactAnswer = processAnswer
    && groups.length > 0
    && processPresentation.compactAnswer
    && !(ownedGroups.length > 0 && inlineOpen)
  const processHidden = processMember && !memberOpen && ownedGroups.length === 0
  const inlineSetOpen = useCallback((open: boolean) => {
    if (inlineStart !== undefined) setGroupOpen(inlineStart, open)
  }, [inlineStart, setGroupOpen])
  const revealProcess = useCallback(() => {
    if (processMember && memberGroup !== undefined) setGroupOpen(memberGroup.start, true)
  }, [processMember, memberGroup, setGroupOpen])
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
        : { spec: processSpec, foldable, open: inlineOpen, setOpen: inlineSetOpen },
    }, [
    node, cwd, openFile, openSkill, inspectCall, forkAt,
    loadImage, renderMessageImages, fileMentions,
    processSpec, foldable, inlineOpen, inlineSetOpen,
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
      {processSpec !== undefined && inlineControl !== undefined && (
        <TurnProcessDisclosure
          turn={processSpec.turn}
          toolCalls={inlineControl.toolCalls}
          subagents={inlineControl.subagents}
          running={false}
          open={inlineOpen}
          setOpen={inlineSetOpen}
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
      {processSpec !== undefined && ownedGroups.map(group => (
        <TurnProcessDisclosure
          key={group.start}
          turn={processSpec.turn}
          toolCalls={group.toolCalls}
          subagents={group.subagents}
          running={group.boundary === null}
          open={storedEntries.some(entry => entry.group === group.start)}
          setOpen={open => setGroupOpen(group.start, open)}
          t={t}
        />
      ))}
    </div>
  )
})
