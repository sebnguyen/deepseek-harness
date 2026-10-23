/** The ideBridge twin-wire: open/downlink/report with token-bearing seats. */

import { tmpdir } from 'node:os'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { ConnectionBearerRule } from '@deepseek-ai/dsh-client-connection'
import Ide from '../src/index.ts'
import type { IdeBridgeDownlinkFrame } from '../src/index.ts'
import { TWIN_PORT_PIN_BASENAME } from '../src/twin-port.ts'
import { twinStateDirName, twinTokenPinName } from '../src/twin-token.ts'

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

async function harness(): Promise<{ ide: Ide; rules: ConnectionBearerRule[]; dist: string }> {
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
  return { ide, rules, dist }
}

/** A harness variant recording spawn argv and accepting arbitrary sessions, for state-layout specs. */
async function harnessSlots(
  sessions: { id: string; header?: { cwd?: string } }[],
): Promise<{ ide: Ide; spawns: string[][]; dist: string }> {
  const ctx = new Context()
  contexts.push(ctx)
  const dist = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-ide-bridge-')))
  tempDirs.push(dist)
  const spawns: string[][] = []
  ctx.provide('subprocess', {
    spawn: (options: { argv: string[] }) => {
      spawns.push([...options.argv])
      return {
        done: new Promise(() => undefined),
        terminate: () => undefined,
        collected: { stderr: { readFrom: () => ({ text: '' }) } },
      } as never
    },
  })
  provideSessions(ctx, sessions)
  provideSandboxPolicy(ctx, '/sandbox')
  provideTypert(ctx)
  provideConnection(ctx)
  const ide = new Ide(ctx, { dist, readinessTimeoutMs: 1_000, readinessPollMs: 5 })
  await new Promise(resolve => setTimeout(resolve, 0))
  return { ide, spawns, dist }
}

/** The value behind one `--flag` in a recorded spawn argv. */
function argOf(argv: string[], flag: string): string {
  const value = argv[argv.indexOf(flag) + 1]
  if (value === undefined) throw new Error(`spawn argv lost flag ${flag}`)
  return value
}

async function nextFrame(iterator: AsyncIterator<IdeBridgeDownlinkFrame>): Promise<IdeBridgeDownlinkFrame> {
  const next = await iterator.next()
  if (next.done === true) throw new Error('downlink stream ended before the expected frame')
  return next.value
}

/** Read one twin slot's staged bridge seat token (not the REH connection token). */
async function seatTokenOf(dist: string, workspaceKey: string): Promise<string> {
  const bridgePath = join(dist, '.dsh', twinStateDirName(workspaceKey), 'bridge.json')
  return (JSON.parse(await readFile(bridgePath, 'utf8')) as { token: string }).token
}

/** Read one spawn argv's staged bridge identity (the per-twin seat facts). */
async function bridgeIdentityOf(argv: string[]): Promise<{ token: string; workspaceKey: string }> {
  const bridgePath = join(argOf(argv, '--extensions-dir'), '..', 'bridge.json')
  return JSON.parse(await readFile(bridgePath, 'utf8')) as { token: string; workspaceKey: string }
}

describe('ideBridge twin wire', () => {
  it('registers a bearer rule scoped to the twin wire, the event-result RPC, and the plane remotes', async () => {
    const { rules } = await harness()
    expect(rules).toHaveLength(1)
    // `$events/result` is what keeps a cookie-less seat's connection
    // generation alive while an approval or user-question waterfall is
    // pending; see the bearer-rule comment in src/index.ts.
    expect(rules[0]!.endpoints).toEqual([
      '$events/result',
      'ideBridge/downlink',
      'ideBridge/report',
      'checkpoint/slots',
      'checkpoint/blob',
      'lineNotes/state',
      'lineNotes/add',
    ])
  })

  it('open enqueues downlink frames the seat-token-bound stream receives in order', async () => {
    const { ide, dist } = await harness()
    const controller = new AbortController()
    const bogus = ide.downlink({ token: 'bogus' }, controller.signal)[Symbol.asyncIterator]()
    await expect(bogus.next()).rejects.toThrow(RemoteError)

    const status = await ide.status('s1', new AbortController().signal)
    expect(status.ready).toBe(true)
    const token = await seatTokenOf(dist, '/repo')

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

  it('activate enqueues the focused-session frame for the workspace twin', async () => {
    const { ide, dist } = await harness()
    const controller = new AbortController()
    await ide.status('s1', new AbortController().signal)
    const token = await seatTokenOf(dist, '/repo')

    await ide.activate('s1', new AbortController().signal)
    const frames = ide.downlink({ token }, controller.signal)[Symbol.asyncIterator]()
    expect(await nextFrame(frames)).toEqual({ type: 'ideBridge/activate', sessionId: 's1' })
    await frames.return?.()
    controller.abort()
  })

  it('report hello binds the seat; other verbs fail with a named Remote code', async () => {
    const { ide, dist } = await harness()
    await ide.status('s1', new AbortController().signal)
    const token = await seatTokenOf(dist, '/repo')
    await ide.report({
      token,
      event: { type: 'hello', extensionId: 'dsh.do-harness-bridge', version: '0.0.1', workspaceRoot: '/repo' },
    }, new AbortController().signal)
    // A non-hello verb (e.g. one of the removed projection events) must still be refused loudly.
    await expect(
      ide.report({ token, event: { type: 'save', path: '/repo/a.ts' } as never }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'ide/report-invalid' })
    await expect(
      ide.report({ token: 'bogus', event: { type: 'hello', extensionId: 'x', version: '0', workspaceRoot: null } }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'ide/token-unknown' })
  })
})

describe('twin state layout', () => {
  it('spawns each workspace twin into its own slot so siblings never share a bridge.json identity', async () => {
    const { ide, spawns, dist } = await harnessSlots([
      { id: 's1', header: { cwd: '/repo-a' } },
      { id: 's2', header: { cwd: '/repo-b' } },
    ])
    const s1 = await ide.status('s1', new AbortController().signal)
    const s2 = await ide.status('s2', new AbortController().signal)
    expect(s1.ready).toBe(true)
    expect(s2.ready).toBe(true)
    expect(spawns).toHaveLength(2)

    // s1's twin is the boot-time warmup spawn; s2's twin spawns on first ask.
    const flags = ['--server-data-dir', '--user-data-dir', '--extensions-dir']
    for (const flag of flags) {
      expect(argOf(spawns[0]!, flag)).not.toBe(argOf(spawns[1]!, flag))
      expect(argOf(spawns[0]!, flag)).toContain(join(dist, '.dsh', 'twin.'))
    }

    // Each slot's bridge.json (two levels up from the twin's extension dir,
    // i.e. one level up from --extensions-dir) carries ITS OWN seat token —
    // the shared-file layout was the lost-frames bug. That secret is private
    // to the bridge and is not the REH connection token the iframe rides.
    const first = await bridgeIdentityOf(spawns[0]!)
    const second = await bridgeIdentityOf(spawns[1]!)
    expect(first.token).not.toBe(second.token)
    expect(first.token).not.toBe(s1.tkn)
    expect(second.token).not.toBe(s2.tkn)
    expect([first.workspaceKey, second.workspaceKey].sort()).toEqual(['/repo-a', '/repo-b'])
  })

  it('serves every twin one host-scoped connection token so the vscode-tkn cookie cannot clobber a sibling', async () => {
    const { ide, spawns } = await harnessSlots([
      { id: 's1', header: { cwd: '/repo-a' } },
      { id: 's2', header: { cwd: '/repo-b' } },
    ])
    const s1 = await ide.status('s1', new AbortController().signal)
    const s2 = await ide.status('s2', new AbortController().signal)
    expect(s1.ready).toBe(true)
    expect(s2.ready).toBe(true)
    // A browser scopes a cookie by host, not port: two different secrets on
    // 127.0.0.1 overwrote `vscode-tkn`, so the twin loaded last 403'd the
    // sibling's cookie-only requests (each webview's pre/index.html). One
    // token per host keeps every twin's port authorized by the same cookie.
    expect(s1.tkn).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(s2.tkn).toBe(s1.tkn)
    expect(argOf(spawns[0]!, '--connection-token')).toBe(argOf(spawns[1]!, '--connection-token'))
    // The bridge seat identity stays per spawn, so the downlink never merges.
    expect((await bridgeIdentityOf(spawns[0]!)).token).not.toBe((await bridgeIdentityOf(spawns[1]!)).token)
  })

  it('adopts the legacy port pin (but mints a fresh token) from the shared .dsh root', async () => {
    const sessions = [{ id: 's1', header: { cwd: '/repo' } }]
    const { ide, dist } = await harnessSlots(sessions)
    const legacyRoot = join(dist, '.dsh')
    await mkdir(legacyRoot, { recursive: true })
    const legacyToken = 'a'.repeat(32)
    await writeFile(join(legacyRoot, twinTokenPinName('/repo')), `${legacyToken}\n`, 'utf8')
    await writeFile(join(legacyRoot, TWIN_PORT_PIN_BASENAME), '46001\n', 'utf8')

    const status = await ide.status('s1', new AbortController().signal)
    expect(status.ready).toBe(true)
    // The legacy token pin is never read: the REH connection token is minted
    // per host and the bridge seat token per spawn.
    expect(status.tkn).not.toBe(legacyToken)
    expect(status.tkn).toMatch(/^[A-Za-z0-9_-]{32}$/)

    const slot = join(dist, '.dsh', twinStateDirName('/repo'))
    const pin = Number.parseInt((await readFile(join(slot, TWIN_PORT_PIN_BASENAME), 'utf8')).trim(), 10)
    expect(Number.isInteger(pin)).toBe(true)
  })
})
