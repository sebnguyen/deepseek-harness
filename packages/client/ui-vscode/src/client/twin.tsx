/**
 * Workspace twin frames: one live document plus at most one parked spare.
 *
 * The seat contract remounts session tab bodies on every session switch, so
 * the body can never own an iframe — and browsers make any move a trap too:
 * reparenting an `<iframe>` resets its browsing context, reloading the
 * workbench like a fresh mount. This module therefore creates frame elements
 * once inside ui-layout's positional `shell.ide` layer (whose geometry the
 * frame owns outright) and only ever re-points their `src`: session bodies
 * publish the active workspace's ready triple through the intent store
 * below, and this wrapper shows the record for it. Hiding (no body shows a
 * twin) parks records with `display: none` — never a removal — so tab and
 * session switches on one workspace keep the live document. A workspace
 * switch parks the live record and shows its own, creating the element on
 * first visit; a flip back is a pure unhide. Records cap at two — one
 * live plus the parked spare, enough for the A↔B flip most switching is —
 * and the least-recently-shown frame falls out past that: workbench
 * documents are heavyweight, and an evicted workspace's server still runs
 * its stable loopback port, so a return is a document boot against a hot
 * twin, with per-workspace origin-keyed IndexedDB restoring editors and
 * layout. Reload-visible state across harness restarts rides that storage.
 */
import { useEffect, useLayoutEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { DigitalOceanLogo, PixelLoader } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Anti-flash wait: extra settle time after the twin document fires `load`
 * before the boot cover lifts. The workbench's own scripts paint a few beats
 * after `load`; revealing at `load` alone exposes one white/unstyled frame.
 * The cover still loads under the document, so the delay hides precisely
 * that boot window and nothing else.
 */
const BOOT_SETTLE_MS = 1_200

/**
 * Keyboard-entry grace: a focus move into a frame landing within this many
 * milliseconds of a Tab keydown counts as the key's default action — the
 * user tabbing into the frame — never as an automated grab. The move is
 * the keydown's synchronous outcome, so the window needs only to bridge
 * dispatch jitter, not human reaction time.
 */
const TAB_ENTRY_GRACE_MS = 300

/**
 * Live records cap: one visible plus one parked spare. The single most
 * common switch shape is the A↔B flip; unbounded maps would park a
 * heavyweight workbench document per visited workspace, and the host
 * already keeps each workspace's twin server warm for the harness run.
 */
const MAX_LIVE_FRAMES = 2

/** The seat band: fills the frame-owned geometry and opts back into pointer
 *  events (the layer itself is pointer-transparent). */
const HOST_STYLE = {
  position: 'absolute',
  inset: '0',
  pointerEvents: 'auto',
} as const

/** One record's home inside the host; parked with display: none, never removed. */
const CONTAINER_STYLE = {
  position: 'absolute',
  inset: '0',
  display: 'block',
  borderRadius: 'var(--dsh-frame-card-radius, 14px)',
  overflow: 'hidden',
} as const

/** The frame fills its record; transparency keeps the glass compositing. */
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

const COVER_STYLE = {
  position: 'absolute',
  inset: '0',
  // The cover sits above the records until the workbench settles.
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

/** One published intent: the src a body is showing, plus its ownership token. */
let intent: { readonly owner: object; readonly src: string } | null = null
let twinIntent: string | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

/** Store subscription for `useSyncExternalStore` consumers. */
export function subscribeTwinIntent(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Snapshot of the published src, or null while no body shows a twin. */
export function twinIntentSrc(): string | null {
  return twinIntent
}

/**
 * Publish one body's ready src. Later publishers win; a release clears only
 * its own intent, so a stale body's unmount can never blank a live one's
 * publication.
 * @param owner - the publishing body's identity token.
 * @param src - the ready triple formed into the iframe source.
 * @returns the release, run by the body's unmount.
 */
export function publishTwinIntent(owner: object, src: string): () => void {
  intent = { owner, src }
  if (twinIntent !== src) {
    twinIntent = src
    notify()
  }
  return () => {
    if (intent?.owner !== owner) return
    intent = null
    if (twinIntent !== null) {
      twinIntent = null
      notify()
    }
  }
}

/**
 * Publish this body's ready src as the frame cache's intent for as long as
 * the body is mounted.
 * @param src - the formed frame source, or null while not ready.
 */
export function useTwinIntent(src: string | null): void {
  const [owner] = useState<object>(() => ({}))
  useEffect(() => (src === null ? undefined : publishTwinIntent(owner, src)), [owner, src])
}

/** Drop the published intent; specs start from a cold store. */
export function resetTwinIntent(): void {
  intent = null
  twinIntent = null
  notify()
}

/** One workspace's frame: its container in the host, the element, its boot lifecycle. */
interface TwinRecord {
  readonly container: HTMLDivElement
  readonly frame: HTMLIFrameElement
  settled: boolean
  settleTimer: ReturnType<typeof setTimeout> | undefined
}

/**
 * Create one workspace record: container, frame element, and the anti-flash
 * settle that marks the document ready once its `load` plus margin passes.
 * @param src - the workspace's ready triple formed into the iframe source.
 * @param onSettled - re-render nudge so the seat can lift the cover.
 * @returns the mounted record, ready to show.
 */
function createTwinRecord(src: string, onSettled: () => void): TwinRecord {
  const container = document.createElement('div')
  Object.assign(container.style, CONTAINER_STYLE)
  container.setAttribute('data-twin-record', '')
  const frame = document.createElement('iframe')
  frame.title = 'vscode'
  Object.assign(frame.style, FRAME_STYLE)
  // Chromium gate: without this attribute the iframe composites opaque even
  // when both the element and the framed document are transparent.
  frame.setAttribute('allowtransparency', 'true')
  frame.src = src
  container.appendChild(frame)
  const record: TwinRecord = { container, frame, settled: false, settleTimer: undefined }
  frame.addEventListener('load', () => {
    record.settleTimer = setTimeout(() => {
      record.settleTimer = undefined
      record.settled = true
      onSettled()
    }, BOOT_SETTLE_MS)
  })
  return record
}

/** Drop one record: its settle timer stops; removing the container unloads the document. */
function discardTwinRecord(record: TwinRecord): void {
  if (record.settleTimer !== undefined) clearTimeout(record.settleTimer)
  record.container.remove()
}

/** The positional shell.ide seat entry's props: runtime share plus copy. */
export type TwinFrameProps = PropsRuntime<'shell.ide'> & PropsLocale<'vscode'>

/**
 * The workspace frame cache, registered once into the root-scoped positional
 * seat. Shows the record matching the published src — parking everything
 * else alive and creating on first visit — and seals each fresh document
 * under the boot cover until `load` plus the settle margin.
 * @param props - locale share for the cover's state line.
 * @returns the seat content.
 */
export function TwinFrame({ t }: TwinFrameProps): ReactNode {
  const src = useSyncExternalStore(subscribeTwinIntent, twinIntentSrc)
  const hostRef = useRef<HTMLDivElement | null>(null)
  // Insertion order is the recency queue: a shown record is re-set to move to
  // most-recent, so the map's first key is always the next eviction.
  const records = useRef(new Map<string, TwinRecord>())
  const [, bump] = useReducer((tick: number): number => tick + 1, 0)

  // Park everything, then show the intent's record — the one effect that
  // mutates the cache so the parking and the creation land in one commit.
  useLayoutEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const map = records.current
    for (const record of map.values()) {
      record.container.style.display = 'none'
      record.container.removeAttribute('data-current')
    }
    if (src === null) return
    let record = map.get(src)
    let created = false
    if (record === undefined) {
      record = createTwinRecord(src, bump)
      map.set(src, record)
      host.appendChild(record.container)
      created = true
    } else {
      map.delete(src)
      map.set(src, record)
    }
    record.container.style.display = ''
    record.container.setAttribute('data-current', '')
    while (map.size > MAX_LIVE_FRAMES) {
      const oldest = map.keys().next()
      if (oldest.done) break
      const stale = map.get(oldest.value)
      if (stale === undefined) break
      discardTwinRecord(stale)
      map.delete(oldest.value)
    }
    // A creation past render means the cover flag needs a re-read.
    if (created) bump()
  }, [src])

  // Focus guard, holding for the frame's whole life — a mount and every
  // boot past the settle margin included. The workbench auto-focuses its
  // restored editor whenever its deferred restore lands, and focusing
  // inside an iframe promotes browser-level focus to the <iframe> element,
  // pulling the keyboard out of the composer or wherever it was. The
  // workbench's own don't-steal guard can never trip in a never-focused
  // browsing context (the active element is <body> before and after its
  // restore), and the frame is cross-origin, so all the parent can do is
  // hand the focus back. The hand-back fires only on an automated grab: a
  // pointer inside the frame's box or a Tab just pressed marks the user's
  // own entry, after which the frame legitimately owns the focus — and a
  // window blur that moved nothing (alt-tab away, then back) stands down.
  const lastFocus = useRef<HTMLElement | null>(null)
  // The frame the user deliberately entered and that still owns the focus.
  const frameHolder = useRef<HTMLIFrameElement | null>(null)
  // The frame under the pointer: a click's entry lands on the inner
  // document before the parent sees anything, so the boundary crossings
  // are the only click-through signal a cross-origin frame gives us.
  const frameHover = useRef<HTMLIFrameElement | null>(null)
  // The latest Tab keydown: a focus move inside the grace is the key's
  // default action. Nothing pressed yet — never pre-arm the grace.
  const frameTabAt = useRef(Number.NEGATIVE_INFINITY)
  useEffect(() => {
    // Track our document's focus so a grab has somewhere to be handed
    // back; focus inside the seat (cover, frames) is never a valid restore
    // target, and focus landing back here ends a frame's verified hold.
    const onFocusIn = (event: FocusEvent): void => {
      const host = hostRef.current
      if (!(event.target instanceof HTMLElement)) return
      if (host !== null && host.contains(event.target)) return
      frameHolder.current = null
      lastFocus.current = event.target
    }
    const onPointerOver = (event: PointerEvent): void => {
      if (event.target instanceof HTMLIFrameElement) frameHover.current = event.target
    }
    const onPointerOut = (event: PointerEvent): void => {
      if (frameHover.current !== null && event.target === frameHover.current) frameHover.current = null
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Tab') frameTabAt.current = performance.now()
    }
    // A frame's own focus() surfaces here only as a window blur whose
    // activeElement is the frame element — the same signal Menu.tsx uses.
    const onBlur = (): void => {
      const thief = document.activeElement
      if (!(thief instanceof HTMLIFrameElement)) return
      // The verified holder's own blurs (the window itself losing focus)
      // moved nothing; only a dead grab needs a hand-back.
      if (frameHolder.current === thief) return
      let owned = false
      for (const record of records.current.values()) owned ||= record.frame === thief
      if (!owned) return
      // The user's own entry: the pointer rests inside this frame's box,
      // or a Tab just landed. The frame owns the keyboard from here on.
      if (frameHover.current === thief || performance.now() - frameTabAt.current < TAB_ENTRY_GRACE_MS) {
        frameHolder.current = thief
        // A Tab arms exactly one move; the entry it explained consumes it,
        // so a later grab waits for a fresh key.
        frameTabAt.current = Number.NEGATIVE_INFINITY
        return
      }
      // Automated grab: hand the focus back — to the frame the user was
      // working in when another one grabbed, else wherever the document
      // last had it (the composer). Returned lastFocus focus clears the
      // hold itself through the focusin above. Nothing on record to hand
      // back, and the frame drops the focus itself onto <body>: a frame
      // never holds a focus it took.
      const prior = frameHolder.current ?? lastFocus.current
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

  // Seat teardown is test-side only in practice (the root scope lives for the
  // app): drop every record and its pending settle with the host.
  useEffect(() => () => {
    for (const record of records.current.values()) discardTwinRecord(record)
    records.current.clear()
  }, [])

  const current = src === null ? undefined : records.current.get(src)
  return (
    <div ref={hostRef} style={HOST_STYLE} data-twin-frame-seat>
      {current !== undefined && !current.settled
        ? (
          <div style={COVER_STYLE}>
            <BootHero line={t('state.opening')} spinning />
          </div>
        )
        : null}
    </div>
  )
}
