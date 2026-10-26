// @vitest-environment jsdom
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type {
  SidebarFooterActionOwnerProps, SidebarRootComponentProps, SidebarSectionOwnerProps,
  SidebarSettingsOwnerProps,
} from '../src/client/contract/slots.ts'
import { SidebarRoot } from '../src/client/SidebarRoot.tsx'
import { en } from '../src/client/locales.ts'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

// English-dictionary translate stub: the shell renders the same copy the
// assertions below query by accessible name.
const t: SidebarRootComponentProps['t'] = key =>
  (en as Record<string, string>)[key] ?? (commonEn as Record<string, string>)[key] ?? key

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

// The shell never reads the global hooks itself, but they ride the standard
// props share; stub them as never-called functions.
const neverHook = (() => { throw new Error('shell must not read global hooks') }) as never
type AttentionSnapshot = Parameters<Parameters<SidebarRootComponentProps['useSessionPendingInteraction']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionPendingInteraction: SidebarRootComponentProps['useSessionPendingInteraction'] = selector => selector(noAttention)

function mountShell({ collapsed = false, width = 300 }: { collapsed?: boolean; width?: number } = {}) {
  const startSession = vi.fn()
  const toggleSidebar = vi.fn()
  let regionOwner: SidebarSectionOwnerProps | undefined
  let settingsOwner: SidebarSettingsOwnerProps | undefined
  let footerActionOwner: SidebarFooterActionOwnerProps | undefined
  const brandMark = <span data-testid="custom-brand-mark">M</span>
  const brandName = <span data-testid="custom-brand-name">Custom Brand</span>
  let current = { collapsed, width }
  const root = () => (
    <SidebarRoot
      collapsed={current.collapsed} width={current.width}
      useSessions={neverHook} useSessionPendingInteraction={useSessionPendingInteraction}
      usePanelInfo={usePanelInfo} selectPanel={() => {}} usePanels={selector => selector([])}
      useResource={useResource} useWorkspaces={neverHook}
      startSession={startSession} toggleSidebar={toggleSidebar} t={t}
      renderSlot={((
        key: string,
        owner: SidebarFooterActionOwnerProps | SidebarSectionOwnerProps | SidebarSettingsOwnerProps,
      ) => {
        if (key === 'sidebar.brand.mark') return brandMark
        if (key === 'sidebar.brand.name') return brandName
        if (key === 'sidebar.settings') {
          settingsOwner = owner
          return <div data-testid="settings-seat" data-wide={owner.wide} />
        }
        if (key === 'sidebar.footer.action') {
          footerActionOwner = owner
          return <div data-testid="footer-action-seat" data-wide={owner.wide} />
        }
        if (key === 'sidebar.guide') {
          return <div data-testid="guide-seat" data-wide={owner.wide} />
        }
        regionOwner = owner as SidebarSectionOwnerProps
        return <div data-testid="region" data-wide={owner.wide} />
      }) as SidebarRootComponentProps['renderSlot']}
    />
  )
  const view = render(root())
  return {
    container: view.container,
    unmount: view.unmount,
    startSession,
    toggleSidebar,
    regionOwner: () => {
      if (regionOwner === undefined) throw new Error('region owner not rendered')
      return regionOwner
    },
    settingsOwner: () => {
      if (settingsOwner === undefined) throw new Error('settings owner not rendered')
      return settingsOwner
    },
    footerActionOwner: () => {
      if (footerActionOwner === undefined) throw new Error('footer action owner not rendered')
      return footerActionOwner
    },
    rerender(next: Partial<typeof current>) {
      current = { ...current, ...next }
      view.rerender(root())
    },
  }
}

type SlideStub = {
  playState: AnimationPlayState
  cancel: ReturnType<typeof vi.fn>
}

/** One fake WAAPI animation the width slide can hold on to. */
function slideStub(playState: AnimationPlayState = 'running'): SlideStub {
  return { playState, cancel: vi.fn() }
}

describe('SidebarRoot shell', () => {
  it('routes New Session (capsule + wordmark)', () => {
    const b = mountShell()
    expect(screen.getByTestId('custom-brand-mark')).toBeTruthy()
    expect(screen.getByTestId('custom-brand-name')).toBeTruthy()
    // Expanded, both the wordmark and the capsule start a session.
    const starters = screen.getAllByRole('button', { name: 'New session' })
    expect(starters).toHaveLength(2)
    for (const button of starters) fireEvent.click(button)
    expect(b.startSession).toHaveBeenCalledTimes(2)
  })

  it('renders generic brand fallbacks when no package fills the slots', () => {
    vi.stubEnv('DSH_CLIENT_COMMIT_HASH', '0123456')
    vi.stubEnv('DSH_CLIENT_GIT_DIRTY', 'true')
    vi.stubEnv('DSH_CLIENT_VERSION', '1.2.3-rc.4')
    const { container } = render(<SidebarRoot
      collapsed={false} width={300}
      useSessions={neverHook} useSessionPendingInteraction={useSessionPendingInteraction}
      usePanelInfo={usePanelInfo} selectPanel={() => {}} usePanels={selector => selector([])}
      useResource={useResource} useWorkspaces={neverHook}
      startSession={vi.fn()} toggleSidebar={vi.fn()} t={t}
      renderSlot={((_key: string, _owner: unknown, options?: { fallback?: ReactNode }) =>
        options?.fallback ?? null) as SidebarRootComponentProps['renderSlot']}
    />)

    expect(screen.getByText('DigitalOcean Harness')).toBeTruthy()
    expect(screen.getByText('1.2.3-rc.4-0123456-dirty')).toBeTruthy()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it.each([
    [{ DSH_CLIENT_VERSION: '1.2.3' }, '1.2.3'],
    [{ DSH_CLIENT_COMMIT_HASH: 'abcdef0', DSH_CLIENT_VERSION: '1.2.3' }, '1.2.3-abcdef0'],
  ])('omits unavailable build-version suffixes from %j', (environment, expected) => {
    for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value)
    render(<SidebarRoot
      collapsed={false} width={300}
      useSessions={neverHook} useSessionPendingInteraction={useSessionPendingInteraction}
      usePanelInfo={usePanelInfo} selectPanel={() => {}} usePanels={selector => selector([])}
      useResource={useResource} useWorkspaces={neverHook}
      startSession={vi.fn()} toggleSidebar={vi.fn()} t={t}
      renderSlot={((_key: string, _owner: unknown, options?: { fallback?: ReactNode }) =>
        options?.fallback ?? null) as SidebarRootComponentProps['renderSlot']}
    />)

    expect(screen.getByText('DigitalOcean Harness')).toBeTruthy()
    expect(screen.getByText(expected)).toBeTruthy()
  })

  it('retains the local-build fallback without complete build metadata', () => {
    render(<SidebarRoot
      collapsed={false} width={300}
      useSessions={neverHook} useSessionPendingInteraction={useSessionPendingInteraction}
      usePanelInfo={usePanelInfo} selectPanel={() => {}} usePanels={selector => selector([])}
      useResource={useResource} useWorkspaces={neverHook}
      startSession={vi.fn()} toggleSidebar={vi.fn()} t={t}
      renderSlot={((_key: string, _owner: unknown, options?: { fallback?: ReactNode }) =>
        options?.fallback ?? null) as SidebarRootComponentProps['renderSlot']}
    />)

    expect(screen.getByText('DigitalOcean Harness')).toBeTruthy()
  })

  it('hands the region its wide flag and clamps expandSidebar to the collapsed state', () => {
    const b = mountShell()
    expect(b.regionOwner().wide).toBe(true)
    // The settings seat rides the same wide flag (ui-settings renders the row).
    expect(b.settingsOwner().wide).toBe(true)
    expect(b.footerActionOwner().wide).toBe(true)
    // Expanded: the request is a no-op (no accidental collapse).
    b.regionOwner().expandSidebar()
    expect(b.toggleSidebar).not.toHaveBeenCalled()
  })

  it('keeps the region mounted through collapse and expands on its request', () => {
    vi.useFakeTimers()
    const b = mountShell()
    b.rerender({ collapsed: true })
    // Wide content survives the crossfade window, then settles into the rail.
    expect(b.regionOwner().wide).toBe(true)
    vi.advanceTimersByTime(200)
    b.rerender({})
    expect(b.regionOwner().wide).toBe(false)
    expect(b.footerActionOwner().wide).toBe(false)
    expect(screen.getByTestId('region')).toBeTruthy()
    b.regionOwner().expandSidebar()
    expect(b.toggleSidebar).toHaveBeenCalledOnce()
  })
})

describe('SidebarRoot width slide', () => {
  const restoreAnimate: (() => void)[] = []

  afterEach(() => {
    while (restoreAnimate.length > 0) restoreAnimate.pop()?.()
    vi.unstubAllGlobals()
  })

  /** Install a WAAPI stub on the jsdom Element prototype; jsdom has none. */
  function installAnimate(next: () => SlideStub): ReturnType<typeof vi.fn> {
    const animate = vi.fn(() => next() as unknown as Animation)
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'animate')
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      writable: true,
      value: animate,
    })
    restoreAnimate.push(() => {
      if (descriptor === undefined) delete (Element.prototype as { animate?: unknown }).animate
      else Object.defineProperty(Element.prototype, 'animate', descriptor)
    })
    return animate
  }

  it('slides the rail open and shut on the ease-in-out curve', () => {
    const slide = slideStub()
    const animate = installAnimate(() => slide)
    const shell = mountShell({ collapsed: true, width: 56 })

    // A cold mount renders the rail statically: nothing slides on first paint.
    expect(animate).not.toHaveBeenCalled()

    shell.rerender({ collapsed: false, width: 300 })
    expect(animate).toHaveBeenCalledWith(
      [{ width: '56px' }, { width: '300px' }],
      { duration: 300, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
    )

    slide.playState = 'finished'
    shell.rerender({ collapsed: true })
    expect(animate).toHaveBeenLastCalledWith(
      [{ width: '300px' }, { width: '56px' }],
      { duration: 300, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
    )
  })

  it('swaps the fold instantly under reduced motion', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    const animate = installAnimate(() => slideStub())
    const shell = mountShell({ collapsed: true, width: 56 })

    shell.rerender({ collapsed: false, width: 300 })
    expect(animate).not.toHaveBeenCalled()
  })

  it('keeps the slide when reduced motion is off', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
    const animate = installAnimate(() => slideStub())
    const shell = mountShell({ collapsed: true, width: 56 })

    shell.rerender({ collapsed: false, width: 300 })
    expect(animate).toHaveBeenCalledOnce()
  })

  it('reverses from the rendered edge while a slide is running', () => {
    const slide = slideStub()
    const animate = installAnimate(() => slide)
    const shell = mountShell({ collapsed: false, width: 300 })

    shell.rerender({ collapsed: true })
    expect(animate).toHaveBeenCalledOnce()

    vi.spyOn(shell.container.firstElementChild as Element, 'getBoundingClientRect')
      .mockReturnValue({ width: 140 } as DOMRect)
    shell.rerender({ collapsed: false })
    expect(slide.cancel).toHaveBeenCalled()
    expect(animate).toHaveBeenLastCalledWith(
      [{ width: '140px' }, { width: '300px' }],
      { duration: 300, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
    )
  })

  it('leaves a pointer drag direct while the fold state holds', () => {
    const animate = installAnimate(() => slideStub())
    const shell = mountShell({ collapsed: false, width: 300 })

    shell.rerender({ width: 340 })
    expect(animate).not.toHaveBeenCalled()
  })

  it('does not restart a slide pinned at its hover preview width', () => {
    const slide = slideStub('finished')
    const animate = installAnimate(() => slide)
    const shell = mountShell({ collapsed: true, width: 264 })

    fireEvent.pointerEnter(shell.container.firstElementChild as Element)
    expect(animate).toHaveBeenCalledOnce()

    shell.rerender({ collapsed: false })
    expect(animate).toHaveBeenCalledOnce()
  })

  it('cancels a running slide when the shell unmounts', () => {
    const slide = slideStub()
    const animate = installAnimate(() => slide)
    const shell = mountShell({ collapsed: false, width: 300 })

    shell.rerender({ collapsed: true })
    expect(animate).toHaveBeenCalledOnce()
    shell.unmount()
    expect(slide.cancel).toHaveBeenCalled()
  })
})
