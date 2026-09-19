/**
 * Wire types for a SearXNG instance's JSON search endpoint (`GET {instanceUrl}/search?format=json`).
 * Types only — no runtime code. SearXNG returns a flat `results[]` merged across its configured
 * engines, plus an optional `answers[]` of instant answers (calculator, unit conversion, and
 * similar); across SearXNG versions an answer entry is either a plain string or an
 * `{ answer: string }` object, so both are accepted.
 *
 * @module @deepseek-ai/dsh-web-search-searxng/types
 */

/** One entry of SearXNG's flat `results[]`. */
export interface SearxngResult {
  url: string
  title?: string | null
  /** The engine-supplied result snippet; may be an empty string. */
  content?: string | null
  /** ISO-8601-ish publication timestamp; format varies by source engine. */
  publishedDate?: string | null
}

/** One instant-answer entry; shape varies by SearXNG version. */
export type SearxngAnswer = string | { answer?: string | null }

/** SearXNG's `format=json` response envelope. */
export interface SearxngSearchResponse {
  results?: SearxngResult[]
  answers?: SearxngAnswer[]
}

/** SearXNG's error response envelope (best-effort; SearXNG defines no stable error schema). */
export interface SearxngError {
  message?: string
}
