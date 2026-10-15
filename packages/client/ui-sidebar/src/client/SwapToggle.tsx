/**
 * The footer layout swap: flips the frame between the IDE-first and the
 * chat-first track order. State arrives as the `useLayoutInfo` framework hook
 * ui-layout publishes at root; flipping routes through `ctx.layout.toggleSwap`
 * via this seat's inject face, so the shell owns no geometry state.
 */
import type { ReactNode } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { LayoutInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
import clsx from 'clsx'
import { IconSwapHorizontalOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './SwapToggle.module.css'

/** Registrant-private injected share: the layout action the button fires. */
export interface SwapToggleInjected {
  /** Flip the frame's track order between IDE-first and chat-first. */
  readonly toggleSwap: () => void
  /** Live layout info source; the renderer binds it as useLayoutInfo. */
  readonly hooks: { readonly layoutInfo: HostObservable<LayoutInfo> }
}

/** The toggle's composed props: the declared footer seat plus the inject face. */
export type SwapToggleProps =
  & PropsRuntime<'sidebar.footer.action'>
  & InjectFace<SwapToggleInjected>
  & PropsLocale<'sidebar'>

/** One footer button flipping the frame's track order. */
export function SwapToggle({ wide, useLayoutInfo, toggleSwap, t }: SwapToggleProps): ReactNode {
  const swapped = useLayoutInfo(info => info.swapped)
  return (
    <Tooltip label={t('layout.swap')} delayMs={500}>
      <button
        type="button"
        className={clsx(css.root, !wide && css.rail)}
        aria-pressed={swapped}
        aria-label={t('layout.swap')}
        onClick={() => { toggleSwap() }}
      >
        <IconSwapHorizontalOutline16 size={wide ? 13 : 14} />
      </button>
    </Tooltip>
  )
}
