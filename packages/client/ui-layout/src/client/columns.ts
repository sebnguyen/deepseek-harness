/**
 * Normal column geometry: the right column shrinks, then loses its track,
 * before the center drops below its protected share. The sidebar never concedes here;
 * AppFrame supplies its effective preference after responsive collapse.
 */

/** Resolved widths for one frame. */
export interface Columns { sidebar: number; center: number; rightbar: number }

/** Center width protected on frames of 1600px and wider. */
export const CENTER_MIN = 400
/** Center's share of the frame: its protected minimum on narrower frames, and the share the first-open right panel leaves open. */
export const CENTER_SHARE = 0.25
/** Sidebar drag clamp floor. */
export const SIDEBAR_MIN = 264
/** Sidebar drag clamp ceiling. */
export const SIDEBAR_MAX = 420
/** Sidebar width before any user drag. */
export const SIDEBAR_DEFAULT = 280
/** Closed-sidebar rail: a 24px icon column between 16px horizontal paddings. */
export const SIDEBAR_COLLAPSED = 56
/** Viewport width below which the sidebar auto-collapses to the rail (deepsuite
 * LG breakpoint); a manual toggle below it re-expands over the squeezed center
 * (stores.ts narrowExpanded). */
export const SIDEBAR_AUTO_COLLAPSE = 1024
/** Right column drag clamp floor. */
export const RIGHTBAR_MIN = 300
/** Maximum normal right panel width as a fraction of the frame. */
export const RIGHTBAR_MAX_RATIO = 0.7

/**
 * Clamp a panel width into its contract range.
 * @param px - requested width.
 * @param min - range lower bound.
 * @param max - range upper bound.
 * @returns the clamped width.
 */
export function clampWidth(px: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(px)))
}

/**
 * Resolve the sidebar track width for one preference.
 * @param preference - stored sidebar width in px (0 = closed).
 * @returns the rendered track width (the collapsed rail when closed).
 */
export function sidebarWidth(preference: number): number {
  return preference === 0 ? SIDEBAR_COLLAPSED : clampWidth(preference, SIDEBAR_MIN, SIDEBAR_MAX)
}

/**
 * The center track's protected minimum for one frame.
 * @param viewport - available frame width in px.
 * @returns the protected center width in px (its quarter below 1600px).
 */
export function centerMin(viewport: number): number {
  return Math.min(CENTER_MIN, Math.round(viewport * CENTER_SHARE))
}

/**
 * First-open right panel preference: sidebar plus panel take the frame
 * minus the center's share, never below the drag floor.
 * @param viewport - available frame width in px.
 * @param sidebar - effective sidebar track width in px.
 * @returns the stored first-open preference in px.
 */
export function rightbarDefaultWidth(viewport: number, sidebar: number): number {
  return Math.max(RIGHTBAR_MIN, Math.round(viewport * (1 - CENTER_SHARE)) - sidebar)
}

/**
 * Solve the three column widths for one viewport frame.
 * @param viewport - available frame width in px.
 * @param sidebar - sidebar width preference in px (0 = closed).
 * @param rightbar - requested right panel width in px (0 = no track).
 * @returns actual widths after shrinking or removing the right track; only
 *   without that track may the center fall below its minimum, down to zero.
 */
export function computeColumns(viewport: number, sidebar: number, rightbar: number): Columns {
  const s = sidebarWidth(sidebar)
  const available = viewport - s - centerMin(viewport)
  const r = rightbar === 0 || available < RIGHTBAR_MIN
    ? 0
    : Math.min(available, clampWidth(rightbar, RIGHTBAR_MIN, viewport * RIGHTBAR_MAX_RATIO))
  return { sidebar: s, center: Math.max(0, viewport - s - r), rightbar: r }
}
