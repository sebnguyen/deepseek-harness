/**
 * Sidebar shell: column geometry and global panel navigation.
 * The floating panel slides between the 56px rail and its expanded width on
 * the theme's slow ease-in-out curve (Web Animations API below). At settle
 * the wide-only content unmounts and the upper controls enter the 56px rail
 * from the same horizontal offset (one icon each, same top-down order) on one
 * fade that ends with the slide. The floor only fades. The workspace/session
 * browsing region between global panel rows and the foot is the
 * `sidebar.workspaces` registrant's, and the foot is one icon row holding
 * `sidebar.guide`, `sidebar.settings`, and the additive
 * `sidebar.footer.action`; the shell hands them the wide flag (plus an expand
 * request callback for the browser).
 *
 * The column also owns whether the scroll regions nested in it draw a
 * scrollbar at all: the shell tracks the pointer and rebinds ui-theme's
 * scrollbar indirection away while it is elsewhere, so a list the user is not
 * pointing at carries no bar.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  IconNewChatOutline16, PixelMark, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  SidebarPanelMetadata, SidebarRootComponentProps, SidebarRootInjected, SidebarSectionOwnerProps,
} from './contract/slots.ts'
import css from './SidebarRoot.module.css'

/**
 * How long the column's scrollbars stay drawn after the pointer leaves it.
 * The bar is a pointer affordance here, and hiding it on the leave event
 * itself makes it blink out while the pointer is only crossing the column's
 * edge — on the way to the conversation, or around a portalled menu.
 */
const SCROLLBAR_LINGER_MS = 2000

/** Format complete-build metadata for the local brand badge. */
function localBuildVersion(): string | undefined {
  const version = process.env.DSH_CLIENT_VERSION
  if (version === undefined) return undefined
  const commit = process.env.DSH_CLIENT_COMMIT_HASH
  return version
    + (commit === undefined ? '' : `-${commit}`)
    + (process.env.DSH_CLIENT_GIT_DIRTY === 'true' ? '-dirty' : '')
}

type PanelRowProps =
  Pick<SidebarPanelMetadata, 'id' | 'label'>
  & Pick<SidebarSectionOwnerProps, 'wide'>
  & Pick<PropsRuntime<'sidebar'>, 'usePanelInfo'>
  & Pick<InjectFace<SidebarRootInjected>, 'selectPanel'>
  & PropsRenderSlots<'sidebar.panellist'>

/** Each panel row subscribes only to its own selection state. */
function PanelRow({ id, label, wide, usePanelInfo, selectPanel, renderSlot }: PanelRowProps) {
  const active = usePanelInfo(info => info.activePanelId === id)
  return (
    <Tooltip label={label} delayMs={500} disabled={wide}>
      <button
        type="button"
        className={clsx(css.panelRow, active && css.panelActive)}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        onClick={() => { selectPanel(id) }}
      >
        <span className={css.panelGlyph} aria-hidden="true">
          {renderSlot('sidebar.panellist', { size: wide ? 16 : 18, active }, { only: id })}
        </span>
        {wide && (
          <span className={clsx(css.panelTitle, css.wide)}>
            {label}
          </span>
        )}
      </button>
    </Tooltip>
  )
}

/** The collapsed rail's width; mirrors SIDEBAR_COLLAPSED in ui-layout's columns. */
const RAIL_WIDTH = 56

/** Wide-content unmount delay; matches the 150ms wide-content fade-out. */
const COLLAPSE_SETTLE_MS = 150

/** The rail ↔ panel width slide; mirrors --ds-transition-duration-slow in ui-theme's base.css. */
const WIDTH_SLIDE_MS = 300

/** The slide's curve; mirrors --ds-ease-in-out in ui-theme's base.css. */
const WIDTH_SLIDE_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)'

/**
 * Render the sidebar column shell.
 * @param props - composed slot props (runtime share + injected callbacks, contract/slots.ts).
 * @returns the sidebar element tree.
 */
export function SidebarRoot({
  collapsed,
  width,
  startSession,
  toggleSidebar,
  selectPanel,
  usePanels,
  usePanelInfo,
  t,
  renderSlot,
}: SidebarRootComponentProps) {
  const panels = usePanels(snapshot => snapshot)
  const [hovered, setHovered] = useState(false)
  // Wide content stays mounted while the collapse animates (fading via
  // .collapsed .wide), unmounts at settle, and remounts right away on expand.
  // Hover (hovered) forces the wide layout so a collapsed rail opens on hover.
  const [settled, setSettled] = useState(collapsed)
  useEffect(() => {
    if (!collapsed) { setSettled(false); return }
    if (hovered) { setSettled(false); return }
    const timer = window.setTimeout(() => { setSettled(true) }, COLLAPSE_SETTLE_MS)
    return () => { window.clearTimeout(timer) }
  }, [collapsed, hovered])
  /* Hover: a collapsed panel opens while the pointer or focus is inside it and
     closes when both leave, without touching the stored preference. */
  const open = !collapsed || hovered
  const wide = open || (collapsed && !settled)

  // Freeze the content at its expanded width while it fades out (collapsed
  // && wide): the sliding column then clips it instead of reflowing it. The
  // rail layout (.collapsed styles) only applies once the fade settles.
  const lastWideWidth = useRef(Math.max(width, 264))
  if (!collapsed) lastWideWidth.current = width
  /* An open panel may never be narrower than the sidebar minimum: a stored or
     conceded width below it renders the wide layout squeezed into a strip,
     which reads as a broken, misaligned sidebar. */
  const openWidth = Math.max(collapsed ? lastWideWidth.current : width, 264)


  // Rail-in only crossfades a live collapse: a refresh straight into the
  // collapsed state renders the rail statically (no delay-hidden icons).
  const everWide = useRef(!collapsed)
  if (!collapsed) everWide.current = true

  // Scrollbars in the column follow the pointer (.quietBars rebinds them
  // away): drawn while it is inside, and for SCROLLBAR_LINGER_MS after it
  // leaves. A pointer that returns within that window cancels the pending
  // hide rather than restarting from a hidden bar.
  const column = useRef<HTMLDivElement>(null)
  const [pointerInside, setPointerInside] = useState(false)
  const lingerTimer = useRef<number | undefined>(undefined)
  const armLinger = (): void => {
    if (lingerTimer.current !== undefined) return
    lingerTimer.current = window.setTimeout(() => {
      lingerTimer.current = undefined
      setPointerInside(false)
    }, SCROLLBAR_LINGER_MS)
  }
  const cancelLinger = (): void => {
    window.clearTimeout(lingerTimer.current)
    lingerTimer.current = undefined
  }
  // Leaving is decided by the column's BOX, not by DOM containment, and only
  // while the bars are drawn. ui-settings renders its full-viewport panel as a
  // fixed-position DESCENDANT of this column, so a pointer moved onto that
  // panel — or onto the conversation once it closes — fires no `pointerleave`
  // here, and the bars would stay drawn over a column nobody is pointing at.
  // The element's own leave stays as the one signal geometry cannot give: a
  // pointer that leaves the window emits no further moves.
  useEffect(() => {
    if (!pointerInside) return
    const onMove = (event: PointerEvent): void => {
      const rect = column.current?.getBoundingClientRect()
      /* v8 ignore next -- the listener only exists while the column is mounted and revealed. */
      if (rect === undefined) return
      const inside = event.clientX >= rect.left && event.clientX < rect.right
        && event.clientY >= rect.top && event.clientY < rect.bottom
      if (inside) cancelLinger()
      else armLinger()
    }
    document.addEventListener('pointermove', onMove)
    return () => {
      document.removeEventListener('pointermove', onMove)
      cancelLinger()
    }
  }, [pointerInside])

  // The fold's width slide. The panel floats over the centre, so its inline
  // width is the whole animation: React keeps the style at the target and the
  // WAAPI animation overrides it while playing, which hands the edge back
  // without a jump. Pointer drags change the width with the fold state held;
  // easing those would detach the edge from the handle.
  const shownWidth = useRef(open ? openWidth : RAIL_WIDTH)
  const previousFold = useRef({ open, collapsed })
  const widthSlide = useRef<Animation | null>(null)
  useLayoutEffect(() => {
    const element = column.current
    /* v8 ignore next -- the root div renders unconditionally, so the ref is attached by effect time. */
    if (element === null) return
    const target = open ? openWidth : RAIL_WIDTH
    const from = shownWidth.current
    shownWidth.current = target
    const previous = previousFold.current
    previousFold.current = { open, collapsed }
    const running = widthSlide.current
    widthSlide.current = null
    const start = running !== null && running.playState === 'running'
      ? element.getBoundingClientRect().width
      : from
    running?.cancel()
    if (previous.open === open && previous.collapsed === collapsed) return
    if (start === target || typeof element.animate !== 'function') return
    if (typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    widthSlide.current = element.animate(
      [{ width: `${start}px` }, { width: `${target}px` }],
      { duration: WIDTH_SLIDE_MS, easing: WIDTH_SLIDE_EASING },
    )
  }, [open, collapsed, openWidth])
  useEffect(() => () => { widthSlide.current?.cancel() }, [])

  const buildVersion = localBuildVersion()

  /* The panel leaves the frame's slot tree: a slot anchor is a grid item, and
     nothing inside the frame's isolated stacking context can outrank the
     shell's own body-level portals. Portaling to the body is what makes it a
     max-z overlay rather than a cell in the layout. */
  return (
    <div
      ref={column}
      className={clsx(
        css.root, !wide && css.collapsed, !wide && everWide.current && css.railIn,
        collapsed && wide && !hovered && css.fading, !pointerInside && css.quietBars,
      )}
      data-dsh-sidebar=""
      data-sidebar-collapsed={!wide || undefined}
      style={{ width: open ? openWidth : RAIL_WIDTH }}
      data-collapsed={open ? undefined : true}
      onPointerEnter={() => {
        cancelLinger()
        setPointerInside(true)
        setHovered(true)
      }}
      onPointerLeave={(event) => {
        armLinger()
        // Focus inside (a keyboard user in the panel) holds it open.
        if (!event.currentTarget.contains(document.activeElement)) setHovered(false)
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHovered(false)
      }}
    >
      {/* body of the panel */}
      <div className={css.logoRow}>
        {wide ? (
          <>
            {/* Expanded, the brand doubles as a New Session shortcut; the
                collapsed rail's logo is the expand toggle below instead. */}
            <button
              type="button"
              className={clsx(css.brand, css.wide)}
              aria-label={collapsed ? t('toggle.open') : t('session.new.label')}
              onClick={() => {
                // Collapsed, the mark is the sidebar's open control: hover already
                // previews the panel, so a click pins it open.
                if (collapsed) { toggleSidebar(); return }
                startSession()
              }}
            >
              <span className={css.brandIdentity} aria-hidden="true">
                <span className={css.brandMark}>
                  {renderSlot('sidebar.brand.mark', { size: 24 }, { fallback: <PixelMark size={24} /> })}
                </span>
                <span className={css.brandName}>
                  {renderSlot('sidebar.brand.name', {}, {
                    fallback: buildVersion === undefined
                      ? <span className={css.fallbackBrandName}>{t('brand.localBuild')}</span>
                      : (
                        <span className={css.localBuildBrand}>
                          <span className={css.localBuildTitle}>{t('brand.localBuild')}</span>
                          <span className={css.buildVersion}>{buildVersion}</span>
                        </span>
                      ),
                  })}
                </span>
              </span>
            </button>
          </>
        ) : (
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('toggle.open')}
            onClick={() => { toggleSidebar() }}
          >
            <span className={css.railMark} aria-hidden="true">
              {renderSlot('sidebar.brand.mark', { size: 24 }, { fallback: <PixelMark size={24} /> })}
            </span>
          </button>
        )}
      </div>

      {/* Expanded, the button carries its own label — tooltip only on the rail. */}
      <Tooltip label={t('session.new.label')} delayMs={500} disabled={wide}>
        <button
          type="button"
          className={css.newSession}
          aria-label={t('session.new.label')}
          onClick={() => { startSession() }}
        >
          <IconNewChatOutline16 size={wide ? 14 : 18} />
          {wide && <span className={clsx(css.newSessionLabel, css.wide)}>{t('session.new')}</span>}
        </button>
      </Tooltip>

      {panels.length > 0 && (
        <nav className={css.panelList} aria-label={t('panels.label')}>
          {panels.map(({ id, label }) => (
            <PanelRow
              key={id}
              id={id}
              label={label}
              wide={wide}
              usePanelInfo={usePanelInfo}
              selectPanel={selectPanel}
              renderSlot={renderSlot}
            />
          ))}
        </nav>
      )}

      {/* The browsing region fills the column between the controls and the
          foot in both states; its rail icon column rides the same slot. */}
      <div className={css.regionArea}>
        {renderSlot('sidebar.workspaces', {
          wide,
          expandSidebar: () => { if (collapsed) toggleSidebar() },
        })}
      </div>

      {/* Floor row: the guide and the settings cluster lead, additive frame
          actions trail on the right edge; the rail stacks the same seats
          centered on its circle rhythm. */}
      <div className={css.footArea}>
        <div className={css.guideArea}>
          {renderSlot('sidebar.guide', { wide })}
        </div>
        <div className={css.settingsArea}>
          {renderSlot('sidebar.settings', { wide })}
        </div>
        <div className={css.footerActions}>
          {renderSlot('sidebar.footer.action', { wide })}
        </div>
      </div>
    </div>
  )
}
