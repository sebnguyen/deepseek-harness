/**
 * Eased floor-follow for the chat scrollport.
 *
 * Only the *follow* write eases. Restoring a place the reader already chose —
 * a saved position, a prepend anchor, the first pin after mount — stays a
 * single synchronous assignment in ChatView, so nothing the reader decided
 * drifts underneath them. Every eased write is reported through `record`
 * because the caller keeps a ledger of its own deliveries to tell them apart
 * from reader input; an unreported frame would read as a wheel gesture and
 * hand scroll ownership to a reader who never moved.
 *
 * Two regimes, because the two shapes of growth want opposite motion: a stream
 * adds a few pixels per frame and wants to be chased (never restart, never
 * lag), while a jump — a disclosure opening, a message landing from far up —
 * wants a curve that leaves rest and arrives at rest.
 */

/** 60Hz frame, standing in for the delta a first rAF timestamp cannot supply. */
const FRAME_MS = 1_000 / 60
/** Chase constant: one 60Hz frame covers ~21% of the gap to the floor. */
const TAU_MS = 70
/** A gap at least this big is a jump, and jumps ride the house curve. */
const TWEEN_MIN_PX = 320
/** Tween duration: a short hop still feels deliberate, a long jump still lands. */
const TWEEN_MS_MIN = 240
const TWEEN_MS_MAX = 460
const TWEEN_MS_PER_PX = 0.06
/** Share of the scrollport one chased frame may cross, so growth that arrives
 *  mid-carry cannot lurch the reader. */
const STEP_SHARE = 0.35
/** Floor for that cap: a short scrollport should still move promptly. */
const MIN_STEP_PX = 64
/** Land exactly on the floor below this remainder rather than easing into it forever. */
const DONE_PX = 0.5

/** One axis of a cubic bezier at curve parameter `t`. */
function bezierAxis(a: number, b: number, t: number): number {
  const rest = 1 - t
  return 3 * rest * rest * t * a + 3 * rest * t * t * b + t * t * t
}

/** The house curve `--ds-ease-in-out` — cubic-bezier(0.4, 0, 0.2, 1) — solved
 *  for y, so an eased scroll moves on the same curve as every other surface. */
function houseEase(x: number): number {
  let low = 0
  let high = 1
  let t = x
  for (let guard = 0; guard < 12; guard += 1) {
    const guess = bezierAxis(0.4, 0.2, t)
    if (Math.abs(guess - x) < 1e-4) break
    if (guess < x) low = t
    else high = t
    t = (low + high) / 2
  }
  return bezierAxis(0, 1, t)
}

/** Motion opt-out, matching the ui-attachment scroll precedent: a runtime with
 *  no matchMedia (jsdom) keeps the ease on, an explicit reduce turns it off. */
export function prefersReducedMotion(): boolean {
  const matchMedia = (globalThis as unknown as { matchMedia?: Window['matchMedia'] }).matchMedia
  return typeof matchMedia === 'function'
    && matchMedia.call(globalThis, '(prefers-reduced-motion: reduce)').matches
}

export interface FollowHandle {
  /** Stop carrying the scrollport; the position stays where the last frame left it. */
  stop(): void
}

/**
 * Carry `el` to its floor on the house curve. The floor is re-read every frame,
 * so a growing tail is tracked rather than over-shot, and the final write is
 * the exact `scrollHeight` the un-eased write would have used — the animation
 * changes *when* the scrollport arrives, never where.
 */
export function followScrollport(
  el: HTMLElement,
  record: (top: number) => void,
  onSettled: () => void,
): FollowHandle {
  const animate = (globalThis as unknown as { requestAnimationFrame?: unknown }).requestAnimationFrame
  const start = el.scrollTop
  const gap = Math.abs(Math.max(0, el.scrollHeight - el.clientHeight) - start)
  const span = gap > TWEEN_MIN_PX
    ? Math.min(TWEEN_MS_MAX, TWEEN_MS_MIN + gap * TWEEN_MS_PER_PX)
    : 0
  let frame = 0
  let previous = -1
  let origin = -1

  const write = (top: number): void => {
    el.scrollTop = top
    record(el.scrollTop)
  }
  /** The last write is the un-eased one: exact, and safe to assert on. */
  const settle = (): void => {
    frame = 0
    write(el.scrollHeight)
    onSettled()
  }
  const tick = (now: number): void => {
    frame = 0
    const floor = Math.max(0, el.scrollHeight - el.clientHeight)
    const from = el.scrollTop
    if (Math.abs(floor - from) <= DONE_PX) {
      settle()
      return
    }
    if (span > 0) {
      // The first frame already represents the interval since the carry began,
      // so the curve leaves rest on that frame instead of burning one at zero.
      if (origin < 0) origin = now - FRAME_MS
      const progress = (now - origin) / span
      if (progress >= 1) {
        settle()
        return
      }
      write(start + (floor - start) * houseEase(progress))
      frame = requestAnimationFrame(tick)
      return
    }
    // A repeated timestamp (a throttled tab, a stalled compositor) still has to
    // make progress, so the delta is clamped from both ends.
    const elapsed = previous < 0 ? FRAME_MS : Math.min(Math.max(now - previous, FRAME_MS / 2), FRAME_MS * 4)
    previous = now
    const cap = Math.max(MIN_STEP_PX, el.clientHeight * STEP_SHARE)
    const step = Math.min(Math.abs((floor - from) * (1 - Math.exp(-elapsed / TAU_MS))), cap)
    write(from + Math.sign(floor - from) * step)
    frame = requestAnimationFrame(tick)
  }

  if (animate === undefined || prefersReducedMotion()) settle()
  else frame = requestAnimationFrame(tick)

  return {
    stop: () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      frame = 0
    },
  }
}
