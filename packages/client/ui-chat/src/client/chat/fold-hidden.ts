import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { useSearchableHidden } from './searchable-hidden.ts'

const FOLD_MS = 170

/** Animations require a real browser media query; test DOMs hide instantly. */
function animated(): boolean {
  return typeof window.matchMedia === 'function'
    /* v8 ignore next -- reduced-motion query only reached in real browsers */
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Two-phase reveal/hide for fold members: expansion removes the shell and
 * slides the row in; collapse slides the row out first and only afterwards
 * hands it to `hidden="until-found"`, so both directions play wherever the
 * browser supports transitions at all.
 * @param hidden - whether the row belongs to a closed fold right now.
 * @param reveal - callback that reopens the fold (search beforematch).
 * @returns the wrapper ref plus the shell/fold-out attributes to render.
 */
export function useFoldedHidden(
  hidden: boolean,
  reveal: () => void,
): { readonly ref: RefObject<HTMLDivElement>; readonly shellHidden: boolean; readonly foldOut: boolean } {
  const [shellHidden, setShellHidden] = useState(hidden)
  const [foldOut, setFoldOut] = useState(false)
  useEffect(() => {
    if (!animated()) {
      setShellHidden(hidden)
      setFoldOut(false)
      return undefined
    }
    /* v8 ignore next 16 -- fold-out/slide-in scheduling needs a real browser
       (matchMedia + animation frames); test DOMs hide instantly above. */
    if (hidden) {
      setFoldOut(true)
      const id = window.setTimeout(() => { setShellHidden(true) }, FOLD_MS)
      return () => { window.clearTimeout(id) }
    }
    // Enter with the fold-out style still applied, then release it a frame
    // later so the transition has a visible starting point.
    setShellHidden(false)
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => { setFoldOut(false) })
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [hidden])
  const ref = useSearchableHidden(shellHidden, reveal)
  return { ref, shellHidden, foldOut }
}
