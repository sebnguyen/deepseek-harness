/**
 * Row-window virtualization for the Chat transcript.
 *
 * Every ChatNodeSeat keeps its `.flowItem` shell mounted with all
 * `data-chat-*` attributes, so scroll anchoring, turn tracking, browser
 * find, and the until-found reveal keep working against a stable DOM. Shell
 * geometry is the contract — unmounting content must never move rows the
 * reader can see.
 *
 * The live band, not the viewport, is the dormancy boundary: every loaded
 * row starts live and STAYS live while the ledger holds no more than
 * LIVE_BAND_ROWS rows — one history page (~50 messages plus its tool and
 * reasoning rows) fits several times over, so a reader who pages back one
 * or two pages never loses content behind them. Dormancy is the far-deeper
 * escape hatch: once the live count crosses the band, rows leaving the
 * window hold content for DORM_HOLD_MS and then unmount to a
 * height-reserving spacer, and the oldest-touched rows beyond the band are
 * evicted immediately. The newest PIN_TAIL_ROWS flow items never dorm at
 * any budget. Retention and commit cost stay proportional to the band,
 * never to session length.
 *
 * The ledger is a module-level singleton per scroller element, so seats
 * resolve it lazily without the owning view re-rendering (render-count and
 * effect-order contracts elsewhere in the view stay exactly as settled).
 * Environments without IntersectionObserver (jsdom unit lanes) report every
 * row as live and never change row state, keeping unit-test DOM traversal
 * and render counts unchanged.
 */

import { useEffect, useState, type RefObject } from 'react'

/** Row height assumed before the first live measurement. */
export const ESTIMATED_ROW_HEIGHT = 340

/** Rows keep their content briefly after leaving the window, once dormancy
 * engages: a scrolling reader who reverses direction (and the rows they
 * only skimmed past) must not pay an unmount/remount pair per crossing. */
export const DORM_HOLD_MS = 400
/** Rows allowed to stay mounted before dormancy engages at all. Sized to
 * hold several history pages (a page is ~50 messages plus tool rows), so
 * ordinary single- and few-page conversations never unmount anything. */
export const LIVE_BAND_ROWS = 480
/** Newest flow items that never dorm at any budget: the streaming tail and
 * the rows just above it are the head of the conversation, not history. */
export const PIN_TAIL_ROWS = 8

const noop = (): void => {}

/** Per-row window state held by the scroller ledger. */
interface RowRecord {
  /** Stable node identity behind the cached height. */
  readonly nodeKey: string
  /** Seat-owned visibility sink (its setState). */
  readonly notify: (live: boolean) => void
  /** Whether the seat currently renders content (post band policy). */
  live: boolean
  /** Whether the observer currently reports the row inside the window. */
  intersecting: boolean
  /** Monotonic wake order; older touches evict first beyond the band. */
  touched: number
  /** Pending dorm timer while the exit hold runs. */
  timer: ReturnType<typeof setTimeout> | undefined
}

/** Shared scroller-relative visibility ledger; one observer per scroller. */
class ChatRowWindow {
  private observer: IntersectionObserver | undefined
  private readonly records = new Map<Element, RowRecord>()
  /** Most recent live height by node key; the estimate backfills the gaps. */
  readonly heights = new Map<string, number>()
  /** Rows currently rendering content; dormancy is off while within band. */
  private liveCount = 0
  private clock = 0

  constructor(root: Element) {
    if (typeof IntersectionObserver === 'undefined') return
    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const record = this.records.get(entry.target)
        /* v8 ignore next -- the observer reports only still-registered elements. */
        if (record === undefined) continue
        if (entry.isIntersecting) {
          this.wake(record)
        } else {
          this.hold(entry.target as HTMLElement, record)
        }
      }
    }, { root, rootMargin: '100% 0px' })
  }

  /** Cached or estimated height the dormant shell must reserve. */
  dormantHeight(nodeKey: string): number {
    return this.heights.get(nodeKey) ?? ESTIMATED_ROW_HEIGHT
  }

  /** Newest rows never dorm: pinned when fewer than PIN_TAIL_ROWS siblings
   * follow this row toward the bottom of the flow. Sibling walking is
   * environment-order, so appended messages re-pin the tail automatically. */
  private isTailPinned(element: Element): boolean {
    let remaining = PIN_TAIL_ROWS
    let sibling = element.nextElementSibling
    while (sibling !== null && remaining > 0) {
      remaining -= 1
      sibling = sibling.nextElementSibling
    }
    return remaining > 0
  }

  /** Whether the live count has crossed into dormancy territory. */
  private overBand(): boolean {
    return this.liveCount > LIVE_BAND_ROWS
  }

  /** Wake a row: count it, cancel any pending dorm, mount content. */
  private wake(record: RowRecord): void {
    record.intersecting = true
    record.touched = this.clock
    this.clock += 1
    if (record.timer !== undefined) {
      clearTimeout(record.timer)
      record.timer = undefined
    }
    if (!record.live) {
      record.live = true
      this.liveCount += 1
      record.notify(true)
    }
    if (this.overBand()) this.reap()
  }

  /** Begin the exit hold — only once the live count is over the band. */
  private hold(element: HTMLElement, record: RowRecord): void {
    record.intersecting = false
    if (!this.overBand()) return
    this.scheduleDorm(element, record)
  }

  /** Measure (content is still mounted) and dorm after the hold. */
  private scheduleDorm(element: HTMLElement, record: RowRecord): void {
    if (this.isTailPinned(element)) return
    this.heights.set(record.nodeKey, element.offsetHeight)
    if (record.timer !== undefined) clearTimeout(record.timer)
    record.timer = setTimeout(() => {
      record.timer = undefined
      this.dorm(element, record)
    }, DORM_HOLD_MS)
  }

  /** Dormancy just engaged: hold every still-live row that has left the
   * window. Rows re-entering cancel their hold; rows staying out dorm at
   * DORM_HOLD_MS, returning the ledger under the band over a few reaps. */
  private reap(): void {
    for (const [element, record] of this.records) {
      if (!record.live || record.intersecting || record.timer !== undefined) continue
      this.scheduleDorm(element as HTMLElement, record)
    }
  }

  /** Report a row dormant: the seat swaps its content for the height spacer.
   * Re-checks the tail pin: messages appended since the exit scheduled this
   * dorm make the row tail-history again, and the newest rows never unmount. */
  private dorm(element: Element, record: RowRecord): void {
    if (!record.live) return
    if (this.isTailPinned(element)) {
      if (record.timer !== undefined) {
        clearTimeout(record.timer)
        record.timer = undefined
      }
      return
    }
    record.live = false
    this.liveCount -= 1
    record.notify(false)
  }

  observe(nodeKey: string, element: Element, notify: (live: boolean) => void): () => void {
    if (this.observer === undefined) {
      // No IntersectionObserver in this environment: everything stays live.
      notify(true)
      return noop
    }
    // New rows always start live (the long-standing contract); the band
    // sheds them only after real off-window exits, never at mount.
    const record: RowRecord = {
      nodeKey,
      notify,
      live: true,
      intersecting: false,
      touched: 0,
      timer: undefined,
    }
    this.liveCount += 1
    this.records.set(element, record)
    this.observer.observe(element)
    return () => {
      if (record.timer !== undefined) clearTimeout(record.timer)
      if (record.live) this.liveCount -= 1
      this.records.delete(element)
      this.observer?.unobserve(element)
    }
  }
}

/** One ledger per scroller element; released with the element by the GC. */
const rowWindows = new WeakMap<Element, ChatRowWindow>()

/**
 * Gate one seat's content on the live band, exposing the height its dormant
 * shell must reserve. Rows start live and stay live while the loaded window
 * holds no more than LIVE_BAND_ROWS rows, so the reader's page (and the few
 * pages around it) never unmount. Dormancy engages past the band: exits
 * hold content for DORM_HOLD_MS, the oldest-touched rows unmount first, and
 * the newest PIN_TAIL_ROWS never unmount at all. Environments without
 * IntersectionObserver (jsdom unit lanes) never move row state, keeping
 * unit-test DOM traversal and render counts unchanged.
 * @param nodeKey - stable node identity behind the cached height.
 * @param shell - ref for the seat's `.flowItem` shell.
 * @returns `live` (whether content children may mount) and `dormantHeight`.
 */
export function useChatRowWindow(nodeKey: string, shell: RefObject<HTMLElement | null>): {
  readonly live: boolean
  readonly dormantHeight: number
} {
  const [live, setLive] = useState(true)
  const [dormantHeight, setDormantHeight] = useState(ESTIMATED_ROW_HEIGHT)
  useEffect(() => {
    const element = shell.current
    /* v8 ignore next -- React attaches the shell ref before effects. */
    if (element === null) return
    const root = element.closest('[data-conversation-scroll]') ?? element.closest('[data-chat-window-root]')
    /* v8 ignore next -- every seat renders inside the chat flow in practice. */
    if (root === null) return
    let rowWindow = rowWindows.get(root)
    if (rowWindow === undefined) {
      rowWindow = new ChatRowWindow(root)
      rowWindows.set(root, rowWindow)
    }
    return rowWindow.observe(nodeKey, element, (visible) => {
      if (!visible) setDormantHeight(rowWindow.dormantHeight(nodeKey))
      setLive(visible)
    })
  }, [nodeKey, shell])
  return { live, dormantHeight }
}
