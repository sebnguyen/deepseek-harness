/**
 * Turn-shape arming stored in the Host user-settings document. The namespace
 * keeps the legacy `ui-quiet` name as the migration alias: documents written
 * by the old quiet-mode plugin (`mode: normal|quiet|silence|true|false`)
 * still resolve, while this plugin's selector writes only the new
 * `turnShape` field. The document is the one durable home of the shape; the
 * browser selector and the host enforcement half bind the same namespace
 * through the settings scopes.
 *
 * Three shapes: `narrate` is the stock transcript; `quiet` hides working
 * chatter and closes with one plain answer; `tools` hides chatter and ends
 * without a summary. The shape promises transcript presentation, never
 * request grammar — a provider that ignores every hint still gets a
 * coherent, if less token-frugal, rendering.
 */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the conversation-mode plugin (legacy `ui-quiet` alias). */
export const TURN_SHAPE_SETTINGS_NAMESPACE = 'ui-quiet'

/** Field carrying the current taxonomy's shape. */
export const TURN_SHAPE_FIELD = 'turnShape'

/** Field the retired quiet-mode plugin wrote; still honored at read time. */
export const LEGACY_MODE_FIELD = 'mode'

/** The three turn shapes the selector offers. */
export const TURN_SHAPES = ['narrate', 'quiet', 'tools'] as const

/** One turn shape. */
export type TurnShape = typeof TURN_SHAPES[number]

/** Shape when the user-settings document carries no resolvable value. */
export const DEFAULT_SHAPE: TurnShape = 'narrate'

/** Raw stored new-field value: a current shape, or a legacy value written by old schema generations. */
export type TurnShapeStored = TurnShape | 'normal' | 'silence' | boolean

/** Values the retired quiet-mode plugin persisted. */
export type LegacyQuietModeStored = 'normal' | 'quiet' | 'silence' | boolean

/** Durable turn-shape arming shared by the Host schema and the browser scope. */
/** A missing key must resolve to absent (undefined): `.default(undefined)` is the
 * schemastery optional-field idiom (`union` has no `.optional()`). */
export interface TurnShapeSettings {
  /** Current shape field, written by the turn-shape selector. */
  turnShape?: TurnShapeStored
  /** Legacy quiet-mode field, read-only as a migration alias. */
  mode?: LegacyQuietModeStored
}

/** Durable shape schema; permissive union so old documents still resolve at registration. */
export const TurnShapeSettingsSchema: z<TurnShapeSettings> = z.object({
  [TURN_SHAPE_FIELD]: z.union(['narrate', 'quiet', 'tools', 'normal', 'silence', true, false]).default(undefined),
  [LEGACY_MODE_FIELD]: z.union(['normal', 'quiet', 'silence', true, false]).default(undefined),
})

/**
 * Fold one stored settings document onto the live shape taxonomy. The new
 * field wins; the legacy quiet `mode` field maps through (`normal`/false →
 * narrate, `quiet`/true → quiet, `silence` → tools); anything else falls to
 * the default.
 * @param settings - the stored or wire settings document.
 * @returns the shape both halves act on.
 */
export function normalizeTurnShape(settings: TurnShapeSettings | undefined): TurnShape {
  const turnShape = settings?.turnShape
  if (turnShape === 'narrate' || turnShape === 'quiet' || turnShape === 'tools') return turnShape
  if (turnShape === 'silence') return 'tools'
  if (turnShape === true) return 'quiet'
  if (turnShape === 'normal' || turnShape === false) return 'narrate'
  const legacy = settings?.mode
  if (legacy === 'silence') return 'tools'
  if (legacy === 'quiet' || legacy === true) return 'quiet'
  if (legacy === 'normal' || legacy === false) return 'narrate'
  return DEFAULT_SHAPE
}
