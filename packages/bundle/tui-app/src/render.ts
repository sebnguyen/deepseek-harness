/**
 * Pure render helpers for the terminal application (no stream or terminal
 * state): truncation, token figures, tool-row summaries, and
 * the boot banner. Everything is string-in / string-out so the unit tests can
 * drive them without a TTY.
 * @module @deepseek-ai/dsh-tui-app/render
 */

import { paint, paintFg256, fg256, SGR, FG_CLOSE, BOLD_CLOSE } from './ansi.ts'

/**
 * DigitalOcean-bluish 256-color palette approximations (mapped from the web
 * theme's `dsw-static` tokens in `packages/client/ui-theme`): brand primary
 * rgb(0,99,248) ≈ 33, blue-400 rgb(97,200,249) ≈ 45, violet accent ≈ 99,
 * green-500 ≈ 28, amber-500 rgb(208,135,48) ≈ 172, neutral-bluish grays.
 */
export const PALETTE = {
  /** Teal brand-primary (deepseek family) — prompts, spinners. */
  accent: 109,
  /** Sky blue — inline `code` spans and info bullets. */
  accentLight: 117,
  /** Violet text — inside the assistant bubble family. */
  violet: 182,
  /** Success decisions and rounded ok states. */
  success: 120,
  /** Amber — warnings and approval chrome. */
  warn: 221,
  /** Red — errors and rejected decisions. */
  error: 217,
  /** Neutral bluish gray — dim rows, statuses, reasoning bodies. */
  dim: 246,
} as const


/** Paint `text` with one palette code, closing `fg` only (Ink-bg safe). */
export function paletteText(code: number, enabled: boolean, text: string): string {
  return paintFg256(enabled, code, text)
}

/** Bold-plus-palette-accent composite; closes bold/fg individually. */
export function accentBold(enabled: boolean, text: string): string {
  if (!enabled || text === '') return text
  return SGR.bold + fg256(PALETTE.accent) + text + FG_CLOSE + BOLD_CLOSE
}

/** Style code-slate runs inside one plain line (backtick spans → sky light). */
function inlineMarkdown(line: string, color: boolean): string {
  let out = ''
  let pond = ''
  let rest = line
  for (;;) {
    const tick = rest.indexOf('`')
    if (tick === -1) { pond += rest; break }
    pond += rest.slice(0, tick)
    const close = rest.indexOf('`', tick + 1)
    if (close === -1) { pond += rest.slice(tick); break }
    pond += paletteText(PALETTE.accentLight, color, rest.slice(tick + 1, close))
    rest = rest.slice(close + 1)
  }
  out = pond
  out = out.replace(/\*\*([^*]+)\*\*/g, (_, body: string) => color ? `${SGR.bold}${body}${BOLD_CLOSE}` : body)
  return out
}

/**
 * Wrap `text` to `width` visible columns so a bubble can hold a uniform
 * block. Words break at the previous space; unbreakable runs hard-cut.
 */
export function wrapText(text: string, width: number): string {
  if (width < 8) return text
  const out: string[] = []
  for (const line of text.split('\n')) {
    const indent = ' '.repeat(line.search(/\S/) === -1 ? 0 : line.search(/\S/))
    let rest = line.slice(indent.length)
    while (rest.length > width) {
      let cut = rest.lastIndexOf(' ', width)
      if (cut <= 0) cut = width
      out.push(indent + rest.slice(0, cut))
      rest = rest.slice(cut).replace(/^ +/, '')
    }
    out.push(indent + rest)
  }
  return out.join('\n')
}

/** Visible length of a line after dropping my own SGR escapes. */
export function visibleLength(line: string): number {
  return line.replace(/\x1B\[[0-9;]*m/g, '').length
}

/** Right-pad every line to the longest visible line (uniform block for bg). */
export function padLines(text: string, extra = 0): string {
  const lines = text.split('\n')
  const target = Math.max(...lines.map(visibleLength)) + extra
  return lines.map(line => line + ' '.repeat(Math.max(0, target - visibleLength(line)))).join('\n')
}

/**
 * Minimal markdown renderer for assistant bodies: headings bold, fenced code
 * blocks indented dim, inline code sky-blue, `**bold**` promoted. Link syntax
 * and lists pass through as text (they already read fine on a terminal).
 * @param text - raw assistant markdown.
 * @param color - whether styling survives.
 * @returns the ANSI-decorated rendering.
 */
export function renderMarkdown(text: string, color: boolean): string {
  if (!color) return text
  const out: string[] = []
  let fence = false
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) { fence = !fence; continue }
    if (fence) { out.push(paletteText(PALETTE.dim, true, `  ${line}`)); continue }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading !== null) {
      // Bold close must not kill surrounding Text backgroundColor spans.
      out.push(`${SGR.bold}${heading[2] ?? ''}${BOLD_CLOSE}`)
      continue
    }
    if (/^(\s*[-*+]|\s*\d+\.)\s/.test(line)) {
      out.push(paletteText(PALETTE.dim, true, line.slice(0, line.search(/\S/))) + inlineMarkdown(line.slice(line.search(/\S/)), true))
      continue
    }
    out.push(inlineMarkdown(line, true))
  }
  return out.join('\n')
}

/** Clamp the terminal width into a sane wrapping region. */
export function terminalWidth(columns: number | undefined): number {
  const width = columns === undefined || Number.isNaN(columns) ? 80 : columns
  return Math.max(20, Math.min(width, 240))
}

/** One truncation decision: the rendered preview and the hidden line count. */
export interface TruncatedLines {
  /** The kept lines (never ANSI-styled; the caller paints). */
  text: string
  /** How many lines were dropped; zero means the preview is complete. */
  omitted: number
}

/**
 * Keep the first `maxLines` lines of `text`, eliding each line to `width`
 * columns and reporting how many whole lines were dropped.
 * @param text - the full text.
 * @param maxLines - lines to keep before eliding.
 * @param width - per-line visible column cap.
 * @returns the preview and the dropped-line count.
 */
export function truncateLines(text: string, maxLines: number, width: number): TruncatedLines {
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  if (body === '') return { text: '', omitted: 0 }
  const lines = body.split('\n').map(line => (line.length > width ? `${line.slice(0, Math.max(0, width - 1))}…` : line))
  const kept = lines.slice(0, Math.max(0, maxLines))
  return { text: kept.join('\n'), omitted: lines.length - kept.length }
}

/** Token counters needed to render one usage figure (subset of TokenUsage). */
export interface UsageFigure {
  inputTokens: number
  outputTokens: number
}

/**
 * Format a token count as a compact figure (`340`, `1.2k`, `24k`).
 * @param count - exact token count.
 * @returns the compact figure.
 */
export function formatCount(count: number): string {
  if (count >= 10_000) return `${Math.round(count / 1000)}k`
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`
  return String(count)
}

/**
 * Render one usage figure as `↑ 2.4k · ↓ 340` for the turn-end status line.
 * @param usage - the last reported usage, if any.
 * @returns the figure, or an empty string when no usage exists.
 */
export function formatUsage(usage: UsageFigure | undefined): string {
  if (usage === undefined) return ''
  return `↑ ${formatCount(usage.inputTokens)} · ↓ ${formatCount(usage.outputTokens)}`
}

/**
 * Distill a `tool/call` event to one presentation line: the purpose line when
 * the harness lifted one, else the tool's most recognizable argument.
 * @param name - the tool's registered name.
 * @param argumentsJson - the raw arguments JSON string exactly as logged.
 * @param purpose - the harness purpose line when present.
 * @returns a single-line, ASCII-arrow-prefixed summary (unstyled).
 */
export function summarizeToolCall(name: string, argumentsJson: string, purpose?: string): string {
  if (purpose !== undefined && purpose.trim() !== '') return `${name} — ${purpose.trim()}`
  let parsed: unknown
  try {
    parsed = JSON.parse(argumentsJson)
  } catch {
    return name
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return name
  const record = parsed as Record<string, unknown>
  for (const key of ['command', 'pattern', 'file_path', 'path', 'query', 'url', 'regex']) {
    const value = record[key]
    if (typeof value !== 'string' || value.trim() === '') continue
    const compact = value.replace(/\s+/g, ' ').trim()
    return `${name} · ${compact.length > 72 ? `${compact.slice(0, 71)}…` : compact}`
  }
  const compact = JSON.stringify(record)
  return `${name} ${compact.length > 72 ? `${compact.slice(0, 71)}…` : compact}`
}

/** Facts the boot banner prints once the agent is composed. */
export interface BannerFacts {
  /** The working directory the agent was composed with. */
  cwd: string
  /** The selected provider and model. */
  provider: string
  model: string
  /** The session identity. */
  sessionId: string
}

/**
 * Render the boot banner. `width` clamps the rule so narrow terminals do not
 * wrap the frame.
 * @param facts - what to announce.
 * @param color - whether ANSI styling survives.
 * @param width - the current terminal width.
 * @returns the banner, terminated by a newline.
 */
export function banner(facts: BannerFacts, color: boolean, width: number): string {
  const rule = '─'.repeat(Math.min(width, 64))
  const title = accentBold(color, 'dsh')
    + paint(color, 'gray', ' · terminal profile')
  return [
    paint(color, 'gray', rule),
    ` ${title}`,
    ` ${facts.provider}/${facts.model} ${paint(color, 'gray', '·')} ${paint(color, 'dim', facts.cwd)}`,
    paint(color, 'gray', ` session ${facts.sessionId}`),
    paint(color, 'gray', ' /help for commands · ctrl+c interrupts a turn · ctrl+d quits'),
    paint(color, 'gray', rule),
    '',
  ].join('\n')
}

/** The slash-command cheat sheet printed by `/help`. */
export const HELP_TEXT = [
  'commands:',
  '  /help                 show this help',
  '  /clear                start a fresh session',
  '  /model                show the current provider and model',
  '  /status               show session state (turn, tokens, activity)',
  '  /approval ask|never   set how tool approvals are decided',
  '  /quit                 flush the session and exit (also ctrl+d, /exit)',
  '',
  'editing:',
  '  enter / ctrl+j        submit',
  '  ctrl+a/e/u/w/k        home / end / kill line / kill word / kill to end',
  '  up/down               input history · pastes keep their newlines',
  '  ctrl+c                interrupt the running turn (twice on idle: quit)',
  '',
].join('\n')
