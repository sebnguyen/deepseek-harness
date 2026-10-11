/**
 * A live route stores no model catalog: its models arrive from the endpoint
 * listing the plugin fetches once the credential can probe the route, and
 * the fetched feed never lands in settings.yaml.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { FileSettingsProvider } from '@deepseek-ai/dsh-settings-file'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

const LISTING = JSON.stringify({
  data: [
    { id: 'live-large', name: 'Live Large', context_window: 131072, max_tokens: 4096 },
    { id: 'live-think', name: 'Live Think' },
  ],
})

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
  await closeMockServers()
})

async function bootLive(dir: string, baseURL: string): Promise<Context> {
  const ctx = new Context()
  cleanups.push(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(FileSettingsProvider, { path: join(dir, 'settings.yaml'), watch: false })
  await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
  // The digitalocean route ships in the composition with nothing stored but
  // the credential reference; the profile here only repoints the endpoint at
  // the mock so the live feed is deterministic.
  await ctx.plugin(LlmPiAi, {
    providers: {
      digitalocean: { apiKeyEnv: 'LIVE_KEY', baseURL },
    },
  } satisfies LlmPiAi.Config)
  return ctx
}

describe('live endpoint-fed catalog', () => {
  it('fetches the endpoint listing once the key resolves and serves it without storing anything', async () => {
    const server = await mockServer([
      { body: LISTING }, // the live refresh's GET /v1/models
      { events: textEvents }, // a request against a fetched model
      { body: LISTING }, // any later refresh
    ])
    const dir = await mkdtemp(join(tmpdir(), 'dsh-pi-live-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    await writeFile(join(dir, '.credentials.yaml'), 'version: 1\nrefs:\n  LIVE_KEY: live-key\n', { mode: 0o600 })
    const ctx = await bootLive(dir, `${server.url}/v1`)

    // The route serves nothing before its first fetch completes; the feed
    // then registers it with the endpoint's catalog.
    await expect.poll(
      async () => (await ctx.llm.listModels('digitalocean')).map(model => model.id),
      { timeout: 10_000 },
    ).toEqual(['live-large', 'live-think'])

    // The listing went out authenticated, at the protocol's listing path.
    expect(server.paths[0]).toBe('/v1/models')
    expect(server.headers[0]?.authorization).toBe('Bearer live-key')

    // The shipped effort menu materializes on the fetched models, because a
    // gateway listing cannot carry it.
    const info = await ctx.llm.resolveModelInfo('digitalocean', 'live-think')
    expect(info.reasoning?.efforts.map(effort => effort.id)).toEqual(
      ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
    )
    const plain = await ctx.llm.resolveModelInfo('digitalocean', 'live-large')
    expect(plain.context).toEqual({ contextWindow: 131072 })

    // A fetched model is request-bound like any configured one.
    const result = await assemble(ctx, { provider: 'digitalocean', model: 'live-large', messages: [] })
    expect(result.finish).toEqual({ kind: 'stop' })
    expect(server.paths).toContain('/v1/chat/completions')

    // Nothing model-shaped landed in the settings document.
    const stored = await readFile(join(dir, 'settings.yaml'), 'utf8').catch(() => '')
    expect(stored).not.toContain('live-large')
  }, 30_000)
})
