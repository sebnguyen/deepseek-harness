/** The launch card that pins this window to orchestration mode. */
import { ChoiceCard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { OrchestrationGlyph } from './OrchestrationGlyph.tsx'

type OrchestrationOptionProps = PropsRuntime<'layout.mode.option'> & PropsLocale<'orchestration'>

/** Render the two-session orchestration choice card. */
export function OrchestrationOption({ choose, t }: OrchestrationOptionProps) {
  return (
    <ChoiceCard
      value="orchestration"
      accent="#C99A5B"
      logo={<OrchestrationGlyph />}
      title={t('option.title')}
      onSelect={() => { choose('orchestration') }}
    >
      {t('option.body')}
    </ChoiceCard>
  )
}
