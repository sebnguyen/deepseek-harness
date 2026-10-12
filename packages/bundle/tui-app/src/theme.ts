/**
 * @deepseek-ai/dsh-tui-app — the DigitalOcean dark design-platform tokens
 * used by the fullscreen view. Every constant is a verbatim `dsw-static`
 * value from `packages/client/ui-theme/src/styles/design-platform.css`
 * (the dark aliases), expressed as a hex string Ink's chalk resolves to
 * truecolor. Nothing here is eyeballed alongside it.
 *
 * @module
 */

/** Surfaces, labels, and accents of the DO dark chat platform. */
export const THEME = {
  /** `--dsw-alias-bg-base` — neutral-bluish-950. */
  bgBase: '#121618',
  /** `--dsw-alias-bg-layer-1` — neutral-bluish-875; pinned bands. */
  band: '#1b1f21',
  /** `--dsw-alias-bg-layer-2` / `--dsw-specific-input-major` — bluish-850. */
  input: '#202426',
  /** `--dsw-alias-bg-layer-3` — neutral-bluish-800; user bubble. */
  userBubble: '#25292a',
  /** `--dsw-specific-bubble` — violet-950; assistant bubble. */
  assistantBubble: '#37202f',
  /** `--dsw-specific-bubble-highlight` — violet-800; assistant border. */
  assistantBorder: '#6e4660',
  /** `--dsw-static-violet-300` — accent text inside violet bubbles. */
  violetText: '#ddc4d8',
  /** `--dsw-alias-brand-primary` (dark) — teal wordmark / links / prompt. */
  brand: '#7bb4bc',
  /** `--dsw-static-deepseek-450` — brand-secondary borders (tool cards). */
  brandSecondary: '#60a5af',
  /** `--dsw-alias-label-primary` — neutral-bluish-50. */
  label: '#f7f8f8',
  /** `--dsw-alias-label-dimmed` — neutral-bluish-100. */
  dim: '#d9dede',
  /** `--dsw-alias-label-tertiary` — neutral-bluish-300. */
  tertiary: '#919f9e',
  /** `--dsw-static-neutral-bluish-600` — captions / statuses. */
  muted: '#4c5858',
  /** `--dsw-alias-state-warn-label` — warnings. */
  warn: '#fcd34d',
  /** `--dsw-static-amber-400` — approval borders. */
  warnBorder: '#daa549',
  /** `--dsw-alias-state-warn-bg` resolved over base — amber-500 @ 12 %. */
  warnBg: '#292115',
  /** `--dsw-alias-state-success-primary`. */
  success: '#86efac',
  /** `--dsw-alias-state-error-primary` — red-400. */
  danger: '#fca5a5',
  /** `--dsw-static-blue-300` — inline code segments. */
  codeText: '#93defd',
} as const
