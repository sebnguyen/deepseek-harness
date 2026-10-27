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
  // The src whose document has settled; anything else is still covered.
  const [settledSrc, setSettledSrc] = useState<string | null>(null)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const covered = settledSrc !== src

  // A changed source is a fresh document: the element loads a new document,
  // and the pending settle belongs to the one being replaced.
  useEffect(() => {
    // Re-seal the cover even when the source returns to a value that had
    // settled before: the element loads a new document either way.
    setSettledSrc(null)
    return () => {
      if (settleTimer.current !== undefined) clearTimeout(settleTimer.current)
    }
  }, [src])

  return (
    <div style={HOST_STYLE} data-twin-frame>
      <iframe
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
