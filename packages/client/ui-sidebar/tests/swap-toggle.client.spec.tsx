// @vitest-environment jsdom
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { SwapToggle } from '../src/client/SwapToggle.tsx'
import type { SwapToggleProps } from '../src/client/SwapToggle.tsx'
import { en } from '../src/client/locales.ts'

const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })
// The toggle reads only its own injected hook; the rest of the standard hooks
// ride the share and stay unread.
const neverHook = (() => { throw new Error('toggle must not read global hooks') }) as never

const t: SwapToggleProps['t'] = key => (en as Record<string, string>)[key] ?? key

function mountToggle() {
  const toggleSwap = vi.fn()
  let swapped = true
  const useLayoutInfo: SwapToggleProps['useLayoutInfo'] = selector => selector({
    sidebar: 280,
    viewportWidth: 1920,
    narrowExpanded: false,
    rightbar: null,
    rightbarShown: false,
    rightbarTrack: false,
    rightbarFullscreen: false,
    rightbarInstant: false,
    swapped,
  })
  const element = () => (
    <SwapToggle
      wide
      toggleSwap={toggleSwap}
      useLayoutInfo={useLayoutInfo}
      useResource={useResource}
      useSessions={neverHook}
      useWorkspaces={neverHook}
      usePanelInfo={usePanelInfo}
      useSessionPendingInteraction={neverHook}
      t={t}
    />
  )
  const utils = render(element())
  const button = (): HTMLElement => utils.getByRole('button')
  return {
    ...utils,
    toggleSwap,
    button,
    flip: () => {
      act(() => { button().click() })
      act(() => {
        swapped = !swapped
        utils.rerender(element())
      })
    },
  }
}

afterEach(() => {
  cleanup()
})

describe('SwapToggle', () => {
  it('reports the frame order and flips to chat-first on click', () => {
    const { toggleSwap, button, flip } = mountToggle()
    expect(button().getAttribute('aria-pressed')).toBe('true')
    expect(button().getAttribute('aria-label')).toBe(en['layout.swap'])
    flip()
    expect(toggleSwap).toHaveBeenCalledOnce()
    expect(button().getAttribute('aria-pressed')).toBe('false')
    flip()
    expect(toggleSwap).toHaveBeenCalledTimes(2)
    expect(button().getAttribute('aria-pressed')).toBe('true')
  })
})
