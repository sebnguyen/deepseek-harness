import { memo } from 'react'
import type { ReactNode } from 'react'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatNodeViewProps } from '../contract/slots.ts'
import css from './TurnProcessNodeView.module.css'

/** One Step span's fold toggle button; ChatNodeSeat places it on the span opener. */
export const StepSpanDisclosure = memo(function StepSpanDisclosure({
  turn, step, endStep, toolCalls, thoughts, subagents, contexts, running, open, setOpen, t,
}: {
  turn: number
  step: number
  endStep: number
  toolCalls: number
  thoughts: number
  subagents: number
  contexts: number
  running: boolean
  open: boolean
  setOpen: (open: boolean) => void
  t: PropsLocale<'chat'>['t']
}): ReactNode {
  // Runs that merge several Steps name their span so back-to-back disclosures
  // explain their partition; a single Step stays quiet.
  const labels: string[] = endStep > step
    ? [t('message.turnProcess.steps', { first: step, last: endStep })]
    : []
  if (contexts > 0) {
    labels.push(t(
      contexts === 1
        ? 'message.turnProcess.contexts.one'
        : 'message.turnProcess.contexts.other',
      { count: contexts },
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
  if (thoughts > 0) {
    labels.push(t(
      thoughts === 1
        ? 'message.turnProcess.thoughts.one'
        : 'message.turnProcess.thoughts.other',
      { count: thoughts },
    ))
  }
  if (toolCalls > 0) {
    labels.push(t(
      toolCalls === 1
        ? 'message.turnProcess.toolCalls.one'
        : 'message.turnProcess.toolCalls.other',
      { count: toolCalls },
    ))
  }
  const count = labels.join(t('message.turnProcess.separator'))
  const label = count === ''
    ? running ? t('message.turnProcess.working') : t('message.turnProcess.thoughtForAWhile')
    : count
  return (
    <button
      type="button"
      className={css.root}
      data-open={open || undefined}
      data-turn-process={turn}
      data-turn-process-step={step}
      data-turn-process-end-step={endStep}
      data-turn-process-tool-calls={toolCalls}
      data-turn-process-thoughts={thoughts}
      data-turn-process-subagents={subagents}
      data-turn-process-contexts={contexts}
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
 * The span boundary rows decline their own seat: the opener hosts the span
 * disclosure and the closer only delimits the fold.
 */
export const StepBoundaryView = memo(function StepBoundaryView(
  _props: ChatNodeViewProps<'assistant-step-start' | 'assistant-step-end'>,
): ReactNode {
  return null
})
