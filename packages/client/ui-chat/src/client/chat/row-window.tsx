/**
 * Row-window virtualization for the Chat transcript.
 *
 * Every ChatNodeSeat keeps its `.flowItem` shell mounted with all
 * `data-chat-*` attributes, so scroll anchoring, turn tracking, browser
 * find, and the until-found reveal keep working against a stable DOM. The
 * row's CONTENT only mounts while the shell intersects the owning scroller
 * (plus one viewport of overscan on each side); dormant shells render a
 * height-reserving spacer from the height measured at dormancy (or the
 * estimate before the first live sample). Shell geometry is the contract —
 * unmounting content must never move rows the reader can see.
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

const noop = (): void => {}

/** Shared scroller-relative visibility ledger; one observer per scroller. */
class ChatRowWindow {
  private observer: IntersectionObserver | undefined
  private readonly listeners = new Map<Element, (live: boolean) => void>()
  /** Most recent live height by node key; the estimate backfills the gaps. */
  readonly heights = new Map<string, number>()

  constructor(root: Element) {
    if (typeof IntersectionObserver === 'undefined') return
    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const listener = this.listeners.get(entry.target)
        /* v8 ignore next -- the observer reports only still-registered elements. */
        if (listener === undefined) continue
        listener(entry.isIntersecting)
      }
    }, { root, rootMargin: '100% 0px' })
  }

  /** Cached or estimated height the dormant shell must reserve. */
  dormantHeight(nodeKey: string): number {
    return this.heights.get(nodeKey) ?? ESTIMATED_ROW_HEIGHT
  }

  observe(nodeKey: string, element: Element, notify: (live: boolean) => void): () => void {
    if (this.observer === undefined) {
      // No IntersectionObserver in this environment: everything stays live.
      notify(true)
      return noop
    }
    const listener = (live: boolean): void => {
      if (!live) this.heights.set(nodeKey, (element as HTMLElement).offsetHeight)
      notify(live)
    }
    this.listeners.set(element, listener)
    this.observer.observe(element)
    return () => {
      this.listeners.delete(element)
      this.observer?.unobserve(element)
    }
  }
}

/** One ledger per scroller element; released with the element by the GC. */
const rowWindows = new WeakMap<Element, ChatRowWindow>()

/**
 * Gate one seat's content on viewport proximity, exposing the height its
 * dormant shell must reserve. The seat's local state starts live and only
 * moves on real visibility transitions; environments without
 * IntersectionObserver never move it at all — mount-commit work, render
 * counts, and jsdom geography stay exactly as the callers already knew them.
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
