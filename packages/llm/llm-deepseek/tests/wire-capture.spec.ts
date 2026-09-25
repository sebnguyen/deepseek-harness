/**
 * Durable request-body capture: the DeepSeek plugin records every dispatched
 * body on the addressed Session as a log-only `request/wire` event, so the
 * exact bytes a provider received stay traceable after the run.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, LlmRuntime } from '@deepseek-ai/dsh-llm'
import DeepSeekLlmApiExtensionRegistry from '@deepseek-ai/dsh-deepseek-llm-api-extensions'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

let testHome: string

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'dsh-wire-capture-'))
  vi.stubEnv('DSH_HOME', testHome)
})

afterEach(async () => {
  await closeMockServers()
  vi.unstubAllEnvs()
  rmSync(testHome, { recursive: true, force: true })
})

async function harness(baseURL: string): Promise<Context> {
  vi.stubEnv('DEEPSEEK_API_KEY', 'test-key')
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(DeepSeekLlmApiExtensionRegistry)
  await ctx.plugin(LlmDeepSeek, { baseURL })
  return ctx
}

function prompt(): ReturnType<typeof createUserMessage> {
  return createUserMessage({
    content: [{ type: 'text', text: 'hi' }],
    source: { kind: 'plugin', plugin: 'test' },
  })
}

describe('request/wire capture', () => {
  it('appends the exact dispatched body to the addressed Session', async () => {
    const server = await mockServer([{ kind: 'sse', events: textEvents }])
    const ctx = await harness(server.url)
    const session = ctx.sessions.create(SessionId('wire-capture'))

    await assemble(ctx, { model: 'deepseek-v4-flash', messages: [prompt()], sessionId: session.id })

    const captured = session.snapshotEvents().filter(event => event.type === 'request/wire')
    expect(captured).toHaveLength(1)
    expect(captured[0]?.data).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      representation: 'none',
      // Byte-for-byte the body the transport received, not a re-serialization.
      payload: server.rawRequests[0],
    })
  })

  it('records the provider purpose for an auxiliary call', async () => {
    const server = await mockServer([{ kind: 'sse', events: textEvents }])
    const ctx = await harness(server.url)
    const session = ctx.sessions.create(SessionId('wire-compaction'))

    await assemble(ctx, {
      model: 'deepseek-v4-flash',
      messages: [prompt()],
      purpose: 'compaction',
      sessionId: session.id,
    })

    const captured = session.snapshotEvents().filter(event => event.type === 'request/wire')
    expect(captured[0]?.data).toMatchObject({ purpose: 'compaction', payload: server.rawRequests[0] })
  })

  it('streams without capturing when no addressed Session resolves', async () => {
    const server = await mockServer([
      { kind: 'sse', events: textEvents },
      { kind: 'sse', events: textEvents },
    ])
    const ctx = await harness(server.url)
    const session = ctx.sessions.create(SessionId('wire-unaddressed'))

    // No `sessionId` at all, then one naming a Session the store does not hold.
    await assemble(ctx, { model: 'deepseek-v4-flash', messages: [prompt()] })
    await assemble(ctx, {
      model: 'deepseek-v4-flash',
      messages: [prompt()],
      sessionId: SessionId('absent-session'),
    })

    expect(server.rawRequests).toHaveLength(2)
    expect(session.snapshotEvents().some(event => event.type === 'request/wire')).toBe(false)
  })
})
