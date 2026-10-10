/**
 * The seat: engine #3 boots only under parentage; its generated halves mount
 * through the shared carrier and the `ideHost` key gates the feature world.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { activate } from '../src/entry.ts'
import { eventDownlink, seatEvidence, seatFetch, SEAT_REMOTES, startSeat } from '../src/seat.ts'

const EVIDENCE = { gatewayUrl: 'http://127.0.0.1:7200', token: 'tok', sessionId: 's1' }

describe('seatEvidence', () => {
  it('requires every spawn fact and strips trailing slashes', () => {
    expect(seatEvidence({})).toBeUndefined()
    expect(seatEvidence({ DSH_GATEWAY_URL: '', DSH_IDE_TOKEN: 't', DSH_SESSION_ID: 's' })).toBeUndefined()
    const evidence = seatEvidence({ DSH_GATEWAY_URL: 'http://127.0.0.1:7200/', DSH_IDE_TOKEN: 'tok', DSH_SESSION_ID: 's1' })
    expect(evidence).toEqual(EVIDENCE)
  })
})

describe('seatFetch', () => {
  it('re-anchors the house URL onto the gateway with the token leg', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal('fetch', async (url: URL, init?: RequestInit) => {
      seen.push({ url: String(url), init: init ?? {} })
      return new Response('{}')
    })
    const fetcher = seatFetch(EVIDENCE)
    await fetcher(new URL('http://dsh.internal/api/ide/hello'), { method: 'POST' })
    const call = seen[0]
    if (call === undefined) throw new Error('no call')
    expect(call.url).toBe('http://127.0.0.1:7200/api/ide/hello?token=tok')
    vi.unstubAllGlobals()
  })
})

describe('startSeat', () => {
  it('mounts the generated halves behind the keys and stays quiet on the wire', async () => {
    const seat = await startSeat(EVIDENCE)
    const remote = seat.context.get('remote') as unknown
    expect(remote).toBeDefined()
    expect(seat.context.get('remote.ide')).toBeDefined()
    expect(seat.context.get('remote.checkpoint')).toBeDefined()
    expect(SEAT_REMOTES).toHaveLength(2)
    await seat.dispose()
  }, 15_000)

  it('pends the event downlink until aborted after one ready frame', async () => {
    const controller = new AbortController()
    const reader = eventDownlink('remote.events', controller.signal)[Symbol.asyncIterator]()
    const first = await reader.next()
    expect(first.value).toMatchObject({ type: 'ready' })
    const parked = reader.next()
    controller.abort()
    expect((await parked).done).toBe(true)
  })
})

describe('activate', () => {
  it('returns the inert disposer without an evidence row and never boots', async () => {
    const vscode = {
      workspace: {
        workspaceFolders: undefined,
        getConfiguration: () => ({ update: async () => {} }),
        onDidSaveTextDocument: () => ({ dispose() {} }),
      },
      window: { onDidChangeActiveTextEditor: () => ({ dispose() {} }) },
    } as unknown as typeof import('vscode')
    const dispose = await activate({ vscode, env: {} })
    dispose()
    expect(typeof dispose).toBe('function')
  })

  it('boots the feature plugins under the ideHost key with a full env', async () => {
    const disposals: string[] = []
    const vscode = {
      workspace: {
        workspaceFolders: [{ uri: { fsPath: '/work' } }],
        getConfiguration: () => ({ update: async () => {} }),
        onDidSaveTextDocument: () => {
          disposals.push('save-listener')
          return { dispose: () => { disposals.push('save-disposed') } }
        },
      },
      window: {
        onDidChangeActiveTextEditor: () => ({ dispose: () => { disposals.push('editor-disposed') } }),
      },
      commands: { executeCommand: async () => {} },
      comments: {
        createCommentController: () => ({
          createCommentThread: () => ({ comments: [], dispose() {} }),
          dispose() { disposals.push('comments-disposed') },
        }),
      },
      Range: class RangeCtor {
        constructor(
          readonly startLine: number,
          readonly startCharacter: number,
          readonly endLine: number,
          readonly endCharacter: number,
        ) {}
      },
      Uri: { file: (path: string) => ({ fsPath: path }) },
    } as unknown as typeof import('vscode')
    const dispose = await activate({ vscode, env: { DSH_GATEWAY_URL: 'http://127.0.0.1:7200', DSH_IDE_TOKEN: 'tok', DSH_SESSION_ID: 's1' } })
    await new Promise(resolve => setTimeout(resolve, 20))
    dispose()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(disposals).toContain('editor-disposed')
  }, 20_000)
})

describe('context shape', () => {
  it('keeps ideHost absent until the seat provides it', () => {
    const ctx = new Context()
    expect(ctx.get('ideHost')).toBeUndefined()
  })
})
