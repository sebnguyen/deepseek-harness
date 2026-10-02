/**
 * Span and intent extraction over one sealed reasoning block. Pure text
 * functions: the plugin parses assembled reasoning only, never deltas, so a
 * mid-token fragment can never become a prefetch candidate.
 * @module @deepseek-ai/dsh-experimental-reasoning-prefetch/extract
 */

/** One detected prospect and the operation it names. */
export interface ExtractedCandidate {
  /** The op the span's shape and verb context imply. */
  readonly op: 'read' | 'glob' | 'grep'
  /** The raw span text the plugin should ground (path or term). */
  readonly span: string
  /** Whether the span is a term (quoted) rather than a path the span itself carries. */
  readonly term: boolean
}

/** Reasoning sentence boundaries: newline, `;`, `!`, `?`, or a period plus space. */
const SENTENCE_SPLIT = /[\n;!?]|\.\s/u

const SEARCH_VERBS = /\b(?:grep|search(?: for)?|find (?:usages|callers|references) of)\b/iu
const LIST_VERBS = /\b(?:list|ls|explore|layout|structure)\b/iu

/** Bare workspace-relative path token with a known source/text extension. */
const BARE_PATH = /(?<![\w`"@])(?:[\w@.-]+\/)+[\w.-]+\.(?:ts|mts|cts|tsx|md|mdx|json|ya?ml|py|go|rs|sh|txt)(?::\d+)?(?![\w`"@[])/gu
/** Absolute or home path token. */
const ABS_PATH = /(?<![\w`"@])(?:~|\/)(?:[\w@.-]+\/)+[\w.-]+(?:\.[\w]+)?(?::\d+)?(?![\w`"@[])/gu
/** Trailing-slash directory span. */
const DIR_SPAN = /(?<![\w`"@])(?:~|\/)?(?:[\w@.-]+\/)+(?!\/)/gu
/** Quoted search-term span. */
const QUOTED = /"([^"\n]{2,80})"/gu
/** Backticked span carrier; group 1 is the span. */
const BACKTICK = /`([^`\n]+)`/gu

/** True when the span text names a directory (trailing slash) rather than a file. */
export function isDirectorySpan(span: string): boolean {
  return span.endsWith('/')
}

/** True when a span is path-shaped at all; backticked non-path identifiers are terms. */
function isPathShaped(span: string): boolean {
  return /[/~]/u.test(span) || /\.[\w]+(?::\d+)?$/u.test(span)
}

/** Strip a `:line` suffix so grounding sees a plain path. */
export function stripLineSuffix(span: string): string {
  return span.replace(/:\d+$/u, '')
}

/**
 * Extract read/glob/grep prospects from one completed reasoning block.
 * Clean path spans imply read (or glob with a listing verb on a directory span);
 * quoted terms produce grep only beside a search verb, and non-path backticked
 * spans are terms this vocabulary cannot ground without a fuzzy layer.
 * @param reasoning - one sealed reasoning block's full text.
 * @returns prospects in stream order; duplicates removed per op+span.
 */
export function extractCandidates(reasoning: string): ExtractedCandidate[] {
  const out: ExtractedCandidate[] = []
  const seen = new Set<string>()
  const push = (op: ExtractedCandidate['op'], span: string, term = false): void => {
    const key = `${op}:${span}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ op, span, term })
  }

  const sentences = reasoning.split(SENTENCE_SPLIT)
  for (let index = 0; index < sentences.length; index += 1) {
    // v8 ignore next -- the bounded loop never reads past the split array
    const sentence = sentences[index] ?? ''
    const window_ = `${sentences[index - 1] ?? ''} ${sentence}`

    for (const span of matchAll(BACKTICK, sentence, 1)) {
      if (isDirectorySpan(span)) {
        push(LIST_VERBS.test(window_) ? 'glob' : 'read', span)
      } else if (isPathShaped(span)) {
        push('read', stripLineSuffix(span))
      }
      // Non-path backticked identifiers stay terms; no fuzzy layer ships.
    }
    for (const span of matchAll(BARE_PATH, sentence, 0)) push('read', stripLineSuffix(span))
    for (const span of matchAll(ABS_PATH, sentence, 0)) push('read', stripLineSuffix(span))
    for (const span of matchAll(DIR_SPAN, sentence, 0)) {
      // A bare directory span is inert without a listing verb.
      if (LIST_VERBS.test(window_)) push('glob', span)
    }
    for (const term of matchAll(QUOTED, sentence, 1)) {
      if (SEARCH_VERBS.test(window_)) push('grep', term, true)
    }
  }
  return out
}

/** Collect one capture group from every match of a global regex. */
function matchAll(pattern: RegExp, text: string, group: number): string[] {
  const found: string[] = []
  for (const match of text.matchAll(pattern)) {
    const value = match[group]
    // v8 ignore next 2 -- group 1 never misses for the grammars this module feeds
    if (value !== undefined) found.push(value)
  }
  return found
}
