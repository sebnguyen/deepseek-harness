/** The launch card that pins this window to Turbo mode. */
import { ChoiceCard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SammyLogo } from './SammyLogo.tsx'

type TurboOptionProps = PropsRuntime<'layout.mode.option'> & PropsLocale<'turbo'>

/** Render the Sammy/Turbo choice card. */
export function TurboOption({ choose, t }: TurboOptionProps) {
  return (
    <ChoiceCard
      value="turbo"
      accent="#7BB4BC"
      logo={<SammyLogo size={128} />}
      title={t('option.title')}
      onSelect={() => { choose('turbo') }}
    >
      {t('option.body')}
    </ChoiceCard>
  )
}
