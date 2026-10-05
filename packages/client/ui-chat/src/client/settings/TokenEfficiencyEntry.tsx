// The sidebar-foot Efficiency entry above the Settings trigger: a
// feature-owned sibling button (settings.trigger-item) opening the token
// efficiency window. The entry owns its copy (chat locale) and its window's
// lifecycle; the settings shell supplies only the stack site and the
// wide/rail fact, per the settings slot contract.

import { useRef, useState } from 'react'
import { IconGaugeOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { TokenEfficiencyWindow } from './TokenEfficiencyWindow.tsx'
import css from './TokenEfficiency.module.css'

/** Props: the rail/wide owner share plus the chat locale seat. */
export type TokenEfficiencyEntryProps =
  PropsRuntime<'settings.trigger-item'> & PropsLocale<'chat'>

/**
 * The Efficiency rail entry and its window trigger.
 * @param props - slot props.
 * @returns the entry button and, while open, the window.
 */
export function TokenEfficiencyEntry({ useSessions, t, wide }: TokenEfficiencyEntryProps) {
  const [open, setOpen] = useState(false)
  const byId = useSessions(s => s.byId)
  const button = useRef<HTMLButtonElement | null>(null)
  const close = (): void => {
    setOpen(false)
    /* v8 ignore next -- ref-null guard: close fires only while the entry is mounted, and its button holds the ref. */
    button.current?.focus()
  }
  return (
    <>
      <button
        ref={button}
        type="button"
        className={wide ? css.entry : `${css.entry} ${css.rail}`}
        aria-label={t('efficiency.trigger')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setOpen(!open) }}
      >
        <IconGaugeOutline16 />
        {wide && <span className={css.entryLabel}>{t('efficiency.trigger')}</span>}
      </button>
      {open && <TokenEfficiencyWindow byId={byId} t={t} onClose={close} />}
    </>
  )
}
