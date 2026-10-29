/** The built-in default shell, presented through the same card roster as every mode. */
import { ChoiceCard, PixelMark } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

type DefaultOptionProps = PropsRuntime<'layout.mode.option'> & PropsLocale<'layout-mode'>

/** Render the DigitalOcean full-shell card. */
export function DefaultOption({ choose, t }: DefaultOptionProps) {
  return (
    <ChoiceCard
      value="default"
      accent="#7BB4BC"
      logo={<PixelMark size={144} />}
      title={t('choose.default')}
      onSelect={() => { choose('default') }}
    >
      {t('choose.default.body')}
    </ChoiceCard>
  )
}
