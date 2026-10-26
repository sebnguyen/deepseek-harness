/**
 * The session twin's workspace frame, owned by the vscode tab body.
 *
 * The `vscode` type declares itself a surface, so the seat renders this body as
 * the column's content and the body owns the element: the document's lifetime
 * is the body's lifetime, and the column's own box places it — no absolute
 * frame seat above the layout, no reparenting, no source intent store.
 *
 * The trade the seat contract makes explicit: switching the active tab or the
 * session unmounts the body, so the workbench boots cold on the next visit.
 * The boot cover hides exactly that window — `load` plus a settle margin, since
 * the workbench paints a few beats after its document fires `load`.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { DigitalOceanLogo, PixelLoader } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Anti-flash wait: extra settle time after the twin document fires `load`
 * before the boot cover lifts. The workbench's own scripts paint a few beats
 * after `load`; revealing at `load` alone exposes one white/unstyled frame.
 */
const BOOT_SETTLE_MS = 1_200

/**
 * Keyboard-entry grace: a focus move into the frame landing within this many
 * milliseconds of a Tab keydown counts as the key's default action — the
 * user tabbing into the frame — never as an automated grab.
 */
const TAB_ENTRY_GRACE_MS = 300

/** The body box: fills the pane's content area (`.dockArea` is positioned). */
const HOST_STYLE = {
  position: 'absolute',
  inset: '0',
  display: 'block',
  overflow: 'hidden',
} as const

/** The frame fills the body; transparency keeps the glass compositing. */
const FRAME_STYLE = {
  display: 'block',
  width: '100%',
  height: '100%',
  border: 'none',
  // Transparent element + `allowtransparency` attribute: the two Chromium
  // conditions for an iframe to composite over the host page, so the glass
  // workbench (`?dshGlass=1`) floats on the harness shell behind it.
  // Firefox is transparent by default and needs only the element style.
  background: 'transparent',
} as const

/** The cover sits above the frame until the workbench settles. */
const COVER_STYLE = {
  position: 'absolute',
  inset: '0',
  zIndex: 1,
} as const

/** The boot hero: twinkle mark stacked on the wordmark, state line below. */
const HERO_STYLE = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '14px',
  width: '100%',
  height: '100%',
  padding: '16px',
  boxSizing: 'border-box',
  background: 'var(--dsw-alias-bg-base, #121618)',
} as const

const WORDMARK_STYLE = {
  color: 'var(--dsw-alias-label-primary, #f7f8f8)',
  fontSize: '12px',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
} as const

const DETAIL_STYLE = {
  color: 'var(--dsw-alias-label-secondary, #a0a2a3)',
  fontSize: '12px',
  textAlign: 'center',
  maxWidth: '32em',
} as const

/**
 * The seam the user watches every time the twin spawns: the DO twinkle mark
 * centered over the wordmark with the state line — the same loading canvas
 * the harness boot page paints, instead of a bare text line on stock chrome.
 * @param line - the state line under the wordmark.
 * @param spinning - twinkle loader instead of the static mark.
 * @returns the hero element.
 */
export function BootHero({ line, spinning = false }: { readonly line: string; readonly spinning?: boolean }): ReactNode {
  return (
    <div style={HERO_STYLE}>
      {spinning
        ? <PixelLoader mode="twinkle" size={128} />
        : <DigitalOceanLogo size={64} />}
      <div style={WORDMARK_STYLE}>DigitalOcean Harness</div>
      <output style={DETAIL_STYLE}>{line}</output>
    </div>
  )
}

/** The frame's props: the ready source and the locale share for the cover. */
export type TwinFrameProps = PropsLocale<'vscode'> & {
  /** The ready twin source formed by the body. */
  readonly src: string
}

/**
 * One workspace frame, sealed under the boot cover until its document settles.
 * @param props - the ready source and the cover's state line.
 * @returns the frame box.
 */
export function TwinFrame({ src, t }: TwinFrameProps): ReactNode {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  // The src whose document has settled; anything else is still covered.
  const [settledSrc, setSettledSrc] = useState<string | null>(null)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // A changed source is a fresh document until its own `load` settles it.
  useEffect(() => () => {
    if (settleTimer.current !== undefined) clearTimeout(settleTimer.current)
  }, [src])

  const covered = settledSrc !== src

  // Focus guard, holding for the frame's whole life — including every boot
  // past the settle margin. The workbench auto-focuses its restored editor
  // whenever its deferred restore lands, and focusing inside an iframe
  // promotes browser-level focus to the <iframe> element, pulling the
  // keyboard out of the composer. The frame is cross-origin, so all the
  // parent can do is hand the focus back — and only on an automated grab: a
  // pointer inside the frame or a Tab just pressed marks the user's own entry,
  // after which the frame legitimately owns the focus. A window blur that
  // moved nothing (alt-tab away, then back) stands down.
  const lastFocus = useRef<HTMLElement | null>(null)
  const frameHolds = useRef(false)
  const frameHovered = useRef(false)
  const frameTabAt = useRef(Number.NEGATIVE_INFINITY)
  useEffect(() => {
    // Seed the restore target with the focus the document already holds:
    // focusin tracks only changes, and the composer's autofocus normally
    // lands before this guard installs.
    const held = document.activeElement
    if (held instanceof HTMLElement && held !== document.body) lastFocus.current = held
    const onFocusIn = (event: FocusEvent): void => {
      const host = hostRef.current
      if (!(event.target instanceof HTMLElement)) return
      if (host !== null && host.contains(event.target)) return
      frameHolds.current = false
      lastFocus.current = event.target
    }
    const onPointerOver = (event: PointerEvent): void => {
      if (event.target === frameRef.current) frameHovered.current = true
    }
    const onPointerOut = (event: PointerEvent): void => {
      if (event.target === frameRef.current) frameHovered.current = false
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Tab') frameTabAt.current = performance.now()
    }
    // A frame's own focus() surfaces here only as a window blur whose
    // activeElement is the frame element — the same signal Menu.tsx uses.
    const onBlur = (): void => {
      const thief = document.activeElement
      if (!(thief instanceof HTMLIFrameElement) || thief !== frameRef.current) return
      if (frameHolds.current) return
      // The user's own entry: the pointer rests inside the frame, or a Tab
      // just landed. The frame owns the keyboard from here on.
      if (frameHovered.current || performance.now() - frameTabAt.current < TAB_ENTRY_GRACE_MS) {
        frameHolds.current = true
        // A Tab arms exactly one move; the entry it explained consumes it.
        frameTabAt.current = Number.NEGATIVE_INFINITY
        return
      }
      // Automated grab: hand the focus back to whatever the document last
      // held. A frame never keeps a focus it took itself; with nothing on
      // record it drops the focus onto <body>.
      const prior = lastFocus.current
      if (prior !== null && prior.isConnected) {
        prior.focus({ preventScroll: true })
      } else {
        thief.blur()
      }
    }
    window.addEventListener('focusin', onFocusIn)
    window.addEventListener('pointerover', onPointerOver)
    window.addEventListener('pointerout', onPointerOut)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('focusin', onFocusIn)
      window.removeEventListener('pointerover', onPointerOver)
      window.removeEventListener('pointerout', onPointerOut)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  return (
    <div ref={hostRef} style={HOST_STYLE} data-twin-frame>
      <iframe
        ref={frameRef}
        title="vscode"
        src={src}
        style={FRAME_STYLE}
        // Chromium gate: without this attribute the iframe composites opaque
        // even when both the element and the framed document are transparent.
        // Spread because React's typed prop (`allowTransparency`) does not
        // reach the DOM; unknown lowercase attributes pass through verbatim.
        {...{ allowtransparency: 'true' }}
        // Clipboard delegation: the twin is cross-origin (its own loopback
        // port), so without this the permissions policy blocks the Clipboard
        // API inside the frame and the workbench shows its sticky "Unable to
        // read from the browser's clipboard" prompt.
        allow="clipboard-read; clipboard-write"
        onLoad={() => {
          if (settleTimer.current !== undefined) clearTimeout(settleTimer.current)
          settleTimer.current = setTimeout(() => {
            settleTimer.current = undefined
            setSettledSrc(src)
          }, BOOT_SETTLE_MS)
        }}
      />
      {covered
        ? (
          <div style={COVER_STYLE} data-twin-cover>
            <BootHero line={t('state.opening')} spinning />
          </div>
        )
        : null}
    </div>
  )
}
