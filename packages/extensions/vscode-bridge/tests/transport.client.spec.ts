/** Twin bearer transport: unary bearer-fenced origin override + mux URL decoration. */

import { describe, expect, it } from 'vitest'
import { twinFetch, twinStreamUrlDecorator } from '../src/transport.ts'

describe('twinFetch', () => {
  it('reframes any absolute URL at the twin origin and injects the bearer once', async () => {
    const seen: Array<{ url: string; authorization: string | null }> = []
    const send = twinFetch(
      { dshOrigin: 'http://127.0.0.1:4455', token: 'tkn-1' },
      async (input: URL, init?: { headers?: HeadersInit }) => {
        seen.push({
          url: input.href,
          authorization: new Headers(init?.headers).get('authorization'),
        })
        return new Response('ok')
      },
    )
    await send(new URL('http://dsh.internal/api/ideBridge/report'), { method: 'POST' })
    expect(seen[0]).toEqual({
      url: 'http://127.0.0.1:4455/api/ideBridge/report',
      authorization: 'Bearer tkn-1',
    })
  })

  it('never overrides an upstream-carried credential', async () => {
    const seen: Array<string | null> = []
    const send = twinFetch(
      { dshOrigin: 'http://127.0.0.1:4455', token: 'tkn-1' },
      async (_input: URL, init?: { headers?: HeadersInit }) => {
        seen.push(new Headers(init?.headers).get('authorization') ?? null)
        return new Response('ok')
      },
    )
    const preset = new Headers({ authorization: 'Bearer upstream' })
    await send(new URL('http://dsh.internal/api/ideBridge/report'), { headers: preset })
    expect(seen).toEqual(['Bearer upstream'])
  })

  it('passes through untouched when the spawner left no origin (idle profile)', async () => {
    const seen: string[] = []
    const send = twinFetch({ dshOrigin: '', token: 'tkn-1' }, async (input: URL) => {
      seen.push(input.href)
      return new Response('ok')
    })
    await send(new URL('http://dsh.internal/api/x'), {})
    expect(seen).toEqual(['http://dsh.internal/api/x'])
  })
})

describe('twinStreamUrlDecorator', () => {
  it('retargets to the twin origin and attaches the query tkn', () => {
    const url = new URL('ws://127.0.0.1:9999/api/remote.mux')
    twinStreamUrlDecorator({ dshOrigin: 'http://127.0.0.1:4455', token: 'tkn-1' })(url)
    expect(url.protocol).toBe('http:')
    expect(url.host).toBe('127.0.0.1:4455')
    expect(url.searchParams.get('tkn')).toBe('tkn-1')
  })

  it('is a no-op decoration when the origin is empty', () => {
    const url = new URL('ws://127.0.0.1:9/api/remote.mux')
    twinStreamUrlDecorator({ dshOrigin: '', token: 'tkn-1' })(url)
    expect(url.host).toBe('127.0.0.1:9')
    expect(url.searchParams.has('tkn')).toBe(false)
  })
})
