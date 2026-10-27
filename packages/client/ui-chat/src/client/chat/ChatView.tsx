// An enclosing `[data-conversation-scroll]` owns scrolling when present;
// otherwise this view owns it. Each row subscribes to one stable node key.

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import type { RenderMessageImages } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { Button, IconChevronDownOutline14, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps, OpenFileOptions } from '../contract/slots.ts'
import type { ChatSnapshot } from '../contract/snapshot.ts'
import { PendingSteeringBubble, PendingSubmissionBubble } from './MessageItem.tsx'
import { ChatNodeSeat, measureContentBox } from './ChatNodeSeat.tsx'
import css from './ChatView.module.css'
import { followScrollport, type FollowHandle } from './follow-scroll.ts'

const FOLLOW_THRESHOLD = 24
const SCROLL_SAMPLE_INTERVAL_MS = 500
/** Live band: rows kept rendered on each side of the row at the viewport
 *  centre. A hundred and fifty rows above and a hundred and fifty below is
 *  at most 301 live rows. A node count, never a pixel estimate — every row
 *  outside the band holds a measured spacer instead of its content. */
const LIVE_BAND_NODES = 150
/** The newest rows stay live whatever the reader looks at. They are the only
 *  rows that change on their own — the streaming output and the turn tail —
 *  so a reader parked in history must not unmount them: a remount restarts
 *  the tail's count-up and reads as a flicker. */
const PIN_TAIL_NODES = 8

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

type ChatNodeListProps = Omit<ComponentProps<typeof ChatNodeSeat>, 'nodeKey' | 'live'> & {
  readonly order: readonly string[]
  readonly liveKeys: ReadonlySet<string>
}

const ChatNodeList = memo(function ChatNodeList({ order, liveKeys, ...seatProps }: ChatNodeListProps) {
  return order.map(nodeKey => (
    <ChatNodeSeat key={nodeKey} nodeKey={nodeKey} live={liveKeys.has(nodeKey)} {...seatProps} />
  ))
})

/**
 * The chat view slot entry: pure component over the composed props; each
 * ordered business Node crosses the keyed renderer seat.
 */
export function ChatView({
  useSession, useChat, useChatNode, useSessions, renderSlot,
  sessionId, openFile, openSkill, loadOlder, loadImage, openView, chatScroll, forkAt,
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
  const [liveKeys, setLiveKeys] = useState<Set<string>>(() => new Set(order))
  // The scroll-sample effect mounts once, so every input the band computation
  // reads is mirrored into a ref instead of closed over a mount-time value.
  const orderRef = useRef<readonly string[]>(order)
  orderRef.current = order
  const liveKeysRef = useRef<ReadonlySet<string>>(liveKeys)
  liveKeysRef.current = liveKeys
  const loadingOlderRef = useRef(loadingOlder)
  loadingOlderRef.current = loadingOlder
  // Measured content heights keyed by node: the only thing a dormant row
  // reserves. Written when a row mounts and when it leaves the live band.
  const rowHeightsRef = useRef(new Map<string, number>())
  const scrollSamplePendingRef = useRef(false)

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
      setLiveKeys(new Set(order))
      return
    }
    const rect = scrollport.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
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
    if (next.size === 0 && order.length > 0) {
      setLiveKeys(new Set(order))
      return
    }
    // Measure before the swap: the leaving rows still render their content, so
    // each spacer reserves the height that row actually had.
    const leaving = new Set<string>()
    for (const key of liveKeysRef.current) if (!next.has(key)) leaving.add(key)
    if (leaving.size > 0) {
      for (const row of local.querySelectorAll<HTMLElement>('[data-chat-flow-key]')) {
        const key = row.dataset.chatFlowKey
        if (key === undefined || !leaving.has(key)) continue
        rowHeightsRef.current.set(key, measureContentBox(row))
      }
    }
    setLiveKeys((prev) => {
      if (prev.size === next.size && [...next].every(k => prev.has(k))) return prev
      return next
    })
  }, [])
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
        const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD + 1
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

  // New arrivals join the live set until the next scroll sample narrows the
  // band around the centered key (recomputeLiveKeys runs on scroll sample,
  // so this effect never widens what a scroll just narrowed).
  useEffect(() => {
    setLiveKeys((prev) => {
      const missing = order.filter(k => !prev.has(k))
      if (missing.length === 0) return prev
      const next = new Set(prev)
      for (const k of missing) next.add(k)
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
      ? floor - el.scrollTop <= FOLLOW_THRESHOLD + 1
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
      // blank slate re-render rides the 500ms cadence anymore.
      onScrollRef.current()
      recomputeLiveKeys()
    }
    const onScroll = (): void => {
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
          {openState === 'loading' && <div className={css.hint}>{t('chat.loadingHistory')}</div>}
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
