/**
 * App-lifetime keep-alive frames for the VS Code twin, keyed on the workspace.
 *
 * The seat contract remounts session tab bodies on every session switch, so the
 * body itself can never own the iframe — and browsers make the naive keep-alive
 * a trap too: moving an `<iframe>` element to another parent resets its browsing
 * context, so reparenting reloads the workbench exactly like a fresh mount.
 * This module therefore never moves the element. The twin store holds one
 * record per ready src — the ready triple is the workspace identity, identical
 * URL + token + folder for every session on one root — and the root-scoped
 * `shell.overlay` host renders one permanent fixed-position float per record,
 * appended to `document.body` so its stacking is root-level. A pane body
 * `stake`s its box: a timer loop floats the container over the box's live rect
 * (column drags, sidebar transitions, and the panel's fullscreen band all
 * follow) and parks it hidden when the last stake leaves. A session switch on
 * the same workspace only re-points the float — the live document, its scroll,
 * and its focus survive with zero reloads; a switch to another workspace parks
 * the first frame for an instant restore on return; only a genuinely new
 * workspace root loads a fresh frame, and past the cap of two the oldest
 * parked frame falls out. Reload-visible state across harness restarts still
 * rides the workbench's origin-keyed IndexedDB.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { DigitalOceanLogo, PixelLoader } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Anti-flash wait: extra settle time after the twin document fires `load`
 * before the boot cover lifts. The workbench's own scripts paint a few beats
 * after `load`; revealing at `load` alone exposes one white/unstyled frame.
 * The frame still loads under the cover, so the delay hides precisely that
 * boot window and nothing else.
 */
const BOOT_SETTLE_MS = 1_200

/** Placing cadence so the float follows box drags and column transitions. */
const PLACE_MS = 16

/** How many workspace frames stay alive; the oldest parked frame falls out beyond it. */
const MAX_TWIN_FRAMES = 2

/** Stacking above the right panel (10) and its drag handle (11), below the shell overlay layer (20). */
const FLOAT_Z = 12
/** Fullscreen panels climb to 40, so the float must climb past them while staying under the docked float host (60). */
const FLOAT_Z_FULLSCREEN = 45

/** The frame fills its floating container; the container owns position and visibility. */
const FRAME_STYLE = {
  display: 'block',
  position: 'absolute',
  inset: '0',
  width: '100%',
  height: '100%',
  border: 'none',
  // Transparent element + `allowtransparency` attribute: the two Chromium
  // conditions for an iframe to composite over the host page, so the glass
  // workbench (`?dshGlass=1`) floats on the harness shell behind it.
  // Firefox is transparent by default and needs only the element style.
  background: 'transparent',
} as const

/** Parked container: hidden and zero-size; never removed while its record lives (removal would reload the frame). */
const PARKED_STYLE = {
  position: 'fixed',
  left: '0px',
  top: '0px',
  width: '0',
  height: '0',
  display: 'none',
  overflow: 'hidden',
} as const

/** Box the body renders: it reserves the pane area the float covers. */
const STACK_STYLE = {
  position: 'relative',
  width: '100%',
  height: '100%',
} as const

const COVER_STYLE = {
  position: 'absolute',
  inset: 0,
  // The cover sits inside the floating container, above the frame it seals.
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

/** One running stake: its box and its placement loop. */
interface Stake {
  readonly box: HTMLDivElement
  timer: ReturnType<typeof setInterval> | undefined
}

/** One keep-alive workspace frame. */
interface TwinState {
  /** The record's key: the ready src. */
  readonly key: string
  /** The shared iframe element; it never changes parent while the record lives. */
  frame: HTMLIFrameElement | null
  /** The float container the host mounted for this record, if any. */
  container: HTMLDivElement | null
  /** True once the workbench document has fired `load` at least once. */
  loaded: boolean
  /** The live stake, or null while parked. */
  stake: Stake | null
}

const twins = new Map<string, TwinState>()
const listeners = new Set<() => void>()
let keysSnapshot: readonly string[] = []

function notify(): void {
  keysSnapshot = [...twins.keys()]
  for (const listener of listeners) listener()
}

/**
 * Store subscription for `useSyncExternalStore` consumers.
 * @param listener - change callback.
 * @returns the unsubscriber.
 */
export function subscribeTwins(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Snapshot of the live record keys; referentially stable between changes. */
export function twinKeys(): readonly string[] {
  return keysSnapshot
}

/** The float container the host mounted for one record, if any. */
export function twinContainerOf(src: string): HTMLDivElement | null {
  return twins.get(src)?.container ?? null
}

/**
 * Drop every record; the host unmounts its floats on the notify.
 * Specs start from a cold cache.
 */
export function resetTwinFrames(): void {
  for (const twin of twins.values()) clearInterval(twin.stake?.timer)
  twins.clear()
  notify()
}

function evictCold(except: string): void {
  for (const twin of twins.values()) {
    if (twin.key === except || twin.stake !== null) continue
    twins.delete(twin.key)
    return
  }
}

/**
 * The keep-alive record for one ready src: reused as-is while the src holds,
 * recreated when the twin's URL, token, or folder changes, and created —
 * evicting the oldest parked record past the cap — when the workspace is new.
 * @param src - the ready triple formed into the iframe source.
 * @returns the record for `src`.
 */
export function ensureTwin(src: string): TwinState {
  const live = twins.get(src)
  if (live !== undefined) return live
  if (twins.size >= MAX_TWIN_FRAMES) evictCold(src)
  const twin: TwinState = { key: src, frame: null, container: null, loaded: false, stake: null }
  twins.set(src, twin)
  notify()
  return twin
}

/** The panel element one box renders in, if any: its fullscreen state changes the float's stacking band. */
function panelOf(box: HTMLDivElement): Element | null {
  return box.closest('[data-sidebar-right-panel]')
}

/** Place one record's float over its stake's live rect, in the panel's stacking band. */
function place(twin: TwinState): void {
  const stake = twin.stake
  const container = twin.container
  if (stake === null || container === null) return
  const rect = stake.box.getBoundingClientRect()
  const zone = panelOf(stake.box)?.getAttribute('data-sidebar-right-panel') === 'fullscreen' ? FLOAT_Z_FULLSCREEN : FLOAT_Z
  const style = container.style
  const left = `${String(rect.left)}px`
  const top = `${String(rect.top)}px`
  const width = `${String(rect.width)}px`
  const height = `${String(rect.height)}px`
  if (style.left !== left) style.left = left
  if (style.top !== top) style.top = top
  if (style.width !== width) style.width = width
  if (style.height !== height) style.height = height
  if (style.zIndex !== String(zone)) style.zIndex = String(zone)
  if (style.display === 'none') style.display = 'block'
}

/** Park one record's float; the frame element itself stays mounted. */
function park(twin: TwinState): void {
  if (twin.container !== null) Object.assign(twin.container.style, PARKED_STYLE)
}

/** Float one record over one body box until the returned teardown runs. */
function stake(twin: TwinState, box: HTMLDivElement): Stake {
  clearInterval(twin.stake?.timer)
  const record: Stake = { box, timer: undefined }
  twin.stake = record
  record.timer = setInterval(() => {
    place(twin)
  }, PLACE_MS)
  place(twin)
  return record
}

/** Release one body's stake; the record parks when the released stake was the live one. */
function releaseStake(twin: TwinState, record: Stake): void {
  clearInterval(record.timer)
  if (twin.stake === record) {
    twin.stake = null
    park(twin)
  }
}

/**
 * Mount one record's permanent float: on ref attach the iframe is created
 * once as the container's only child and never reparented; on ref detach
 * (record eviction or host teardown) the record sheds its element.
 * @param src - the record key the float belongs to.
 * @returns the portalled float element.
 */
function TwinFloat({ src }: { readonly src: string }): ReactNode {
  const ref = useCallback((el: HTMLDivElement | null) => {
    const twin = twins.get(src)
    if (twin === undefined) return
    if (el === null) {
      twin.container = null
      twin.frame = null
      notify()
      return
    }
    Object.assign(el.style, PARKED_STYLE)
    twin.container = el
    if (twin.frame === null) {
      const frame = document.createElement('iframe')
      frame.title = 'vscode'
      frame.setAttribute('data-twin-frame', src)
      Object.assign(frame.style, FRAME_STYLE)
      // Chromium gate: without this attribute the iframe composites opaque
      // even when both the element and the framed document are transparent.
      frame.setAttribute('allowtransparency', 'true')
      frame.src = src
      frame.addEventListener('load', () => { twin.loaded = true })
      el.appendChild(frame)
      twin.frame = frame
    }
    notify()
  }, [src])
  return createPortal(<div ref={ref} data-twin-float={src} />, document.body)
}

/** The root-scoped shell.overlay entry's props. */
export type TwinFrameHostProps = PropsRuntime<'shell.overlay'>

/**
 * The app-lifetime host for every workspace float, registered on the
 * root-scoped `shell.overlay` list seat so session switches never touch it.
 * @returns one float per live record.
 */
export function TwinFrameHost(_props: TwinFrameHostProps): ReactNode {
  const keys = useSyncExternalStore(subscribeTwins, twinKeys)
  return keys.map(src => <TwinFloat key={src} src={src} />)
}

/** The props the pane-side mount takes. */
export interface TwinFrameMountProps {
  /** The ready triple formed into the iframe source; identical across sessions on one workspace. */
  readonly src: string
  /** The line the boot cover shows while the workbench document settles. */
  readonly spinLine: string
}

/**
 * The pane-side end of the keep-alive: reserves the box the workspace frame
 * floats over, stakes the frame on mount, parks it on unmount, and stacks
 * the boot cover in the float until the workbench document loads plus the
 * settle margin. The frame element never changes parent, so a session
 * switch on the same workspace re-shows the live workbench without any reload.
 * @param props - the frame source and the cover's state line.
 * @returns the box, with the boot cover portalled into the shared float.
 */
export function TwinFrameMount({ src, spinLine }: TwinFrameMountProps): ReactNode {
  const [box, setBox] = useState<HTMLDivElement | null>(null)
  // The settle verdict keys off the record, not this mount: a body restaking a
  // frame whose document already booted must not resurrect the boot cover.
  const [settled, setSettled] = useState(() => twins.get(src)?.loaded === true)
  const container = useSyncExternalStore(subscribeTwins, () => twinContainerOf(src))

  useEffect(() => {
    if (box === null) return
    const twin = ensureTwin(src)
    if (twin.loaded) setSettled(true)
    const record = stake(twin, box)
    let settleTimer: ReturnType<typeof setTimeout> | undefined
    // The anti-flash wait rides the watch interval only while the document
    // has not finished booting; an already-loaded record skips the cover.
    const watch = twin.loaded
      ? undefined
      : setInterval(() => {
        if (!twin.loaded || settleTimer !== undefined) return
        settleTimer = setTimeout(() => { setSettled(true) }, BOOT_SETTLE_MS)
      }, PLACE_MS)
    return () => {
      releaseStake(twin, record)
      if (watch !== undefined) clearInterval(watch)
      if (settleTimer !== undefined) clearTimeout(settleTimer)
      setSettled(false)
    }
  }, [box, src])

  return (
    <div ref={setBox} style={STACK_STYLE}>
      {settled || container === null ? null : createPortal(
        <div style={COVER_STYLE}><BootHero line={spinLine} spinning /></div>,
        container,
      )}
    </div>
  )
}
