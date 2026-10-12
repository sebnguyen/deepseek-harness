/**
 * Dependency-free ANSI escape primitives. Every sequence is gated on a color
 * flag at the call site (or flattened by {@link paint}), so the plain-text
 * profile needs no second code path. The renderer deliberately measures
 * strings with JavaScript's UTF-16 length; wide graphemes drift one column on
 * rare prompts, which the line editor tolerates because its prompts are ASCII.
 * @module @deepseek-ai/dsh-tui-app/ansi
 */

/** CSI introducer shared by every sequence here. */
export const CSI = '\x1B[' as const

/** Select-graphic-rendition codes used by the renderer. */
export const SGR = {
  reset: `${CSI}0m`,
  bold: `${CSI}1m`,
  dim: `${CSI}2m`,
  italic: `${CSI}3m`,
  underline: `${CSI}4m`,
  inverse: `${CSI}7m`,
  red: `${CSI}31m`,
  green: `${CSI}32m`,
  yellow: `${CSI}33m`,
  blue: `${CSI}34m`,
  magenta: `${CSI}35m`,
  cyan: `${CSI}36m`,
  white: `${CSI}37m`,
  gray: `${CSI}90m`,
} as const

/** Named SGR keys, so call sites fail typecheck instead of printing garbage. */
export type SgrName = keyof typeof SGR

/** 256-color foreground SGR (`38;5;n`) for the DO palette approximations. */
export const fg256 = (code: number): string => `${CSI}38;5;${code}m`

/**
 * Wrap `text` in one 256-color foreground pair when styling is enabled.
 * @param enabled - whether styling survives.
 * @param code - the 256-color palette index.
 * @param text - the content to style.
 * @returns the styled (or original) text.
 */
export function paint256(enabled: boolean, code: number, text: string): string {
  if (!enabled || text === '') return text
  return fg256(code) + text + SGR.reset
}

/** `./paletteText`-friendly close codes that do NOT clobber other spans. */
export const FG_CLOSE = `${CSI}39m`
export const BOLD_CLOSE = `${CSI}22m`

/**
 * Like `paint256`, but closes with `39m` only — safe inside an Ink parent
 * carrying `backgroundColor`, because the close leaves the background span
 * (and any ink-managed attributes) alive.
 */
export function paintFg256(enabled: boolean, code: number, text: string): string {
  if (!enabled || text === '') return text
  return fg256(code) + text + FG_CLOSE
}

/** Cursor and screen control sequences used by the line editor and spinner. */
export const CTL = {
  /** Clear from the cursor to the end of the screen. */
  clearDown: `${CSI}0J`,
  /** Clear the whole line and leave the cursor in place. */
  clearLine: `${CSI}2K`,
  /** Show / hide the cursor. */
  showCursor: `${CSI}?25h`,
  hideCursor: `${CSI}?25l`,
  /** Bracketed-paste mode: the terminal wraps pasted text in markers. */
  enablePaste: `${CSI}?2004h`,
  disablePaste: `${CSI}?2004l`,
} as const

/** Move the cursor up `n` rows (a no-op string for `n <= 0`). */
export const cursorUp = (n: number): string => (n > 0 ? `${CSI}${n}A` : '')

/** Move the cursor right `n` columns (a no-op string for `n <= 0`). */
export const cursorRight = (n: number): string => (n > 0 ? `${CSI}${n}C` : '')

/**
 * Wrap `text` in one SGR pair when styling is enabled, passing it through
 * untouched otherwise.
 * @param enabled - whether styling survives.
 * @param code - one SGR sequence name.
 * @param text - the content to style.
 * @returns the styled (or original) text.
 */
export function paint(enabled: boolean, code: SgrName, text: string): string {
  if (!enabled || text === '') return text
  return SGR[code] + text + SGR.reset
}

/**
 * Compose several SGR codes around one text run in one pass.
 * @param enabled - whether styling survives.
 * @param codes - applied in order, outermost last.
 * @param text - the content to style.
 * @returns the styled (or original) text.
 */
export function paintAll(enabled: boolean, codes: readonly SgrName[], text: string): string {
  if (!enabled || text === '') return text
  let open = ''
  for (const code of codes) open += SGR[code]
  return open + text + SGR.reset
}
