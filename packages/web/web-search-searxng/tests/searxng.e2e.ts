import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as searxngPlugin from '@deepseek-ai/dsh-web-search-searxng'
import { SEARXNG_PROVIDER_ID } from '@deepseek-ai/dsh-web-search-searxng'

/** True when a `docker` daemon actually answers, not merely when the CLI is on PATH. */
function isDockerAvailable(): boolean {
  try {
    execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], { stdio: 'ignore', timeout: 5_000 })
    return true
  } catch {
    return false
  }
}

/**
 * Real-Docker smoke for the SearXNG search provider. Self-skips without a
 * reachable Docker daemon (CI has no Docker socket by default, and this
 * provider needs no API key or configured instance to gate on — it manages
 * its own container), per the with-key e2e policy in docs/testing.md
 * generalized to a with-daemon precondition. Pulls `searxng/searxng` and
 * starts a real container, so first run can take a while.
 */
describe.skipIf(!isDockerAvailable())('SearxngRuntime real Docker container', () => {
  it('starts a real container and returns sources for a live query', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SubprocessLocal)
      await ctx.plugin(WebRuntime, { searchProvider: SEARXNG_PROVIDER_ID })
      await ctx.plugin(searxngPlugin, {})

      const result = await ctx.web.search({ query: 'DeepSeek Harness', maxResults: 5 })
      expect(result.sources.length).toBeGreaterThan(0)
      for (const source of result.sources) expect(source.url).toMatch(/^https?:\/\//)
    } finally {
      await ctx.fiber.dispose()
    }
  }, 120_000)
})
