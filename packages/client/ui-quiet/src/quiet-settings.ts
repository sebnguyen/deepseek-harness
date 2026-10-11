/**
 * Quiet-mode arming stored in the Host user-settings document, shared by the
 * node half (which arms the request waterfall and the `quiet_finish` tool
 * from it) and the browser half (whose composer selector binds the same
 * namespace through the settings scope). The selector therefore reaches
 * the enforcement half live; the document is the one durable home of the
 * mode.
 *
 * Three modes: `normal` is stock grammar; `quiet` forces tool-only working
 * steps and closes the turn with a tool-free answer one-shot after the
 * stop; `silence` is quiet without the one-shot — the stop concludes the
 * turn on the spot.
 */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the quiet-mode plugin. */
export const QUIET_SETTINGS_NAMESPACE = 'ui-quiet'

/** Field carrying the grammar mode. */
export const QUIET_MODE_FIELD = 'mode'

/** The three grammar modes the selector offers. */
export const QUIET_MODES = ['normal', 'quiet', 'silence'] as const

/** One grammar mode. */
export type QuietMode = typeof QUIET_MODES[number]

/** Mode when the user-settings document has no override. */
export const DEFAULT_MODE: QuietMode = 'quiet'

/**
 * Raw stored value: a mode string from this selector generation, or a
 * legacy boolean left by the earlier single-toggle schema (`true` armed
 * quiet, `false` meant stock). The union admits both so an old document
 * still resolves at registration.
 */
export type QuietModeStored = QuietMode | boolean

/** Durable quiet arming shared by the Host schema and the browser scope. */
export interface QuietSettings {
  /** Grammar mode for working steps and the turn's close. */
  mode: QuietModeStored
}

/** Durable quiet schema; also the wire envelope the browser scope validates against. */
export const QuietSettingsSchema: z<QuietSettings> = z.object({
  [QUIET_MODE_FIELD]: z.union(['normal', 'quiet', 'silence', true, false]).default(DEFAULT_MODE),
})

/**
 * Fold one stored mode onto the live mode taxonomy; legacy booleans map to
 * their old meaning (`true` → quiet, `false` → normal) and anything else
 * falls to the default.
 * @param value - the stored or wire mode value.
 * @returns the mode both halves act on.
 */
export function normalizeQuietMode(value: QuietModeStored | undefined): QuietMode {
  if (value === 'normal' || value === false) return 'normal'
  if (value === 'silence') return 'silence'
  return 'quiet'
}
