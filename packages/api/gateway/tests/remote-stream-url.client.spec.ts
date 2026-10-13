/** The mux-URL decorator: page-default resolution, seat-side retargeting, and reset. */

import { afterEach, describe, expect, it } from 'vitest'
import { remoteStreamUrl, setRemoteStreamUrlDecorator } from '../src/client/stream-client.ts'

afterEach(() => {
  setRemoteStreamUrlDecorator(undefined)
})

describe('remote stream URL resolution', () => {
  it('decorates the default page URL only through a seat-side decorator', () => {
    setRemoteStreamUrlDecorator(undefined)
    const url = new URL(remoteStreamUrl())
    expect(url.pathname).toBe('/api/remote.mux')
    expect(url.protocol).toBe('ws:')

    setRemoteStreamUrlDecorator((candidate) => {
      candidate.protocol = 'http:'
      candidate.host = '127.0.0.1:4455'
      candidate.searchParams.set('tkn', 'abc')
    })
    const twin = new URL(remoteStreamUrl())
    expect(twin.host).toBe('127.0.0.1:4455')
    expect(twin.protocol).toBe('ws:')
    expect(twin.searchParams.get('tkn')).toBe('abc')

    setRemoteStreamUrlDecorator(undefined)
    expect(new URL(remoteStreamUrl()).host).toBe(url.host)
  })

  it('maps https origins to wss after decoration', () => {
    ;(globalThis as { location?: { origin: string } }).location = { origin: 'https://harness.example' }
    const decorated = new URL(remoteStreamUrl())
    expect(decorated.protocol).toBe('wss:')
    expect(decorated.host).toBe('harness.example')
    delete (globalThis as Record<string, unknown>)['location']
  })
})
