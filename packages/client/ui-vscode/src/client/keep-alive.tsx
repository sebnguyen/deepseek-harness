/**
 * App-lifetime keep-alive frames for the VS Code twin, keyed on the workspace.
 *
 * The seat contract remounts session tab bodies on every session switch, which
 * recreated the iframe — and therefore re-booted the workbench document — even
 * when the two sessions share a workspace (the host already runs ONE twin per
 * workspace root and answers the identical URL + token). This module lifts the
 * iframe element above any body lifetime: one frame per workspace root, hosted
 * in a document-level node that no session owns. A body adopts its workspace's
 * frame into the pane and un-adopts on unmount, so a session switch on the same
 * workspace re-shows the LIVE document with no reload, a switch to a different
 * workspace keeps the first frame alive for an instant restore on return, and
 * only a genuinely new workspace root loads a fresh frame. Reload-visible state
 * (open editors, layout) still rides the workbench's origin-keyed IndexedDB as
 * before; the cap evicts the oldest frame no body currently shows.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { DigitalOceanLogo, PixelLoader } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Anti-flash wait: extra settle time after the twin document fires `load`
 * before the boot cover lifts. The workbench's own scripts paint a few beats
 * after `load`; revealing at `load` alone exposes one white/unstyled frame.
 * The frame still loads under the cover, so the delay hides precisely that
 * boot window and nothing else.
 */
const BOOT_SETTLE_MS = 1_200

/** How many workspace frames stay alive; the oldest frame no body shows falls out beyond it. */
const MAX_TWIN_FRAMES = 2

/** The adopted frame fills its box; parked in the zero-size host it stays off-screen. */
const FRAME_STYLE = {
  // block: an inline-replaced iframe sits on the text baseline and leaves a
  // descender gap under it, which overflows the pane body's auto scroller as a
  // spurious vertical scrollbar.
  display: 'none',
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  border: 'none',
  // Transparent element + `allowtransparency` attribute: the two Chromium
  // conditions for an iframe to composite over the host page, so the glass
  // workbench (`?dshGlass=1`) floats on the ocean scene. Firefox is
  // transparent by default and needs nothing more.
  background: 'transparent',
} as const

/** Zero-size document-level host: parked frames keep their documents, not the user's eye. */
const HOST_STYLE = {
  position: 'absolute',
  width: 0,
  height: 0,
} as const

/** Box the body renders: the adopted frame lands inside it, the cover stacks over. */
const STACK_STYLE = {
  position: 'relative',
  width: '100%',
  height: '100%',
} as const

const COVER_STYLE = {
  position: 'absolute',
  inset: 0,
  // The adopted frame may append after the cover in DOM order; the cover must win the stack.
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
        ? <PixelLoader mode="twinkle" grid={16} size={128} />
        : <DigitalOceanLogo size={64} />}
      <div style={WORDMARK_STYLE}>DigitalOcean Harness</div>
      <output style={DETAIL_STYLE}>{line}</output>
    </div>
  )
}

/** One keep-alive frame: the element, its source, and who currently shows it. */
interface TwinFrame {
  /** The frame's keep-alive key: the ready src, identical for every session on one workspace. */
  readonly key: string
  /** The src the element currently loads. */
  readonly src: string
  /** The shared iframe element. */
  readonly frame: HTMLIFrameElement
  /** True once the workbench document has fired `load` at least once. */
  loaded: boolean
  /** The box currently showing the frame; null parks it in the host. */
  staked: HTMLDivElement | null
  /** Bodies currently adopting the frame. */
  views: number
}

const twins = new Map<string, TwinFrame>()

let keepAlive: HTMLDivElement | null = null

/** The document-level host, created on first park. */
function twinHost(): HTMLDivElement {
  if (keepAlive === null) {
    keepAlive = document.createElement('div')
    Object.assign(keepAlive.style, HOST_STYLE)
    document.body.appendChild(keepAlive)
  }
  return keepAlive
}

/**
 * Drop every cached frame and the host element; specs start from a cold cache.
 */
export function resetTwinFrames(): void {
  for (const twin of twins.values()) twin.frame.remove()
  twins.clear()
  keepAlive?.remove()
  keepAlive = null
}

/** Remove the oldest frame no body shows, if any such frame exists. */
function evictCold(except: string): void {
  for (const twin of twins.values()) {
    if (twin.key === except || twin.staked !== null) continue
    twins.delete(twin.key)
    twin.frame.remove()
    return
  }
}

/**
 * The keep-alive frame for one ready src: reused as-is while the src holds,
 * recreated when the twin's URL, token, or folder changes, and created —
 * evicting the oldest unshown frame past the cap — when the workspace is new.
 * @param src - the ready triple formed into the iframe source.
 * @returns the frame record for `src`.
 */
function ensureTwin(src: string): TwinFrame {
  const live = twins.get(src)
  if (live !== undefined) return live
  if (twins.size >= MAX_TWIN_FRAMES) evictCold(src)
  const frame = document.createElement('iframe')
  frame.title = 'vscode'
  Object.assign(frame.style, FRAME_STYLE)
  // Chromium gate: without this attribute the iframe composites opaque even
  // when both the element and the framed document are transparent.
  frame.setAttribute('allowtransparency', 'true')
  frame.src = src
  const twin: TwinFrame = { key: src, src, frame, loaded: false, staked: null, views: 0 }
  frame.addEventListener('load', () => { twin.loaded = true })
  twinHost().appendChild(frame)
  twins.set(src, twin)
  return twin
}

/** Show one twin in one body box. */
function adopt(twin: TwinFrame, box: HTMLDivElement): void {
  twin.views += 1
  twin.staked = box
  twin.frame.style.display = 'block'
  box.appendChild(twin.frame)
}

/** Release one body's claim; the last view parks the live frame, hidden, in the host. */
function unadopt(twin: TwinFrame): void {
  twin.views = Math.max(0, twin.views - 1)
  if (twin.views > 0) return
  twin.staked = null
  twin.frame.style.display = 'none'
  twinHost().appendChild(twin.frame)
}

/** The props the pane-side mount takes. */
export interface TwinFrameMountProps {
  /** The ready triple formed into the iframe source; identical across sessions on one workspace. */
  readonly src: string
  /** The line the boot cover shows while the workbench document settles. */
  readonly spinLine: string
}

/**
 * The pane-side end of the keep-alive: adopts the workspace frame for `src`
 * into this body's box on mount, parks it on unmount, and stacks the boot
 * cover until the workbench document loads plus the settle margin. Moving
 * the element between connected parents never reloads its document, so a
 * session switch on the same workspace re-shows the live workbench.
 * @param props - the frame source and the cover's state line.
 * @returns the box, with the shared frame and the cover as its children.
 */
export function TwinFrameMount({ src, spinLine }: TwinFrameMountProps): ReactNode {
  const [box, setBox] = useState<HTMLDivElement | null>(null)
  const [settled, setSettled] = useState(false)

  useEffect(() => {
    if (box === null) return
    const twin = ensureTwin(src)
    adopt(twin, box)
    let timer: ReturnType<typeof setTimeout> | undefined
    const settle = (): void => {
      timer = setTimeout(() => { setSettled(true) }, BOOT_SETTLE_MS)
    }
    if (twin.loaded) settle()
    twin.frame.addEventListener('load', settle)
    return () => {
      unadopt(twin)
      twin.frame.removeEventListener('load', settle)
      if (timer !== undefined) clearTimeout(timer)
      setSettled(false)
    }
  }, [box, src])

  return (
    <div ref={setBox} style={STACK_STYLE}>
      {box !== null && createPortal(
        settled ? null : <div style={COVER_STYLE}><BootHero line={spinLine} spinning /></div>,
        box,
      )}
    </div>
  )
}
