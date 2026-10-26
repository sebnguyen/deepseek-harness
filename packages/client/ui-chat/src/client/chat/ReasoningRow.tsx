/** Assistant reasoning disclosure, independent of Tool-call presentation. */
import { PceRow } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import css from './ReasoningRow.module.css'

/**
 * Render one assistant reasoning block as the proposed `Think` row. The
 * collapsed head shows streaming status; the expanded body preserves the
 * complete text.
 * @param props.text - complete or streaming reasoning text.
 * @param props.running - whether this block is the streaming tail.
 * @param props.t - conversation locale seat for the status labels.
 * @returns the reasoning pce row.
 */
export function ReasoningRow({ text, running, t }: { text: string; running: boolean; t: ChatViewSlotProps['t'] }) {
  const summary = running ? t('message.think.streaming') : t('message.think.finished')
  return (
    <div className={css.root} data-variant="think" data-state={running ? 'running' : 'ok'}>
      <PceRow
        kind="reasoning"
        glyph="think"
        title={t('message.think')}
        state={running ? 'running' : 'ok'}
        stateLabel={summary}
        keepMounted
        body={<div className={css.thinkBody}>{text}</div>}
      />
    </div>
  )
}
