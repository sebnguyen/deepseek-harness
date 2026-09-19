import type { RefObject } from 'react'
import { supportsHighlighting } from './highlight.ts'
import { useViewportActivation } from './useViewportActivation.ts'

/**
 * Activate one supported code surface when it first intersects the viewport.
 * Activation lasts for the component lifetime; browsers without
 * IntersectionObserver activate immediately.
 * @param target - Code surface whose plain rendering reserves its geometry.
 * @param lang - Optional language hint.
 * @returns Whether this component may build highlighted output.
 */
export function useViewportHighlighting(
  target: RefObject<Element>,
  lang: string | undefined,
): boolean {
  const supported = supportsHighlighting(lang)
  const activated = useViewportActivation(target, supported)
  return activated && supported
}
