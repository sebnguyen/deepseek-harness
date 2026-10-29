/** The generic host: ask for a mode once, then render the pinned keyed entry. */
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { LayoutModeHostInjected } from './contract.ts'
import type { LayoutModeKey } from './locales.ts'
import css from './ModeHost.module.css'

type ModeHostProps =
  & PropsRuntime<'layout.mode'>
  & PropsRenderSlots<'layout.mode.entry' | 'layout.mode.option'>
  & InjectFace<LayoutModeHostInjected>
  & PropsLocale<'layout-mode'>

/** Render the chooser before a mode is pinned, then the active keyed entry. */
export function ModeHost({
  mode, phase, renderConversation, renderSidebar, choose, renderSlot, t,
}: ModeHostProps) {
  if (phase === 'choosing') {
    return (
      <div className={css.root} data-layout-mode-chooser>
        <div className={css.intro}>
          <span className={css.eyebrow}>{t('choose.eyebrow')}</span>
          <h1 className={css.title}>{t('choose.title')}</h1>
          <p className={css.body}>{t('choose.body')}</p>
        </div>
        <div className={css.options} role="list">
          {renderSlot('layout.mode.option', { choose })}
        </div>
      </div>
    )
  }
  return <>{renderSlot('layout.mode.entry', { renderConversation, renderSidebar }, { entryKey: mode })}</>
}

export type { LayoutModeKey }
