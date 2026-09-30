/**
 * Seat-height publication for the sticky composer seat, with the dock's
 * open/close height transition excluded from the broadcast cadence.
 * View chrome reads `--dsh-composer-height` (chat rails, trajectory
 * clearance) and `--dsh-conversation-viewport-height`; a naive ResizeObserver
 * rewrites both every frame of a drawer animation and re-solves those rails
 * per frame. While a height transition runs inside the seat, resizes are
 * suppressed and one final broadcast re-anchors the vars at the end.
 */

/**
 * Publish the seat and scrollport heights as CSS custom properties on the
 * scroll body, skipping the dock drawer's open/close animation frames.
 * @param seat - the sticky composer seat element.
 * @param scroller - the scroll body carrying the custom properties.
 * @returns disposer removing the observer and the transition listeners.
 */
export function syncSeatMetrics(seat: HTMLElement, scroller: HTMLElement): () => void {
  const write = (): void => {
    scroller.style.setProperty('--dsh-composer-height', `${seat.offsetHeight}px`)
    scroller.style.setProperty('--dsh-conversation-viewport-height', `${scroller.clientHeight}px`)
  }
  let animating = false
  const onTransitionRun = (event: TransitionEvent): void => {
    if (event.propertyName === 'height') animating = true
  }
  const onTransitionSettle = (event: TransitionEvent): void => {
    if (event.propertyName !== 'height') return
    animating = false
    write()
  }
  const observer = new ResizeObserver(() => {
    if (!animating) write()
  })
  observer.observe(seat)
  observer.observe(scroller)
  seat.addEventListener('transitionrun', onTransitionRun)
  seat.addEventListener('transitionend', onTransitionSettle)
  seat.addEventListener('transitioncancel', onTransitionSettle)
  return (): void => {
    observer.disconnect()
    seat.removeEventListener('transitionrun', onTransitionRun)
    seat.removeEventListener('transitionend', onTransitionSettle)
    seat.removeEventListener('transitioncancel', onTransitionSettle)
  }
}
