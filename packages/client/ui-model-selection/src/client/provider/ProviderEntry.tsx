/**
 * Model-provider rail entry: a sidebar-foot sibling of the Efficiency
 * entry (settings.trigger-item, order -10) that opens the provider window.
 * The shell supplies the stack site; the entry owns its button, copy,
 * and window, mirroring TokenEfficiencyEntry's split.
 */

import { useRef, useState } from 'react'
import { IconEnhanceOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ProviderWindow } from './ProviderWindow.tsx'
import type { ProviderWindowInjected } from './ProviderWindow.tsx'
import type { ProviderKey } from './locales.ts'
import css from './Provider.module.css'

/** Injected dependencies of {@link ProviderEntry}. */
export type ProviderEntryInjected = PropsRuntime<'settings.trigger-item'> & PropsLocale<'model.provider'> & {
  /** The window's faces, handed to the window when open. */
  provider: () => ProviderWindowInjected
}

/** Props delivered by the slot outlet. */
export type ProviderEntryProps = Partial<ProviderEntryInjected>

/**
 * The rail entry button; the shell supplies the stack site, the entry
 * owns its button, copy, and the window it opens. The window renders as a
 * sibling of the button, not inside it: portal clicks bubble through the
 * React tree, so a nested window would toggle the trigger on every
 * interaction inside the dialog.
 * @param props - the inject face.
 */
export function ProviderEntry({ wide, provider, t }: ProviderEntryProps) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement | null>(null)
  const close = (): void => {
    setOpen(false)
    /* v8 ignore next -- ref-null guard: close fires only while the entry is mounted, and its button holds the ref. */
    button.current?.focus()
  }
  // Same rail-entry chrome as ui-chat's TokenEfficiencyEntry; the sibling
  // lives in another package, so sharing it would couple unrelated plugins.
  /* jscpd:ignore-start */
  return (
    <>
      <button
        ref={button}
        type="button"
        className={wide ? css.entry : `${css.entry} ${css.rail}`}
        aria-label={t?.('entry.aria')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setOpen(!open) }}
      >
        <IconEnhanceOutline16 />
        {wide && <span className={css.entryLabel}>{t?.('entry.label') ?? ''}</span>}
      </button>
      {open && provider !== undefined
        ? <ProviderWindow {...provider()} onClose={close} />
        : null}
    </>
  )
  /* jscpd:ignore-end */
}

export type { ProviderKey }
