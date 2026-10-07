import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

const FOLD_MS = 170

/** Animations require a real browser media query; test DOMs hide instantly. */
function animated(): boolean {
  return typeof window.matchMedia === 'function'
    /* v8 ignore next -- reduced-motion query only reached in real browsers */
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Glide a fold member between open and closed height so the transcript
 * column reflows with the fade instead of snapping at the hide handoff.
 * @param el - the seat to animate.
 * @param out - true collapses to zero height, false grows to natural height.
 * @param done - called once the collapse glide finishes.
 * @returns the running animation, or undefined without WAAPI support.
 */
function glide(el: HTMLElement, out: boolean, done?: () => void): Animation | undefined {
  if (typeof el.animate !== 'function') return undefined
  /* v8 ignore start -- Element.animate exists only in real browsers; jsdom
     takes the guard above and the web e2e lane pins the motion. */
  const style = getComputedStyle(el)
  const natural = { height: style.height, marginTop: style.marginTop, opacity: '1' }
  const shut = { height: '0px', marginTop: '0px', opacity: '0' }
  el.style.overflow = 'hidden'
  const animation = el.animate(out ? [natural, shut] : [shut, natural], {
    duration: FOLD_MS,
    easing: 'ease',
  })
  animation.onfinish = () => {
    el.style.overflow = ''
    done?.()
  }
  return animation
  /* v8 ignore stop */
}

/**
 * Reveal/hide for fold members that keeps the subtree mounted: each seat
 * glides height and margin beside opacity, expansion starting from the
 * closed box and collapse ending at it, and only a finished collapse hands
 * the row to `hidden="until-found"`. Browser find keeps reaching folded
 * rows, and the column reflows with the fold instead of snapping when the
 * shell hide lands.
 * @param hidden - whether the row belongs to a closed fold right now.
 * @param reveal - callback that reopens the fold (search beforematch).
 * @returns the wrapper ref plus whether the shell hide currently applies.
 */
export function useFoldedHidden(
  hidden: boolean,
  reveal: () => void,
): { readonly ref: RefObject<HTMLDivElement>; readonly shellHidden: boolean } {
  const [shellHidden, setShellHidden] = useState(hidden)
  const shellRef = useRef(shellHidden)
  shellRef.current = shellHidden
  const ref = useRef<HTMLDivElement>(null)
  const glideRef = useRef<Animation | null>(null)
  const firstRef = useRef(true)
  const prevRef = useRef(hidden)
  useEffect(() => {
    const element = ref.current
    if (element === null) return undefined
    element.addEventListener('beforematch', reveal)
    return () => { element.removeEventListener('beforematch', reveal) }
  }, [reveal])
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const changed = firstRef.current || prevRef.current !== hidden
    firstRef.current = false
    prevRef.current = hidden
    // State-sync reruns after a glide handoff carry no new direction.
    if (!changed) return
    glideRef.current?.cancel()
    glideRef.current = null
    const apply = () => {
      if (hidden) el.setAttribute('hidden', 'until-found')
      else el.removeAttribute('hidden')
      setShellHidden(hidden)
    }
    // A collapse that would steal keyboard focus reopens the fold instead.
    if (hidden && el.contains(el.ownerDocument.activeElement)) {
      reveal()
      return
    }
    if (!animated()) {
      apply()
      return
    }
    /* v8 ignore start -- fold glide scheduling needs matchMedia plus WAAPI;
       test DOMs take the instant arms above. */
    if (hidden) {
      if (shellRef.current) {
        // Mounts and state syncs carry no crossing; the shell must still own
        // the attribute the glide would otherwise leave to its finish.
        el.setAttribute('hidden', 'until-found')
        return
      }
      const animation = glide(el, true, apply)
      if (animation === undefined) apply()
      else glideRef.current = animation
    } else {
      el.removeAttribute('hidden')
      if (!shellRef.current) return
      setShellHidden(false)
      glideRef.current = glide(el, false) ?? null
    }
    /* v8 ignore stop */
  }, [hidden, reveal])
  useEffect(() => () => { glideRef.current?.cancel() }, [])
  return { ref, shellHidden }
}
