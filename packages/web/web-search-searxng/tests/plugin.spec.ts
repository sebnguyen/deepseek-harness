import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
// Imported by relative path (not the package name) so coverage instrumentation
// attributes execution to this source file rather than the built `lib/index.js`.
import * as searxngPlugin from '../src/index.ts'
import { SEARXNG_PROVIDER_ID } from '../src/index.ts'
import { FakeSubprocess, successfulHandler } from './fake-subprocess.ts'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

async function bootSearxng() {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ results: [{ url: 'https://a.test', content: 'hi' }] })))
  const ctx = new Context()
  await ctx.plugin(FakeSubprocess)
  const fake = ctx.subprocess as FakeSubprocess
  fake.handler = successfulHandler()
  await ctx.plugin(WebRuntime, { searchProvider: SEARXNG_PROVIDER_ID })
  const fiber = await ctx.plugin(searxngPlugin, {})
  return { ctx, fake, fiber }
}

describe('web-search-searxng plugin registration', () => {
  it('mounts the managed runtime and registers the provider into ctx.web (HMR-safe)', async () => {
    const { ctx, fake, fiber } = await bootSearxng()

    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({
      sources: [{ url: 'https://a.test', snippet: 'hi' }],
      truncated: false,
    })
    expect(fake.calls.map(spec => spec.argv[1])).toEqual(['run', 'port'])
    expect(ctx.searxngRuntime).toBeDefined()

    await fiber.dispose()
    expect(fake.calls.at(-1)?.argv.slice(1, 2)).toEqual(['stop'])
    await expect(ctx.web.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in searxngPlugin).toBe(false)
  })

  it('threads a configured image and readyTimeoutMs into the managed container startup', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ results: [] })))
    const ctx = new Context()
    await ctx.plugin(FakeSubprocess)
    const fake = ctx.subprocess as FakeSubprocess
    fake.handler = successfulHandler()
    await ctx.plugin(WebRuntime, { searchProvider: SEARXNG_PROVIDER_ID })
    const fiber = await ctx.plugin(searxngPlugin, { image: 'searxng/searxng:pinned', readyTimeoutMs: 5_000 })

    await ctx.web.search({ query: 'q' })

    const runCall = fake.calls.find(spec => spec.argv[1] === 'run')
    expect(runCall?.argv.at(-1)).toBe('searxng/searxng:pinned')
    await fiber.dispose()
  })
})
