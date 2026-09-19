/**
 * `SearxngSearchProvider`: a `WebSearchProvider` that queries the JSON search endpoint of a
 * SearXNG instance owned by `SearxngRuntime` (`GET {instanceUrl}/search?format=json`). It resolves
 * the running instance's URL from the runtime on every search rather than owning any container
 * lifecycle itself, maps `results[]` into sources (a source keeps its URL even when the engine
 * returned no snippet), joins any instant `answers[]` into `content`, and maps `publishedDate` to
 * `publishedAt` unchanged.
 * @module @deepseek-ai/dsh-web-search-searxng/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { SearxngInstanceSource } from './runtime.ts'
import type { SearxngAnswer, SearxngError, SearxngResult, SearxngSearchResponse } from './types.ts'

/** Stable id this provider registers under. */
export const SEARXNG_PROVIDER_ID = 'searxng'

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/**
 * Map one SearXNG result to a normalized source. Unlike a provider whose only
 * portable field is a highlight, SearXNG always returns a URL, so a source
 * with no snippet is kept rather than dropped — the seam allows a
 * snippet-less, URL-only source (see `WebSearchSource`).
 *
 * @param result - one entry of SearXNG's `results[]`.
 * @returns the normalized source; blank optional fields are omitted rather than set empty.
 */
export function mapSearxngResult(result: SearxngResult): WebSearchSource {
  return {
    url: result.url,
    ...result.title != null && result.title.length > 0 ? { title: result.title } : {},
    ...result.content != null && result.content.length > 0 ? { snippet: result.content } : {},
    ...result.publishedDate != null && result.publishedDate.length > 0 ? { publishedAt: result.publishedDate } : {},
  }
}

/**
 * Extract the answer text from one `answers[]` entry, tolerating both the
 * plain-string and `{ answer }` object shapes SearXNG versions use.
 *
 * @param answer - one entry of the response's `answers[]`.
 * @returns the non-blank answer text, or `undefined` when the entry carries none.
 */
function answerText(answer: SearxngAnswer): string | undefined {
  const text = typeof answer === 'string' ? answer : answer.answer
  return text != null && text.length > 0 ? text : undefined
}

/**
 * Map a SearXNG response envelope to a normalized search result.
 *
 * @param response - the parsed `GET /search?format=json` response body.
 * @returns the normalized result; `content` joins every non-blank instant
 *   answer and is omitted when there are none.
 */
export function mapSearxngResponse(response: SearxngSearchResponse): WebSearchResult {
  const sources = (response.results ?? []).map(mapSearxngResult)
  const content = (response.answers ?? [])
    .map(answerText)
    .filter((text): text is string => text !== undefined)
    .join('\n\n')
  return {
    ...content.length > 0 ? { content } : {},
    sources,
    truncated: false,
  }
}

/**
 * The SearXNG-backed search provider. It owns no container lifecycle — every
 * search resolves the current instance URL from `runtime` first, which starts
 * the managed container lazily on first use. HTTP redirects fail as `WEB_PROVIDER_ERROR`.
 */
export class SearxngSearchProvider implements WebSearchProvider {
  readonly id = SEARXNG_PROVIDER_ID

  constructor(private readonly runtime: SearxngInstanceSource) {}

  // Availability is unconditional: there is no static config to validate, and
  // container health is a network-dependent fact the seam's `available()`
  // contract must not check. A container that fails to start surfaces as a
  // `WEB_PROVIDER_ERROR` from `search()` instead.
  available(): boolean {
    return true
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const instanceUrl = await this.runtime.ready(signal)
    const params = new URLSearchParams({ q: request.query, format: 'json' })
    let response: Response
    try {
      response = await fetch(`${instanceUrl}/search?${params.toString()}`, {
        method: 'GET',
        redirect: 'error',
        headers: {
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('SearXNG search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`SearXNG search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `SearXNG API error (HTTP ${status})`
      try {
        const parsed = await response.json() as SearxngError
        const detail = parsed.message
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        // An abort fired mid-body must surface as WEB_ABORTED, not be swallowed
        // into a generic HTTP-error message — cancellation is not a provider
        // error (the seam's cancellation contract).
        if (isAbortError(error)) throw new WebError('SearXNG search aborted', 'WEB_ABORTED', { cause: error })
        // Otherwise: the HTTP status is already captured in `message` above;
        // SearXNG defines no stable JSON error schema, so a non-JSON error
        // body (normal for a gateway error) can only cost a richer provider
        // message, never the real error.
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      const payload = await response.json() as SearxngSearchResponse
      return mapSearxngResponse(payload)
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('SearXNG search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`SearXNG returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
