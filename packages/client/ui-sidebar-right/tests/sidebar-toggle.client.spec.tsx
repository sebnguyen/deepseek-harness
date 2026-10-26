// @vitest-environment jsdom
/**
 * The header's sidebar toggle: it exists in both states, opens a collapsed
 * panel, closes an open one, and always reads as the action it performs.
 */
import { describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SidebarToggle } from '../src/client/shell/SidebarToggle.tsx'
import type { SidebarToggleProps } from '../src/client/shell/SidebarToggle.tsx'
import { createSidebarRightStore } from '../src/client/stores.ts'

const SESSION = 's-test' as SessionId

/** Test-local selector hook over a framework-neutral store instance. */
function hookOf<T>(inst: { subscribe: (fn: () => void) => () => void; getSnapshot: () => T }) {
  return function useSelector<S>(sel: (s: T) => S): S {
    return sel(useSyncExternalStore(inst.subscribe, inst.getSnapshot))
  }
}

/**
 * Mount the toggle over a real store instance. It reads four of its props; the
 * rest of the standard kit is framework-injected and never touched here, so one
 * documented cast keeps the harness to what is actually exercised.
 */
function mountToggle() {
  const instance = createSidebarRightStore(() => ({ kind: 'guide', title: 'Start' })).create()
  const props = {
    sessionId: SESSION,
    useStore: hookOf(instance),
    actions: instance.actions,
    // Copy is the dictionary's contract; the key stands in for the translation.
    t: (key: string) => key,
  } as unknown as SidebarToggleProps
  const view = render(<SidebarToggle {...props} />)
  const control = (): HTMLElement | null => view.container.querySelector('[data-sidebar-right-header-toggle]')
  return { instance, view, control }
}

describe('SidebarToggle', () => {
  it('offers the way in while the session has no surface yet, and asks the panel to expand', () => {
    const { instance, control } = mountToggle()
    const button = control()
    if (button === null) throw new Error('expected the header toggle')
    expect(button.getAttribute('aria-label')).toBe('chrome.expandAria')
    fireEvent.click(button)
    expect(instance.getSnapshot().bySession[SESSION]?.layout.expanded).toBe(true)
    // The same control stays in the header, now reading as the close action.
    expect(control()?.getAttribute('aria-label')).toBe('chrome.collapseAria')
    cleanup()
  })

  it('closes the panel when clicked while it is open', () => {
    const { instance, control } = mountToggle()
    act(() => { instance.actions.setExpanded(SESSION, true) })
    const button = control()
    if (button === null) throw new Error('expected the header toggle')
    expect(button.getAttribute('aria-label')).toBe('chrome.collapseAria')
    fireEvent.click(button)
    expect(instance.getSnapshot().bySession[SESSION]?.layout.expanded).toBe(false)
    expect(control()?.getAttribute('aria-label')).toBe('chrome.expandAria')
    cleanup()
  })
})
