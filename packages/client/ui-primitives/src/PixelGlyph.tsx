import { PIXEL_SYMBOLS, type PixelSymbolName } from './pixel-symbols/symbols.ts'
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
 * `color`. The artwork is a 16-grid of cells with the same gap as the DO mark;
 * it renders with the browser's default shape-rendering, exactly like the DO
 * loader, so the gaps stay visible at every size.
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
      dangerouslySetInnerHTML={{ __html: symbol.body }}
    />
  )
}
