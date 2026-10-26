/** Localized head-state labels for the tool pce rows. */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolRowState } from '../models/tool-call-model.ts'

/**
 * Localized head-state label for one tool-row outcome.
 * @param state - row outcome.
 * @param t - the render site's conversation locale seat.
 * @returns the label shown beside the state mark.
 */
export function pceStateLabel(state: ToolRowState, t: TranslateNS<'conversation'>): string {
  switch (state) {
    case 'running': return t('row.running')
    case 'error': return t('row.failed')
    case 'stopped': return t('row.stopped')
    default: return t('terminal.done')
  }
}
