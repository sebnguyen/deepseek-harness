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
import { PixelLoader, PixelMark } from '@deepseek-ai/dsh-client-ui-primitives'

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

/**
 * The body box: a flex item filling the dock area's row, kept positioned so
 * the boot cover's `inset: 0` resolves against it.
 */
const HOST_STYLE = {
  position: 'relative',
  flex: '1 1 auto',
  minWidth: 0,
  minHeight: 0,
  display: 'block',
  overflow: 'hidden',
} as const

/** The frame fills the body and paints the twin's own dark sheet. */
const FRAME_STYLE = {
  display: 'block',
  width: '100%',
  height: '100%',
  border: 'none',
  // Opaque on purpose: the harness no longer paints an ocean behind the twin,
  // and the frame must not composite over the page even when a stale
  // `dshGlass` opt-in survives in the twin origin's session storage.
  background: 'var(--dsw-alias-bg-base, #121618)',
} as const

/** The cover sits above the frame until the workbench settles. */
const COVER_STYLE = {
  position: 'absolute',
  inset: '0',
  zIndex: 1,
} as const

/** The boot hero: pixel mark stacked on the wordmark, state line below. */
const HERO_STYLE = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '16px',
  width: '100%',
  height: '100%',
  padding: '16px',
  boxSizing: 'border-box',
  background: 'var(--dsw-alias-bg-base, #121618)',
  color: 'var(--dsw-alias-brand-primary, #7bb4bc)',
} as const

const WORDMARK_STYLE = {
  color: 'var(--dsw-alias-label-primary, #f7f8f8)',
  fontSize: '16px',
  lineHeight: '24px',
  fontWeight: 600,
} as const

const DETAIL_STYLE = {
  color: 'var(--dsw-alias-label-tertiary, #87898a)',
  fontSize: '12px',
  lineHeight: '18px',
  textAlign: 'center',
  maxWidth: '32em',
} as const

/**
 * The seam the user watches every time the twin spawns: the same pixel mark
 * and type scale as the harness boot page, with the state line below.
 * @param line - the state line under the wordmark.
 * @param spinning - twinkle loader instead of the solid pixel mark.
 * @returns the hero element.
 */
export function BootHero({ line, spinning = false }: { readonly line: string; readonly spinning?: boolean }): ReactNode {
  return (
    <div style={HERO_STYLE}>
      {spinning
        ? <PixelLoader mode="twinkle" size={128} />
        : <PixelMark size={64} />}
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

  const covered = settledSrc !== src
  // The guard's listeners hold for the frame's whole life, so they read the
  // cover through a ref instead of re-subscribing on every settle.
  const coveredRef = useRef(covered)
  useEffect(() => { coveredRef.current = covered }, [covered])

  // Focus guard, holding for the frame's whole life — including every boot
  // past the settle margin. The workbench auto-focuses its restored editor
  // whenever its deferred restore lands, and focusing inside an iframe
  // promotes browser-level focus to the <iframe> element, pulling the
  // keyboard out of the composer. The frame is cross-origin, so all the
  // parent can do is hand the focus back. While the boot cover is sealed no
  // gesture can reach the frame, so every move is automated and handed back;
  // after it lifts, a pointer inside the frame or a Tab just pressed marks
  // the user's own entry, after which the frame legitimately owns the focus.
  // A window blur that moved nothing (alt-tab away, then back) stands down.
  const lastFocus = useRef<HTMLElement | null>(null)
  const frameHolds = useRef(false)
  const frameHovered = useRef(false)
  const frameTabAt = useRef(Number.NEGATIVE_INFINITY)

  // A changed source is a fresh, unentered document: an entry verified for
  // the old one cannot authorize the new one, and the pending settle belongs
  // to the document being replaced.
  useEffect(() => {
    frameHolds.current = false
    // Re-seal the cover even when the source returns to a value that had
    // settled before: the element loads a new document either way.
    setSettledSrc(null)
    return () => {
      if (settleTimer.current !== undefined) clearTimeout(settleTimer.current)
    }
  }, [src])

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
    // Automated grab: hand the focus back to whatever the document last
    // held. A frame never keeps a focus it took itself; with nothing on
    // record it drops the focus onto <body>.
    const handBack = (thief: HTMLIFrameElement): void => {
      const prior = lastFocus.current
      if (prior !== null && prior.isConnected) {
        prior.focus({ preventScroll: true })
      } else {
        thief.blur()
      }
    }
    // A frame's own focus() surfaces here only as a window blur whose
    // activeElement is the frame element — the same signal Menu.tsx uses.
    const onBlur = (): void => {
      const thief = document.activeElement
      if (!(thief instanceof HTMLIFrameElement) || thief !== frameRef.current) return
      // Under the sealed boot cover no gesture can reach the frame, so a
      // focus move is automated by definition — on mount and on every
      // reload. Hand it back and retire any entry the previous document
      // earned: the new document has to earn its own.
      if (coveredRef.current) {
        frameHolds.current = false
        handBack(thief)
        return
      }
      if (frameHolds.current) return
      // The user's own entry: the pointer rests inside the frame, or a Tab
      // just landed. The frame owns the keyboard from here on.
      if (frameHovered.current || performance.now() - frameTabAt.current < TAB_ENTRY_GRACE_MS) {
        frameHolds.current = true
        // A Tab arms exactly one move; the entry it explained consumes it.
        frameTabAt.current = Number.NEGATIVE_INFINITY
        return
      }
      handBack(thief)
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
