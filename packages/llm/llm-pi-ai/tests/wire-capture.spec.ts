/**
 * Durable request-body capture for the pi-ai adapter: every payload pi-ai is
 * about to send is recorded on the addressed Session as a log-only
 * `request/wire` event, so the request stays traceable after the run.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

let testHome: string

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'dsh-piai-wire-'))
  vi.stubEnv('DSH_HOME', testHome)
})

afterEach(async () => {
  await closeMockServers()
  vi.unstubAllEnvs()
  rmSync(testHome, { recursive: true, force: true })
})

async function harness(baseURL: string): Promise<Context> {
  vi.stubEnv('PI_TEST_KEY', 'test-key')
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmPiAi, { providers: { deepseek: { apiKeyEnv: 'PI_TEST_KEY', baseURL } } })
  return ctx
}

function prompt(): ReturnType<typeof createUserMessage> {
  return createUserMessage({
    content: [{ type: 'text', text: 'hi' }],
    source: { kind: 'plugin', plugin: 'test' },
  })
}

describe('request/wire capture', () => {
  it('appends the payload pi-ai sent to the addressed Session', async () => {
    const server = await mockServer([{ events: textEvents }])
    const ctx = await harness(server.url)
    const session = ctx.sessions.create(SessionId('piai-wire-capture'))

    await assemble(ctx, { model: 'deepseek-v4-flash', messages: [prompt()], sessionId: session.id })

    const captured = session.snapshotEvents().filter(event => event.type === 'request/wire')
    expect(captured).toHaveLength(1)
    const record = captured[0]?.data
    expect(record).toMatchObject({ provider: 'deepseek', model: 'deepseek-v4-flash' })
    // A multi-protocol adapter owns no per-request image classification.
    expect(record?.representation).toBeUndefined()
    // What was recorded is what the endpoint received.
    expect(JSON.parse(record?.payload ?? '')).toEqual(server.requests[0])
  })

  it('records the provider purpose for an auxiliary call', async () => {
    const server = await mockServer([{ events: textEvents }])
    const ctx = await harness(server.url)
    const session = ctx.sessions.create(SessionId('piai-wire-compaction'))

    await assemble(ctx, {
      model: 'deepseek-v4-flash',
      messages: [prompt()],
      purpose: 'compaction',
      sessionId: session.id,
    })

    const captured = session.snapshotEvents().filter(event => event.type === 'request/wire')
    expect(captured[0]?.data).toMatchObject({ purpose: 'compaction' })
    expect(JSON.parse(captured[0]?.data.payload ?? '')).toEqual(server.requests[0])
  })

  it('streams without capturing when no addressed Session resolves', async () => {
    const server = await mockServer([
      { events: textEvents },
      { events: textEvents },
    ])
    const ctx = await harness(server.url)
    const session = ctx.sessions.create(SessionId('piai-wire-unaddressed'))

    // No `sessionId` at all, then one naming a Session the store does not hold.
    await assemble(ctx, { model: 'deepseek-v4-flash', messages: [prompt()] })
    await assemble(ctx, {
      model: 'deepseek-v4-flash',
      messages: [prompt()],
      sessionId: SessionId('absent-session'),
    })

    expect(server.requests).toHaveLength(2)
    expect(session.snapshotEvents().some(event => event.type === 'request/wire')).toBe(false)
  })
})
