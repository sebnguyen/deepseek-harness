/** The ideBridge twin-wire: open/downlink/report with token-bearing seats. */

import { tmpdir } from 'node:os'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { ConnectionBearerRule } from '@deepseek-ai/dsh-client-connection'
import Ide from '../src/index.ts'
import type { IdeBridgeDownlinkFrame } from '../src/index.ts'

/** Minimal subprocess fake: a never-exiting child, so spawned state stays spawned. */
function provideSubprocess(ctx: Context): void {
  ctx.provide('subprocess', {
    spawn: () => ({
      done: new Promise(() => undefined),
      terminate: () => undefined,
      collected: { stderr: { readFrom: () => ({ text: '' }) } },
    }) as never,
  })
}

function provideSessions(ctx: Context, sessions: { id: string; header?: { cwd?: string } }[]): void {
  ctx.provide('sessions', {
    list: () => sessions,
    get: (id: string) => sessions.find(session => session.id === id),
  } as never)
}

function provideSandboxPolicy(ctx: Context, workspaceRoot: string): void {
  ctx.provide('sandboxPolicy', { workspaceRoot } as never)
}

function provideTypert(ctx: Context): void {
  ctx.provide('typert', {
    lookups: { configure: () => () => {} },
    contexts: { configureHost: () => () => {} },
  } as never)
}

/** A structural fake of the host Connection service recording registered bearer rules. */
function provideConnection(ctx: Context): { rules: ConnectionBearerRule[] } {
  const rules: ConnectionBearerRule[] = []
  ctx.provide('connection', {
    registerBearerRule(rule: ConnectionBearerRule) {
      rules.push(rule)
      return () => { rules.splice(rules.indexOf(rule), 1) }
    },
  } as never)
  return { rules }
}

const contexts: Context[] = []
const tempDirs: string[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const ORIGINAL_FETCH = globalThis.fetch
beforeEach(() => {
  globalThis.fetch = (async () => new Response('ok', { status: 200 })) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
})

async function harness(): Promise<{ ide: Ide; rules: ConnectionBearerRule[] }> {
  const ctx = new Context()
  contexts.push(ctx)
  const dist = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-ide-bridge-')))
  tempDirs.push(dist)
  provideSubprocess(ctx)
  provideSessions(ctx, [{ id: 's1', header: { cwd: '/repo' } }])
  provideSandboxPolicy(ctx, '/sandbox')
  provideTypert(ctx)
  const { rules } = provideConnection(ctx)
  const ide = new Ide(ctx, { dist, readinessTimeoutMs: 1_000, readinessPollMs: 5 })
  await new Promise(resolve => setTimeout(resolve, 0))
  return { ide, rules }
}

async function nextFrame(iterator: AsyncIterator<IdeBridgeDownlinkFrame>): Promise<IdeBridgeDownlinkFrame> {
  const next = await iterator.next()
  if (next.done === true) throw new Error('downlink stream ended before the expected frame')
  return next.value
}

describe('ideBridge twin wire', () => {
  it('registers a bearer rule strictly scoped to the twin-facing endpoints', async () => {
    const { rules } = await harness()
    expect(rules).toHaveLength(1)
    expect(rules[0]!.endpoints).toEqual(['ideBridge/downlink', 'ideBridge/report'])
  })

  it('open enqueues downlink frames the token-bound stream receives in order', async () => {
    const { ide } = await harness()
    const controller = new AbortController()
    const bogus = ide.downlink({ token: 'bogus' }, controller.signal)[Symbol.asyncIterator]()
    await expect(bogus.next()).rejects.toThrow(RemoteError)

    const status = await ide.status('s1', new AbortController().signal)
    expect(status.ready).toBe(true)
    const token = status.tkn as string

    await ide.open('s1', { path: '/repo/a.ts', line: 4 }, new AbortController().signal)
    const framesBeforeSeat = ide.downlink({ token }, controller.signal)[Symbol.asyncIterator]()
    expect(await nextFrame(framesBeforeSeat)).toEqual(
      { type: 'ideBridge/open', path: '/repo/a.ts', line: 4 },
    )
    await framesBeforeSeat.return?.()

    await ide.open('s1', { path: '/repo/b.ts' }, new AbortController().signal)
    const second = ide.downlink({ token }, controller.signal)[Symbol.asyncIterator]()
    expect(await nextFrame(second)).toEqual({ type: 'ideBridge/open', path: '/repo/b.ts' })
    await second.return?.()
    controller.abort()
  })

  it('report hello binds the seat; events before it fail with a named Remote code', async () => {
    const { ide } = await harness()
    await ide.status('s1', new AbortController().signal)
    const token = (await ide.status('s1', new AbortController().signal)).tkn as string
    await expect(
      ide.report({ token, event: { type: 'save', path: '/repo/a.ts' } }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'ide/seat-not-helloed' })
    await ide.report({
      token,
      event: { type: 'hello', extensionId: 'dsh.do-harness-bridge', version: '0.0.1', workspaceRoot: '/repo' },
    }, new AbortController().signal)
    await expect(
      ide.report({ token, event: { type: 'save', path: '/repo/a.ts' } }, new AbortController().signal),
    ).resolves.toBeUndefined()
    await expect(
      ide.report({ token: 'bogus', event: { type: 'save', path: '/repo/a.ts' } }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'ide/token-unknown' })
  })
})
