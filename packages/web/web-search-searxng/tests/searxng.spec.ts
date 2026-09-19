import { afterEach, describe, expect, it, vi } from 'vitest'
import { SearxngSearchProvider } from '../src/provider.ts'
import { mapSearxngResponse, mapSearxngResult } from '../src/provider.ts'
import type { SearxngInstanceSource } from '../src/runtime.ts'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubRuntime(instanceUrl: string, seen?: { signal?: AbortSignal | undefined }): SearxngInstanceSource {
  return {
    ready: async (signal) => {
      if (seen !== undefined) seen.signal = signal
      return instanceUrl
    },
  }
}

describe('SearXNG result mapping', () => {
  it('maps a full result entry', () => {
    expect(mapSearxngResult({
      url: 'https://a.test',
      title: 'A',
      content: 'a salient snippet',
      publishedDate: '2026-01-01T00:00:00',
    })).toEqual({ url: 'https://a.test', title: 'A', snippet: 'a salient snippet', publishedAt: '2026-01-01T00:00:00' })
  })

  it('keeps a URL-only source when the engine returned no snippet', () => {
    expect(mapSearxngResult({ url: 'https://a.test' })).toEqual({ url: 'https://a.test' })
    expect(mapSearxngResult({ url: 'https://a.test', content: '' })).toEqual({ url: 'https://a.test' })
  })

  it('omits null/empty optional fields rather than emitting them', () => {
    expect(mapSearxngResult({ url: 'https://a.test', title: null, content: null, publishedDate: null }))
      .toEqual({ url: 'https://a.test' })
    expect(mapSearxngResult({ url: 'https://a.test', title: '', content: '', publishedDate: '' }))
      .toEqual({ url: 'https://a.test' })
  })

  it('maps a response merging results and a plain-string answer', () => {
    const result = mapSearxngResponse({
      results: [
        { url: 'https://a.test', content: 'one' },
        { url: 'https://b.test' },
      ],
      answers: ['42'],
    })
    expect(result).toEqual({
      content: '42',
      sources: [
        { url: 'https://a.test', snippet: 'one' },
        { url: 'https://b.test' },
      ],
      truncated: false,
    })
  })

  it('joins multiple answers and tolerates the `{ answer }` object shape', () => {
    const result = mapSearxngResponse({ answers: ['one', { answer: 'two' }, { answer: null }, ''] })
    expect(result.content).toBe('one\n\ntwo')
  })

  it('omits content when there are no non-blank answers', () => {
    const result = mapSearxngResponse({ results: [], answers: [] })
    expect(result.content).toBeUndefined()
  })

  it('tolerates a missing results array', () => {
    expect(mapSearxngResponse({}).sources).toEqual([])
  })
})

describe('SearxngSearchProvider', () => {
  it('is always available (no static config to validate)', () => {
    expect(new SearxngSearchProvider(stubRuntime('https://searx.test')).available()).toBe(true)
  })

  it('resolves the instance URL from the runtime and forwards the abort signal', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [{ url: 'https://a.test', content: 'hi' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const seen: { signal?: AbortSignal } = {}
    const controller = new AbortController()

    const provider = new SearxngSearchProvider(stubRuntime('https://searx.test', seen))
    await provider.search({ query: 'hello world' }, controller.signal)

    expect(seen.signal).toBe(controller.signal)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://searx.test/search?q=hello+world&format=json')
    expect(init).toMatchObject({ method: 'GET', redirect: 'error' })
    expect((init.headers as Record<string, string>)['authorization']).toBeUndefined()
    expect((init.headers as Record<string, string>)['accept']).toBe('application/json')
    expect(init.signal).toBe(controller.signal)
  })
})

describe('SearxngSearchProvider error handling', () => {
  const provider = () => new SearxngSearchProvider(stubRuntime('https://searx.test'))

  it('maps an HTTP error to WEB_PROVIDER_ERROR with the provider message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: 'rate limited' }, { status: 429 })))
    await expect(provider().search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'rate limited' }))
  })

  it('keeps a status-line message when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Forbidden', { status: 403 })))
    await expect(provider().search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'SearXNG API error (HTTP 403)' }))
  })

  it('keeps the status-line message when the JSON error body carries no detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, { status: 500 })))
    await expect(provider().search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ message: 'SearXNG API error (HTTP 500)' }))
  })

  it('maps a network failure to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('connection refused'))))
    await expect(provider().search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps an abort to WEB_ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError'))))
    await expect(provider().search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('maps an unparseable success body to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>not json</html>', { status: 200 })))
    await expect(provider().search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('surfaces an abort during success-body parse as WEB_ABORTED, not provider error', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: true, status: 200 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(provider().search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('surfaces an abort during error-body parse as WEB_ABORTED', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: false, status: 500 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(provider().search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })
})
