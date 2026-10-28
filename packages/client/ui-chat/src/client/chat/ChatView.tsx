// An enclosing `[data-conversation-scroll]` owns scrolling when present;
// otherwise this view owns it. Each row subscribes to one stable node key.

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { flushSync } from 'react-dom'
import type { RenderMessageImages } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { Button, IconChevronDownOutline14, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps, OpenFileOptions } from '../contract/slots.ts'
import type { ChatSnapshot } from '../contract/snapshot.ts'
import { PendingSteeringBubble, PendingSubmissionBubble } from './MessageItem.tsx'
import { ChatNodeSeat, measureContentBox } from './ChatNodeSeat.tsx'
import css from './ChatView.module.css'
import { followScrollport, type FollowHandle } from './follow-scroll.ts'

const FOLLOW_THRESHOLD = 24
const SCROLL_SAMPLE_INTERVAL_MS = 250
/** Live band: rows kept rendered on each side of the row at the viewport
 *  centre. Seventy-five rows above and seventy-five below is at most 151 live
 *  rows. A node count, never a pixel estimate. The rows the reader can actually
 *  see are admitted per frame by their own path, so this band is the preventive
 *  buffer in front of it — the margin a fling has to cross before the next
 *  admission — not the thing that keeps the viewport rendered. */
const LIVE_BAND_NODES = 75
/** The newest rows stay live whatever the reader looks at. They are the only
 *  rows that change on their own — the streaming output and the turn tail —
 *  so a reader parked in history must not unmount them: a remount restarts
 *  the tail's count-up and reads as a flicker. */
const PIN_TAIL_NODES = 8
/** History the reader has scrolled past stays pageable rather than loaded. The
 *  retained window keeps two bands of margin above the band, so a scroll back
 *  up needs no fetch, and releases a page-sized chunk at a time, so one
 *  projection rebuild covers a page of growth instead of one per crossing row. */
const EVICT_MARGIN_NODES = LIVE_BAND_NODES * 2
const EVICT_CHUNK_NODES = 200

/** Active column host when present; otherwise the view-local scroller. */
function scrollerOf(from: HTMLElement): HTMLElement {
  return (from.closest('[data-conversation-scroll]')) ?? from
}

/** Browser shrink clamps and recorded writes do not transfer scroll ownership. */
function readerMovedScroll(top: number, floor: number, observedTop: number): boolean {
  return Math.abs(top - Math.min(observedTop, floor)) > 0.5
}

interface PagingAnchor {
  /** Stable node/call identity, independent of boundary-spanning group keys. */
  key: string
  /** Row top relative to the scrollport after the latest user scroll. */
  top: number
}

/** Find an already-rendered row without interpolating a selector. */
function anchorElement(list: HTMLElement, key: string): HTMLElement | null {
  for (const row of list.querySelectorAll<HTMLElement>('[data-chat-anchor-key]:not([hidden])')) {
    if (row.dataset.chatAnchorKey === key) return row
  }
  return null
}

/** Row position in scrollport coordinates (viewport-independent). */
function flowTop(row: HTMLElement, scrollport: HTMLElement): number {
  return row.getBoundingClientRect().top - scrollport.getBoundingClientRect().top
}

/** The live band a warm open mounts: the band around the remembered anchor (the
 *  tail when there is none) plus the pinned tail. A node count, like every other
 *  band decision — no geometry is needed to know which rows to mount. */
/** Keys of the rows whose box intersects the scrollport: the rows the reader is
 *  actually looking at. Two binary searches over the rendered rows, so the cost
 *  is a handful of rect reads (≈20 µs) rather than an estimate of how many rows
 *  fit — rows differ in height, so no fixed count is honest. */
function visibleRowKeys(list: HTMLElement, scrollport: HTMLElement): string[] {
  const rows = list.querySelectorAll<HTMLElement>('[data-chat-flow-key]')
  const port = scrollport.getBoundingClientRect()
  // The composer is sticky inside the scrollport, so it overlays the bottom of
  // the transcript: the visible band ends at its top edge. pagingAnchor reads
  // the same bound, so both captures agree on what the reader can see.
  const composer = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
  const composerTop = composer?.getBoundingClientRect().top
  const visibleBottom = composerTop === undefined ? port.bottom : Math.min(port.bottom, composerTop)
  if (rows.length === 0 || port.height <= 0 || visibleBottom <= port.top) return []
  const bottomOf = (index: number): number =>
    rows[index]?.getBoundingClientRect().bottom ?? Number.NEGATIVE_INFINITY
  const topOf = (index: number): number =>
    rows[index]?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY
  // First row whose bottom passes the port top.
  let lo = 0
  let hi = rows.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (bottomOf(mid) <= port.top) lo = mid + 1
    else hi = mid
  }
  const first = lo
  // Last row whose top precedes the visible bottom.
  lo = 0
  hi = rows.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (topOf(mid) >= visibleBottom) hi = mid - 1
    else lo = mid
  }
  const last = lo
  const keys: string[] = []
  for (let index = first; index <= last; index += 1) {
    const key = rows[index]?.dataset.chatFlowKey
    if (key !== undefined && key !== '') keys.push(key)
  }
  return keys
}

function bandAround(order: readonly string[], anchorKey: string | undefined): Set<string> {
  const anchored = anchorKey === undefined ? -1 : order.indexOf(anchorKey)
  const pivot = anchored < 0 ? order.length - 1 : anchored
  const keys = new Set(
    order.slice(Math.max(0, pivot - LIVE_BAND_NODES), Math.min(order.length, pivot + LIVE_BAND_NODES + 1)),
  )
  for (const key of order.slice(Math.max(0, order.length - PIN_TAIL_NODES))) keys.add(key)
  return keys
}

/** The geometry a remembered height is valid at: the content-width preference the
 *  column inherits, its font size, and the window that clamps that width. Read
 *  from computed style rather than a rect, so the save path stays layout-free. */
function stampOf(column: HTMLElement): string {
  const style = getComputedStyle(column)
  return `${style.getPropertyValue('--dsh-chat-content-width')}|${style.fontSize}|${window.innerWidth}`
}

/** Does the reader see where the flow ends? The last row's bottom edge sits
 *  inside the scrollport box, so the floor always counts and a reader a little
 *  above it still counts while the end of the flow is on screen. Geometry, not a
 *  pixel distance from the floor: a last row taller than the window re-arms the
 *  streaming follow once its end is visible, and a reader who scrolls back up
 *  inside it releases the follow by pushing that end out of view. Runtimes
 *  without layout (jsdom) keep the floor test. */
function tailEndVisible(list: HTMLElement, scrollport: HTMLElement, floor: number): boolean {
  const rows = list.querySelectorAll<HTMLElement>('[data-chat-flow] > [data-chat-flow-key]')
  // The flow ends at its last row that has a box. A declined row (the settled
  // turn tail, for one) is display:none and a runtime without layout has no
  // boxes at all, so neither can mark the end.
  let lastRect: DOMRect | undefined
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows.item(index)
    if (row === null) continue
    const rect = row.getBoundingClientRect()
    if (rect.height > 0) {
      lastRect = rect
      break
    }
  }
  if (lastRect === undefined) return floor - scrollport.scrollTop <= FOLLOW_THRESHOLD + 1
  return lastRect.bottom <= scrollport.getBoundingClientRect().bottom + 1
}

/** Select a visible stable node/call identity, falling back only when layout
 * has not exposed a visible box yet. */
function pagingAnchor(list: HTMLElement, scrollport: HTMLElement): HTMLElement | null {
  const viewport = scrollport.getBoundingClientRect()
  const composer = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
  const visibleBottom = composer?.getBoundingClientRect().top ?? viewport.bottom
  // The leading edge preserves nested call identity when it hits a row.
  // Chrome/gap misses use logarithmic layout reads over the ordered flex rows.
  if (typeof document.elementsFromPoint === 'function' && visibleBottom > viewport.top) {
    const content = list.getBoundingClientRect()
    const left = Math.max(viewport.left, content.left)
    const right = Math.min(viewport.right, content.right)
    const x = left + Math.max(0, right - left) / 2
    for (const element of document.elementsFromPoint(x, viewport.top + 1)) {
      const row = element instanceof HTMLElement
        ? element.closest<HTMLElement>('[data-chat-anchor-key]')
        : null
      if (row !== null && list.contains(row)) return row
    }
  }
  const rows = list.querySelectorAll<HTMLElement>(
    '[data-chat-flow] > [data-chat-flow-key]:not(:empty):not([hidden])',
  )
  let low = 0
  let high = rows.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (rows.item(middle).getBoundingClientRect().bottom > viewport.top) high = middle
    else low = middle + 1
  }
  const row = rows[low]
  return row !== undefined && row.getBoundingClientRect().top < visibleBottom ? row : rows[0] ?? null
}

type ChatScrollPosition = NonNullable<ReturnType<ChatViewSlotProps['chatScroll']['read']>>

/** Capture a reflow-resistant reader position from the current rendered window. */
function scrollPosition(list: HTMLElement, scrollport: HTMLElement): ChatScrollPosition | null {
  const row = pagingAnchor(list, scrollport)
  const anchorKey = row?.dataset.chatAnchorKey
  if (row === null || anchorKey === undefined) return null
  return {
    anchorKey,
    anchorTop: flowTop(row, scrollport),
    scrollTop: scrollport.scrollTop,
  }
}

/** Host/OS refusal text for the file-open dialog; empty throws keep a locale fallback. */
function openFailureMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error)
  return message === '' ? fallback : message
}

/**
 * Prompt-RPC identities already rendered by durable material: user/steering
 * node sources plus queue occurrences. A submission echo whose identity
 * appears here is hidden in the same render, so the echo→durable swap is
 * atomic — no duplicate, no gap — regardless of when the echo leaves the
 * session snapshot.
 */
function observedRpcIds(
  order: readonly string[],
  nodes: ChatSnapshot['nodes'],
  queue: readonly { readonly rpcId?: string }[],
): ReadonlySet<string> {
  const observed = new Set<string>()
  for (const key of order) {
    const node = nodes.get(key)
    if (node === undefined || (node.kind !== 'user' && node.kind !== 'steering')) continue
    const source = (node.data as { readonly source?: unknown }).source as
      | { readonly kind?: unknown; readonly rpcId?: unknown }
      | undefined
    if (source?.kind === 'user' && typeof source.rpcId === 'string') observed.add(source.rpcId)
  }
  for (const item of queue) {
    if (item.rpcId !== undefined) observed.add(item.rpcId)
  }
  return observed
}

type ChatNodeListProps = Omit<ComponentProps<typeof ChatNodeSeat>, 'nodeKey' | 'live' | 'woke'> & {
  readonly order: readonly string[]
  readonly liveKeys: ReadonlySet<string>
  readonly wokeKeys: ReadonlySet<string>
}

const ChatNodeList = memo(function ChatNodeList({ order, liveKeys, wokeKeys, ...seatProps }: ChatNodeListProps) {
  return order.map(nodeKey => (
    <ChatNodeSeat key={nodeKey} nodeKey={nodeKey} live={liveKeys.has(nodeKey)} woke={wokeKeys.has(nodeKey)} {...seatProps} />
  ))
})

/**
 * The chat view slot entry: pure component over the composed props; each
 * ordered business Node crosses the keyed renderer seat.
 */
export function ChatView({
  useSession, useChat, useChatNode, useSessions, renderSlot,
  sessionId, openFile, openSkill, loadOlder, loadImage, openView, chatScroll, chatHeights, evictBefore, forkAt,
  revealFile, fileMentions,
  t,
}: ChatViewSlotProps) {
  const order = useChat(s => s.order)
  const nodeStore = useChat(s => s.nodes)
  const inbox = useSession(s => s.queue)
  // Workspace root off the session list row: path summaries display relative to it.
  const cwd = useSessions(s => s.byId[sessionId]?.cwd)
  const running = useSession(s => s.running)
  const openState = useSession(s => s.openState)
  const openError = useSession(s => s.openError)
  const hasMore = useSession(s => s.hasMore)
  const loadingOlder = useSession(s => s.loadingOlder)
  const inspectCall = useCallback((callId: string) => {
    openView('trajectory', callId)
  }, [openView])
  const [fileOpenError, setFileOpenError] = useState<{ path: string; message: string } | null>(null)
  const [fileOpenBusy, setFileOpenBusy] = useState(false)
  // Close/retry must ignore a settlement that started before the latest
  // gesture; otherwise a cancelled in-flight refusal reopens the dialog.
  const fileOpenRequest = useRef(0)

  const requestOpenFile = useCallback((path: string, options?: OpenFileOptions) => {
    const id = ++fileOpenRequest.current
    setFileOpenBusy(true)
    void (options === undefined ? openFile(path) : openFile(path, options)).then(
      () => {
        if (id !== fileOpenRequest.current) return
        setFileOpenError(null)
        setFileOpenBusy(false)
      },
      (error: unknown) => {
        if (id !== fileOpenRequest.current) return
        setFileOpenError({
          path,
          message: openFailureMessage(
            error,
            t('fileOpen.unknown'),
          ),
        })
        setFileOpenBusy(false)
      },
    )
  }, [openFile, t])

  const closeFileOpenError = useCallback(() => {
    fileOpenRequest.current += 1
    setFileOpenError(null)
    setFileOpenBusy(false)
  }, [])

  const pendingSteering = useMemo(
    () => inbox.filter(item => item.placement === 'steering'),
    [inbox],
  )
  const pendingSubmissions = useSession(s => s.pendingSubmissions)
  // Submission echoes still awaiting their durable counterpart. `order` is the
  // recompute trigger: durable user material always arrives as an append, and
  // every append replaces the order array.
  const visibleSubmissions = useMemo(() => {
    if (pendingSubmissions.length === 0) return pendingSubmissions
    const observed = observedRpcIds(order, nodeStore, inbox)
    return pendingSubmissions.filter(submission => (
      submission.placement !== 'queued' && !observed.has(submission.requestId)
    ))
  }, [pendingSubmissions, order, nodeStore, inbox])
  const renderMessageImages = useCallback<RenderMessageImages>(
    owner => renderSlot('conversation.message.images', { ...owner, loadImage }),
    [loadImage, renderSlot],
  )
  const listRef = useRef<HTMLDivElement | null>(null)
  const columnRef = useRef<HTMLDivElement | null>(null)
  // A saved position starts disarmed; the first layout effect synchronously
  // restores it and normalizes a floor-clamped position back to following.
  const [atBottom, setAtBottom] = useState(() => chatScroll.read() === null)
  const atBottomRef = useRef(atBottom)
  // A remembered height is only valid at the width and font it was measured
  // under, so the snapshot carries a stamp and the restore compares it.
  const heightSnapshot = useRef(chatHeights.read()).current
  const heightStampRef = useRef<string | null>(heightSnapshot?.stamp ?? null)
  const [liveKeys, setLiveKeys] = useState<Set<string>>(() => heightSnapshot === null
    // Nothing remembered: mounting every row is the only way to learn heights.
    ? new Set(order)
    // Warm open: the band around the remembered row, so the rest never mounts.
    : bandAround(order, chatScroll.read()?.anchorKey))
  // The scroll-sample effect mounts once, so every input the band computation
  // reads is mirrored into a ref instead of closed over a mount-time value.
  const orderRef = useRef<readonly string[]>(order)
  orderRef.current = order
  const liveKeysRef = useRef<ReadonlySet<string>>(liveKeys)
  liveKeysRef.current = liveKeys
  /** Frame carrying a viewport admission; at most one in flight. */
  const admitFrameRef = useRef<number | null>(null)
  /** One follow-up frame per scroll event, after an admission grew the set. */
  const admitAgainRef = useRef(false)
  /** Keys that became live because the band moved onto them. Sticky: a row that
   *  wakes twice is a wake both times, and the marker only matters for the mount
   *  that follows it. */
  const wokeKeysRef = useRef<Set<string>>(new Set())
  /** Mark the rows this band swept in; a delivered row is not one of them. */
  const markWoke = useCallback((next: ReadonlySet<string>): void => {
    for (const key of next) if (!liveKeysRef.current.has(key)) wokeKeysRef.current.add(key)
  }, [])
  /** Admit the rows the reader is looking at, the moment they are looking at
   *  them. The band sample runs on a clock, so a fling outruns it and lands on
   *  spacers; this asks the scrollport instead. Union, so nothing departs and
   *  nothing is measured. Returns whether the live set actually grew. */
  const admitViewport = useCallback((): boolean => {
    if (loadingOlderRef.current || anchorRef.current !== null) return false
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: only scheduled while mounted. */
    if (local === null) return false
    const current = liveKeysRef.current
    const missing = visibleRowKeys(local, scrollerOf(local)).filter(key => !current.has(key))
    if (missing.length === 0) return false
    // Render inside this frame: the rows the reader is over must be in the DOM
    // for the paint that follows this measurement, not in a later task. Anything
    // deferred here is a frame of spacer under the reader.
    flushSync(() => {
      markWoke(new Set(missing))
      setLiveKeys((prev) => {
        const union = new Set([...prev, ...missing])
        if (union.size === prev.size) return prev
        return union
      })
    })
    return true
  }, [markWoke])
  /** One admission per frame: a fling fires scroll events far faster than
   *  content can mount, and every admission is a commit. A commit moves layout,
   *  so one follow-up frame re-checks the viewport after it — latched per scroll
   *  event, so a commit that lands late cannot spin. */
  const scheduleAdmit = useCallback((): void => {
    if (admitFrameRef.current !== null) return
    admitFrameRef.current = window.requestAnimationFrame(() => {
      admitFrameRef.current = null
      if (!admitViewport()) return
      if (admitAgainRef.current) return
      admitAgainRef.current = true
      scheduleAdmit()
    })
  }, [admitViewport])
  const loadingOlderRef = useRef(loadingOlder)
  loadingOlderRef.current = loadingOlder
  // Measured content heights keyed by node: the only thing a dormant row
  // reserves. Written when a row mounts and when it leaves the live band, and
  // seeded from the session's remembered snapshot so a warm open needs no mount.
  const rowHeightsRef = useRef<Map<string, number>>(new Map(heightSnapshot?.heights ?? []))
  const scrollSamplePendingRef = useRef(false)
  /** The sample reads props through refs, so the eviction verb and the node
   *  store it needs are mirrored like every other sample input. */
  const nodeStoreRef = useRef(nodeStore)
  nodeStoreRef.current = nodeStore
  const evictBeforeRef = useRef(evictBefore)
  evictBeforeRef.current = evictBefore
  /** Reader row an eviction must keep in place; cleared by the next layout pass. */
  const evictAnchorRef = useRef<PagingAnchor | null>(null)
  /** Cut already asked for: the window update lands a render later, so a second
   *  sample must not request the same release again. */
  const releasedKeyRef = useRef<string | null>(null)

  /** Last position delivered or written on the main thread. */
  const observedTopRef = useRef(0)
  /** Paging anchor: semantic row/position at click, updated by reader scrolls
   * while the request is pending and restored after the prepend lands. */
  const anchorRef = useRef<PagingAnchor | null>(null)

  const firstSeqRef = useRef<number | null>(null)
  const openedRef = useRef(false)
  const lastKeyRef = useRef<string | null>(null)
  const lastSteeringIdRef = useRef<string | null>(null)
  const lastSubmissionIdRef = useRef<string | null>(null)
  /** Flow tip signature — follow-scroll only when this moves, never on a
   *  scroll-driven at-bottom chrome re-render (which would snap inertial
   *  scrolls the rest of the way to the floor). */
  const followSigRef = useRef<string | null>(null)
  /** Eased floor-follow in flight; null while no frame is carrying the port. */
  const followHandleRef = useRef<FollowHandle | null>(null)

  const firstKey = order[0]
  const firstSeq = firstKey === undefined ? null : nodeStore.get(firstKey)?.anchorSeq ?? null
  const lastKey = order.at(-1) ?? null
  const lastNode = lastKey === null ? undefined : nodeStore.get(lastKey)
  const lastSteeringId = pendingSteering[pendingSteering.length - 1]?.id ?? null
  const lastSubmissionId = visibleSubmissions[visibleSubmissions.length - 1]?.requestId ?? null
  const followSig = `${openState}:${firstSeq}:${lastKey}:${order.length}:${running ? 1 : 0}:${lastSteeringId ?? ''}:${lastSubmissionId ?? ''}`
  const effectiveLiveKeys = liveKeys.size === 0 && order.length > 0 ? new Set(order) : liveKeys

  /** Release the history the reader has scrolled far past, a page-sized chunk at
   *  a time. The retained window keeps the band plus a margin, so the scroll
   *  range stops covering the whole session while the released prefix stays one
   *  Load Earlier away. Never while a paging request owns the head. */
  const releasePrefix = useCallback((bandTop: number): void => {
    if (bandTop <= EVICT_MARGIN_NODES + EVICT_CHUNK_NODES) return
    if (loadingOlderRef.current || anchorRef.current !== null || evictAnchorRef.current !== null) return
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: the sample only runs while mounted. */
    if (local === null) return
    const cutKey = orderRef.current[bandTop - EVICT_MARGIN_NODES]
    if (cutKey === undefined || releasedKeyRef.current === cutKey) return
    const seq = nodeStoreRef.current.get(cutKey)?.anchorSeq
    if (seq === undefined) return
    const scrollport = scrollerOf(local)
    const row = pagingAnchor(local, scrollport)
    if (row === null || row.dataset.chatAnchorKey === undefined) return
    evictAnchorRef.current = { key: row.dataset.chatAnchorKey, top: flowTop(row, scrollport) }
    releasedKeyRef.current = cutKey
    evictBeforeRef.current(seq)
  }, [])

  // Compute liveKeys from the row at the viewport centre: a node-count band,
  // never an estimate. Reads refs because the scroll sample mounts once.
  const recomputeLiveKeys = useCallback(() => {
    // Suppress during prepend (Load Earlier) — liveKeys changes would swap
    // content↔spacer mid-prepend, changing scrollHeight and breaking anchor.
    if (loadingOlderRef.current || anchorRef.current !== null) return
    const local = listRef.current
    if (local === null) return
    const order = orderRef.current
    const scrollport = scrollerOf(local)
    if (typeof document.elementsFromPoint !== 'function') {
      // jsdom / no hit-testing: all nodes live.
      markWoke(new Set(order))
      setLiveKeys(new Set(order))
      return
    }
    const rect = scrollport.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    // The centred row must be one the reader can see: the composer overlays the
    // bottom of the scrollport, so the centre is clamped above its top edge.
    const composer = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
    const composerTop = composer?.getBoundingClientRect().top
    const visibleBottom = composerTop === undefined ? rect.bottom : Math.min(rect.bottom, composerTop)
    const cy = Math.min(rect.top + rect.height / 2, visibleBottom - 1)
    // Walk through all elements at this point (topmost-first). Overlays like
    // the to-bottom button may be first, so check each for a row ancestor.
    let centeredKey: string | null = null
    for (const el of document.elementsFromPoint(cx, cy)) {
      if (!(el instanceof HTMLElement)) continue
      const anchor = el.closest<HTMLElement>('[data-chat-flow-key]')
      if (anchor !== null && local.contains(anchor)) {
        centeredKey = anchor.dataset.chatFlowKey ?? null
        break
      }
    }
    // Fallback: rows are in document order, so binary-search the one whose
    // band contains the centre. Bounded at log(rows) rect reads.
    if (centeredKey === null) {
      const rows = local.querySelectorAll<HTMLElement>('[data-chat-flow-key]')
      let lo = 0
      let hi = rows.length - 1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        const row = rows[mid]
        if (row === undefined) break
        const r = row.getBoundingClientRect()
        if (r.bottom < cy) lo = mid + 1
        else if (r.top > cy) hi = mid - 1
        else {
          centeredKey = row.dataset.chatFlowKey ?? null
          break
        }
      }
    }
    if (centeredKey === null) {
      // No hit — keep previous liveKeys (don't overwrite with empty).
      return
    }
    const centeredIndex = order.indexOf(centeredKey)
    if (centeredIndex < 0) return
    // Band of LIVE_BAND_NODES rows on each side of the centred row: a hundred
    // and fifty above and a hundred and fifty below, so the live set is at
    // most three hundred rows.
    const half = LIVE_BAND_NODES
    const start = Math.max(0, centeredIndex - half)
    const end = Math.min(order.length, centeredIndex + half + 1)
    const next = new Set(order.slice(start, end))
    // The newest rows are pinned: the streaming output and the turn tail stay
    // mounted even when the reader is parked far away in history.
    for (const key of order.slice(Math.max(0, order.length - PIN_TAIL_NODES))) {
      next.add(key)
    }
    // A band step must never take content from under the reader: the viewport is
    // admitted by its own path, so every committed set contains it. Without this
    // a sample would drop the rows the fling just admitted and re-admit them a
    // tick later, churning mounts at the sample cadence.
    for (const key of visibleRowKeys(local, scrollport)) next.add(key)
    if (next.size === 0 && order.length > 0) {
      markWoke(new Set(order))
      setLiveKeys(new Set(order))
      return
    }
    // Measure before the swap: the leaving rows still render their content, so
    // each spacer reserves the height that row actually had.
    const leaving = new Set<string>()
    for (const key of liveKeysRef.current) if (!next.has(key)) leaving.add(key)
    // A row that sleeps forgets its wake: the marker only holds for the live
    // stint it was swept into. Clearing it while the row is *live* would be a
    // bug — the suppression rule would stop matching and the rise would start
    // late instead of being skipped.
    for (const key of leaving) wokeKeysRef.current.delete(key)
    if (leaving.size > 0) {
      for (const row of local.querySelectorAll<HTMLElement>('[data-chat-flow-key]')) {
        const key = row.dataset.chatFlowKey
        if (key === undefined || !leaving.has(key)) continue
        rowHeightsRef.current.set(key, measureContentBox(row))
      }
    }
    markWoke(next)
    setLiveKeys((prev) => {
      if (prev.size === next.size && [...next].every(k => prev.has(k))) return prev
      return next
    })
    // Far above the band the retained window stops paying for itself: release it
    // and let Load Earlier bring it back.
    releasePrefix(start)
  }, [markWoke, releasePrefix])
  const stopFollow = (): void => {
    followHandleRef.current?.stop()
    followHandleRef.current = null
  }

  /** Carry the scrollport to its floor. A follow already in flight keeps
   *  chasing — it re-reads the floor every frame, so restarting would only
   *  cancel and reschedule the same frame. */
  const followFloor = (el: HTMLElement): void => {
    if (followHandleRef.current !== null) return
    const slot: { settled: boolean; handle: FollowHandle | null } = { settled: false, handle: null }
    slot.handle = followScrollport(
      el,
      (top) => { observedTopRef.current = top },
      () => {
        slot.settled = true
        if (followHandleRef.current === slot.handle) followHandleRef.current = null
      },
    )
    // A runtime that settles inside the call (reduced motion, no frames) has
    // already finished, so it must not keep the slot occupied.
    followHandleRef.current = slot.settled ? null : slot.handle
  }

  /** `immediate` is for restores — the reader's own place, not a follow. */
  const toBottom = (el: HTMLElement, immediate = false): void => {
    anchorRef.current = null
    if (immediate) {
      stopFollow()
      el.scrollTop = el.scrollHeight
      observedTopRef.current = el.scrollTop
    } else {
      followFloor(el)
    }
    atBottomRef.current = true
    setAtBottom(true)
    chatScroll.save(null)
  }


  useLayoutEffect(() => {
    if (scrollSamplePendingRef.current) return
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: React attaches the ref before layout effects run. */
    if (local === null) return
    const el = scrollerOf(local)
    // A remembered height is only valid at the width and font it was measured
    // under. A mismatch drops the snapshot and remeasures on the next pass
    // rather than restoring into a flow whose height is wrong.
    const column = columnRef.current
    if (column !== null && heightStampRef.current !== null) {
      const stamp = stampOf(column)
      if (stamp !== heightStampRef.current) {
        heightStampRef.current = null
        chatHeights.save(null)
        setLiveKeys(new Set(orderRef.current))
        return
      }
    }
    // A released prefix raises the head exactly like a prepend lowers it, and
    // the reader's row keeps its place either way. The eviction pass never
    // re-arms the anchor: there is no next chunk to wait for.
    if (evictAnchorRef.current !== null) {
      const anchor = evictAnchorRef.current
      evictAnchorRef.current = null
      if (firstSeq !== null && firstSeq !== firstSeqRef.current) {
        releasedKeyRef.current = null
        stopFollow()
        const row = anchorElement(local, anchor.key)
        if (row !== null) el.scrollTop += flowTop(row, el) - anchor.top
        observedTopRef.current = el.scrollTop
        // A release must never leave the live set pointing only at rows it
        // removed: then every shell is dormant and the flow renders nothing.
        const live = liveKeysRef.current
        if (live.size > 0 && !orderRef.current.some(key => live.has(key))) {
          setLiveKeys(new Set(orderRef.current))
        }
      }
    }
    // Open completed: jump to the bottom once — unless a scroll position
    // survives from a previous mount (view-tab switch away and back), which
    // is restored instead of snapping the reader back to the floor.
    if (openState === 'open' && !openedRef.current) {
      openedRef.current = true
      const saved = chatScroll.read()
      if (saved === null) {
        // Nothing to glide from: the transcript opens already at its floor.
        toBottom(el, true)
      } else {
        stopFollow()
        el.scrollTop = saved.scrollTop
        const row = anchorElement(local, saved.anchorKey)
        if (row !== null) el.scrollTop += flowTop(row, el) - saved.anchorTop
        observedTopRef.current = el.scrollTop
        const isAtBottom = tailEndVisible(local, el, Math.max(0, el.scrollHeight - el.clientHeight))
        atBottomRef.current = isAtBottom
        setAtBottom(isAtBottom)
        const normalized = isAtBottom ? null : scrollPosition(local, el)
        if (isAtBottom) chatScroll.save(null)
        else if (normalized !== null) chatScroll.save(normalized)
      }
      firstSeqRef.current = firstSeq
      lastKeyRef.current = lastKey
      lastSteeringIdRef.current = lastSteeringId
      lastSubmissionIdRef.current = lastSubmissionId
      followSigRef.current = followSig
      return
    }
    // Prepend (head seq decreased): preserve the same settled row at the
    // position established by the reader's latest scroll. This excludes
    // unrelated tail/composer growth while the request was in flight.
    if (anchorRef.current !== null && firstSeq !== null && firstSeqRef.current !== null && firstSeq < firstSeqRef.current) {
      const anchor = anchorRef.current
      anchorRef.current = null
      stopFollow()
      const row = anchorElement(local, anchor.key)
      if (row !== null) el.scrollTop += flowTop(row, el) - anchor.top
      observedTopRef.current = el.scrollTop
      // A jump chunk lands here: scroll to the target once its rows exist;
      // until then keep holding the reader's row for the next chunk.
      if (row !== null) anchorRef.current = { key: anchor.key, top: flowTop(row, el) }
      firstSeqRef.current = firstSeq
      /* v8 ignore next -- ?? arm: a prepend adds nodes, so the flow list here is never empty. */
      lastKeyRef.current = lastKey
      lastSteeringIdRef.current = lastSteeringId
      lastSubmissionIdRef.current = lastSubmissionId
      followSigRef.current = followSig
      return
    }
    firstSeqRef.current = firstSeq
    // Own words must be visible: a new trailing user node force-scrolls
    // (send lives in the composer, so arrival is detected here, not armed there).
    const appendedUser = lastKey !== lastKeyRef.current && lastNode?.kind === 'user'
    const appendedSteering = lastSteeringId !== null && lastSteeringId !== lastSteeringIdRef.current
    const appendedSubmission = lastSubmissionId !== null && lastSubmissionId !== lastSubmissionIdRef.current
    const tipMoved = followSigRef.current !== followSig
    lastKeyRef.current = lastKey
    lastSteeringIdRef.current = lastSteeringId
    lastSubmissionIdRef.current = lastSubmissionId
    followSigRef.current = followSig
    // Follow new flow content while pinned; do NOT re-pin on every render
    // merely because atBottomRef is true (scroll threshold → setState → snap).
    if (appendedUser || appendedSteering || appendedSubmission || (tipMoved && atBottomRef.current)) {
      toBottom(el)
      return
    }
  })

  /** Remember this session's measured heights, pruned to rows still in the flow,
   *  so the next open can reserve them without mounting anything. */
  const saveHeights = useCallback((): void => {
    const column = columnRef.current
    if (column !== null) heightStampRef.current = stampOf(column)
    const stamp = heightStampRef.current
    if (stamp === null) return
    // Every measured height is kept, including the rows an eviction released:
    // a number per node is what makes paging them back exact and mount-free.
    const heights = new Map<string, number>()
    for (const [key, height] of rowHeightsRef.current) if (height > 0) heights.set(key, height)
    if (heights.size === 0) return
    chatHeights.save({ heights, stamp })
  }, [chatHeights])
  // After every band sample, and once more on unmount — a view-tab switch is the
  // moment measurements would otherwise be lost.
  useEffect(() => { saveHeights() }, [liveKeys, saveHeights])
  useEffect(() => () => saveHeights(), [saveHeights])

  // New arrivals join the live set until the next scroll sample narrows the
  // band around the centered key (recomputeLiveKeys runs on scroll sample,
  // so this effect never widens what a scroll just narrowed).
  // Keys the flow has ever been told about. A warm open starts with only its band
  // live, so the dormant rows must not read as arrivals; only keys that appear
  // after the first render join the live set.
  const knownKeysRef = useRef(new Set(order))
  useEffect(() => {
    const fresh = order.filter(key => !knownKeysRef.current.has(key))
    if (fresh.length === 0) return
    for (const key of fresh) knownKeysRef.current.add(key)
    setLiveKeys((prev) => {
      const next = new Set(prev)
      for (const key of fresh) next.add(key)
      return next
    })
  }, [order])

  const onScrollRef = useRef(() => {})
  onScrollRef.current = () => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: the handler only fires while mounted. */
    if (local === null) return
    const el = scrollerOf(local)
    // Only reader input may make raw scroll geometry change follow ownership:
    // a delivered position that deviates from the observed-top ledger (every
    // programmatic write records itself there synchronously). This covers
    // wheel, touch, scrollbar, and keyboard alike without naming devices.
    // Browser shrink-clamps land exactly on the floor min and delayed
    // programmatic deliveries land on the ledger itself, so both preserve
    // the current ownership state.
    const floor = Math.max(0, el.scrollHeight - el.clientHeight)
    const movedByReader = readerMovedScroll(el.scrollTop, floor, observedTopRef.current)
    // The reader owns the position again from the first frame they move it.
    if (movedByReader) stopFollow()
    const isAtBottom = movedByReader
      ? tailEndVisible(local, el, floor)
      : atBottomRef.current
    if (!movedByReader && isAtBottom) {
      // A follow in flight already owns the floor; re-pinning here would only
      // re-save the same position on every animated frame.
      if (followHandleRef.current === null) toBottom(el)
      return
    }
    atBottomRef.current = isAtBottom
    setAtBottom(isAtBottom)
    const position = isAtBottom ? null : scrollPosition(local, el)
    if (isAtBottom) {
      anchorRef.current = null
    } else if (anchorRef.current !== null && position !== null) {
      anchorRef.current = { key: position.anchorKey, top: position.anchorTop }
    }
    // Continuous save (unmount happens after ref detach, so saving there is
    // too late); pinned-to-bottom clears so a remount keeps following.
    if (isAtBottom) chatScroll.save(null)
    else if (position !== null) chatScroll.save(position)
    observedTopRef.current = el.scrollTop
  }

  // Non-reader pinned deliveries must settle before layout growth invalidates
  // their floor. Reader movement stays pending even inside the follow threshold,
  // so growth cannot erase small gestures before they accumulate off the floor.
  useEffect(() => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: effect runs after the list node commits. */
    if (local === null) return
    const el = scrollerOf(local)
    let sampleTimer: number | undefined
    const sample = (): void => {
      if (!scrollSamplePendingRef.current) return
      scrollSamplePendingRef.current = false
      if (sampleTimer !== undefined) window.clearTimeout(sampleTimer)
      sampleTimer = undefined
      // The sampled pass publishes through setAtBottom/setActiveTurn; no
      // blank slate re-render rides the sample cadence anymore.
      onScrollRef.current()
      recomputeLiveKeys()
    }
    const onScroll = (): void => {
      // The urgent path first: rows the reader can see must not wait for the
      // current sample. At the floor the pinned tail is already live, so only a
      // reader parked away from it can be looking at a spacer — and a pinned
      // delivery must not read row geometry.
      if (!atBottomRef.current) {
        admitAgainRef.current = false
        scheduleAdmit()
      }
      scrollSamplePendingRef.current = true
      if (atBottomRef.current) {
        // A follow in flight records every write it makes into the ledger, so a
        // position that still matches it is ours. Measuring the floor here would
        // force a synchronous layout on every animated frame of a stream.
        if (followHandleRef.current !== null && el.scrollTop === observedTopRef.current) return
        const floor = Math.max(0, el.scrollHeight - el.clientHeight)
        if (!readerMovedScroll(el.scrollTop, floor, observedTopRef.current)) {
          sample()
          return
        }
      }
      sampleTimer ??= window.setTimeout(sample, SCROLL_SAMPLE_INTERVAL_MS)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('scrollend', sample, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('scrollend', sample)
      stopFollow()
      if (sampleTimer !== undefined) window.clearTimeout(sampleTimer)
      if (admitFrameRef.current !== null) {
        window.cancelAnimationFrame(admitFrameRef.current)
        admitFrameRef.current = null
      }
      admitAgainRef.current = false
      scrollSamplePendingRef.current = false
    }
  }, [])

  // The ref starts null and is assigned every render, so the placeholder
  // initializer a function initial value would need never exists.
  const observerFollowRef = useRef<(() => void) | null>(null)
  observerFollowRef.current = () => {
    if (scrollSamplePendingRef.current) return
    const local = listRef.current
    if (local !== null && atBottomRef.current) {
      followFloor(scrollerOf(local))
      chatScroll.save(null)
    }
  }
  // Streaming, tool disclosures, and other flow changes resize the column;
  // the sticky composer resizes outside it. This observer owns ChatView's
  // dynamic-height follow decisions and writes only while the reader is pinned.
  useEffect(() => {
    const column = columnRef.current
    const local = listRef.current
    if (column === null || local === null || typeof ResizeObserver === 'undefined') return
    const scrollport = scrollerOf(local)
    const composer = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
    // Flow-height changes (image loads, tool disclosures) move rows across the
    // reading line without a scroll event, so the active mark resyncs here too.
    const observer = new ResizeObserver(() => {
      observerFollowRef.current?.()
    })
    observer.observe(column)
    if (composer !== null) observer.observe(composer)
    return () => { observer.disconnect() }
  }, [])

  // A failed/empty page leaves the head unchanged. Once the request leaves
  // its busy state there is no future prepend for the saved anchor to own.
  useEffect(() => {
    if (!loadingOlder) anchorRef.current = null
  }, [loadingOlder])


  const loadOlderAnchored = (): void => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: the paging button renders inside the list tree. */
    if (local !== null) {
      const el = scrollerOf(local)
      const row = pagingAnchor(local, el)
      if (row !== null && row.dataset.chatAnchorKey !== undefined) {
        anchorRef.current = {
          key: row.dataset.chatAnchorKey,
          top: flowTop(row, el),
        }
      }
      // Paging deeper into history is leaving the live tail (a session whose
      // loaded page fits the viewport is at its top and bottom at once):
      // release bottom ownership BEFORE the prepend grows the column, or a
      // pinned follow snaps the reader to the latest message and the new
      // page's rows never wake.
      atBottomRef.current = false
      stopFollow()
      setAtBottom(false)
    }
    loadOlder()
  }

  return (
    <div className={css.root}>
      <div ref={listRef} className={css.scroll} data-chat-window-root="">
        <div ref={columnRef} className={css.column} data-chat-flow="">
          {openState === 'error' && openError !== null && (
            <div className={css.openError}>
              {t('chat.loadError', { message: openError.message, code: openError.code })}
            </div>
          )}
          {hasMore && (
            <div className={css.older}>
              <button type="button" disabled={loadingOlder} onClick={loadOlderAnchored}>
                {loadingOlder ? t('loading') : t('chat.loadOlder')}
              </button>
            </div>
          )}
          <ChatNodeList
            order={order}
            liveKeys={effectiveLiveKeys}
            wokeKeys={wokeKeysRef.current}
            heights={rowHeightsRef}
            useChatNode={useChatNode}
            cwd={cwd}
            openFile={requestOpenFile}
            openSkill={openSkill}
            inspectCall={inspectCall}
            revealFile={revealFile}
            forkAt={forkAt}
            loadImage={loadImage}
            renderMessageImages={renderMessageImages}
            fileMentions={fileMentions}
            renderSlot={renderSlot}
            t={t}
          />
          {/* No pending placeholders: questions (ui-user-questions) and approvals
              (ApprovalPanel) both take over the composer, so a flow card would
              double-render the same wait. */}
          {/* The running turn shows on the composer's sweep line, not as a row here. */}
          {pendingSteering.map(item => (
            <PendingSteeringBubble
              key={item.id}
              content={item.content}
              renderMessageImages={renderMessageImages}
              t={t}
            />
          ))}
          {visibleSubmissions.map(submission => (
            <PendingSubmissionBubble
              key={submission.requestId}
              submission={submission}
              renderMessageImages={renderMessageImages}
              t={t}
            />
          ))}
        </div>
        {!atBottom && (
          <div className={css.toBottomSlot}>
            <button
              type="button"
              className={css.toBottom}
              aria-label={t('chat.toBottom')}
              onClick={() => {
                const local = listRef.current
                /* v8 ignore next -- ref-null guard: the button only renders alongside the mounted list. */
                if (local !== null) toBottom(scrollerOf(local))
              }}
            >
              <IconChevronDownOutline14 />
            </button>
          </div>
        )}
      </div>
      {fileOpenError !== null && (
        <FileOpenErrorDialog
          message={fileOpenError.message}
          busy={fileOpenBusy}
          onClose={closeFileOpenError}
          onRetry={() => { requestOpenFile(fileOpenError.path) }}
          t={t}
        />
      )}
    </div>
  )
}

/** In-page Host open-path refusal: the wire reason plus a retry of the same path. */
function FileOpenErrorDialog({
  message, busy, onClose, onRetry, t,
}: {
  message: string
  busy: boolean
  onClose: () => void
  onRetry: () => void
  t: ChatViewSlotProps['t']
}) {
  return (
    <Modal
      open
      onClose={onClose}
      closeLabel={t('close')}
      title={t('fileOpen.title')}
      description={message}
      footer={(
        <>
          <Button variant="outline" className={css.modalAction} onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" className={css.modalAction} disabled={busy} onClick={onRetry}>{t('retry')}</Button>
        </>
      )}
    />
  )
}
