import { memo } from 'react'
import type { ReactNode } from 'react'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatNodeViewProps } from '../contract/slots.ts'
import css from './TurnProcessNodeView.module.css'

/** One collapsible group's toggle button; ChatNodeSeat places it per group. */
export const TurnProcessDisclosure = memo(function TurnProcessDisclosure({
  turn, toolCalls, subagents, running, open, setOpen, t,
}: {
  turn: number
  toolCalls: number
  subagents: number
  running: boolean
  open: boolean
  setOpen(open: boolean): void
  t: PropsLocale<'chat'>['t']
}): ReactNode {
  const labels: string[] = []
  if (toolCalls > 0) {
    labels.push(t(
      toolCalls === 1
        ? 'message.turnProcess.toolCalls.one'
        : 'message.turnProcess.toolCalls.other',
      { count: toolCalls },
    ))
  }
  if (subagents > 0) {
    labels.push(t(
      subagents === 1
        ? 'message.turnProcess.subagents.one'
        : 'message.turnProcess.subagents.other',
      { count: subagents },
    ))
  }
  const label = labels.length === 0
    ? running ? t('message.turnProcess.working') : t('message.turnProcess.thoughtForAWhile')
    : labels.join(t('message.turnProcess.separator'))
  return (
    <button
      type="button"
      className={css.root}
      data-open={open || undefined}
      data-turn-process={turn}
      data-turn-process-tool-calls={toolCalls}
      data-turn-process-subagents={subagents}
      aria-expanded={open}
      onClick={(event) => {
        event.currentTarget.focus()
        setOpen(!open)
      }}
    >
      <span className={css.label}>{label}</span>
      <IconChevronDownOutline14 className={css.chevron} />
    </button>
  )
})

/**
 * The Turn-process row declines its own seat: ChatNodeSeat renders the group
 * disclosures so each collapse sits exactly where its folded run begins.
 */
export const TurnProcessNodeView = memo(function TurnProcessNodeView(
  _props: ChatNodeViewProps<'turn-process'>,
): ReactNode {
  return null
})
