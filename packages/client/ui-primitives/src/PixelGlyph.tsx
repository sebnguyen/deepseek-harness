import { PIXEL_SYMBOLS, PIXEL_SYMBOL_GAP_CSS, type PixelSymbolName } from './pixel-symbols/symbols.ts'
import type { IconProps } from './icons/props.ts'

/** Props for {@link PixelGlyph}; `name` selects one of the minted symbols. */
export interface PixelGlyphProps extends IconProps {
  /** Symbol to draw, e.g. `bash`, `read`, `model-provider`. */
  name: PixelSymbolName
  /** Square edge in px; the symbol's own viewBox scales to it. */
  size?: number | undefined
}

/**
 * One of the design's pixel symbols, drawn inline so it inherits the host's
 * `color`. The artwork is a 16-grid of full cells; the 30% gap comes from
 * {@link PIXEL_SYMBOL_GAP_CSS}, which clips each cell, so geometry stays
 * full-cell and the gap stays one stylesheet value.
 * @param props.name - symbol name from the generated catalog.
 * @param props.size - square edge in px.
 * @returns the symbol as an aria-hidden svg.
 */
export function PixelGlyph({ name, size = 16, className }: PixelGlyphProps) {
  const symbol = PIXEL_SYMBOLS[name]
  return (
    <svg
      width={size}
      height={size}
      viewBox={symbol.viewBox}
      className={className}
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
      data-glyph={name}
    >
      <style>{PIXEL_SYMBOL_GAP_CSS}</style>
      <g dangerouslySetInnerHTML={{ __html: symbol.body }} />
    </svg>
  )
}
