import { memo, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatNodeViewProps, TurnTailOwnerProps } from '../contract/slots.ts'
import { MessageIconActions } from './MessageIconActions.tsx'
import { TurnTimePanel, TurnUsagePanel } from './TurnUsagePanel.tsx'
import { assistantText } from './turn-assistant.ts'
import css from './TurnTailNodeView.module.css'

type TurnTailNodeViewProps = ChatNodeViewProps<'turn-tail'>
  & PropsRenderSlots<'conversation.chat.turnTail' | 'conversation.chat.assistant-actions' | 'conversation.chat.turnChips'>

/** Give up waiting for the reveal gate after this long and roll in regardless. */
const VISIBILITY_WAIT_MS = 20_000

/**
 * Resolve true once the element is actually painted. The tail mounts behind the
 * reveal gate (`visibility: hidden` while the answer is still revealing), so a
 * count-up started at mount would be a finished number by the time it is seen.
 * @param ref - The tail root.
 * @returns True once the element is visible; after the wait cap, otherwise.
 */
function useVisible(ref: RefObject<HTMLDivElement | null>): boolean {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (el === null || typeof MutationObserver !== 'function') {
      setVisible(true)
      return
    }
    const flow = el.closest('[data-chat-flow]') ?? el.parentElement ?? el
    let observer: MutationObserver | null = null
    let timer: number | undefined = undefined
    const check = (): void => {
      // One computed-style read per gate change, not one per frame: a per-frame
      // poll forces a style recalc on exactly the frames the entrance animates.
      if (getComputedStyle(el).visibility !== 'hidden') {
        setVisible(true)
        observer?.disconnect()
        if (timer !== undefined) window.clearTimeout(timer)
      }
    }
    observer = new MutationObserver(check)
    observer.observe(flow, {
      attributes: true,
      attributeFilter: ['data-revealing'],
      childList: true,
      subtree: true,
    })
    check()
    timer = window.setTimeout(() => { setVisible(true) }, VISIBILITY_WAIT_MS)
    return () => {
      observer?.disconnect()
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [ref])
  return visible
}

/** Turn-local actions and feature tail over the Location index, independent of Assistant placement. */
export const TurnTailNodeView = memo(function TurnTailNodeView({
  node, openFile, forkAt, renderSlot, renderSlotChain, t, useChat,
}: TurnTailNodeViewProps) {
  const data = node.data
  const rootRef = useRef<HTMLDivElement | null>(null)
  const visible = useVisible(rootRef)
  const hasLaterChatNode = useChat(snapshot =>
    snapshot.locations.getTurn(data.turn).at(-1) !== node.key)
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  if (turn === undefined) return null
  const closing = data.closing
  const owner: TurnTailOwnerProps = { turn, seq: closing?.finalNode.seq ?? data.seq, openFile }
  const chips = renderSlot('conversation.chat.turnChips', owner)
  const tail = renderSlotChain('conversation.chat.turnTail', owner)
  if (closing === null) return tail === null ? null : <div className={css.root}>{tail}</div>
  const runMs = turn.start === undefined || turn.end === undefined
    ? undefined
    : Math.max(0, turn.end.time - turn.start.time)
  // Interruption-frozen partials carry no messageId, so they address no
  // durable message and contribute no per-message actions.
  const messageId = closing.finalNode.messageId
  const assistantActions = messageId === undefined
    ? null
    : renderSlot('conversation.chat.assistant-actions', { messageId, turn })
  // No row head: the turn's tail is its own content — chips, footer actions,
  // and the usage/time disclosures — directly in the flow.
  return (
    <div
      ref={rootRef}
      className={css.root}
      data-turn-tail={data.turn}
    >
      {chips}
      {tail}
      <MessageIconActions
        text={assistantText(closing.blocks)}
        time={closing.time}
        clock="end"
        onBranch={() => { forkAt(closing.finalNode.seq) }}
        branchUnavailable={data.branchUnavailable || hasLaterChatNode}
        className={css.actions}
        extraActions={assistantActions}
        usageAction={(
          <>
            {data.tokenUsage !== undefined && <TurnUsagePanel usage={data.tokenUsage} t={t} active={visible} />}
            {runMs !== undefined && (
              <TurnTimePanel
                runMs={runMs}
                tokensPerSecond={data.tokensPerSecond}
                ttftMs={data.ttftMs}
                t={t}
                active={visible}
              />
            )}
          </>
        )}
        t={t}
      />
    </div>
  )
})
