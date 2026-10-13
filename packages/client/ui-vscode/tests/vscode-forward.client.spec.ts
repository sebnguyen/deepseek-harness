// @vitest-environment jsdom
/** File forwarding: tab-address → session-twin open calls. */

import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { forwardRequestOf, useVscodeAddressForward } from '../src/client/forward.ts'

afterEach(() => {
  cleanup()
})

describe('forwardRequestOf', () => {
  it('maps session file addresses to absolute twin opens', () => {
    expect(forwardRequestOf('dsh-resource://file/session/sid-7/src/app.ts', '/repo/worktree')).toEqual({
      sessionId: 'sid-7',
      path: '/repo/worktree/src/app.ts',
    })
  })

  it('generous session ids survive parsing URL-decoded, duplicates merge once', () => {
    expect(forwardRequestOf('dsh-resource://file/session/user%40local/b.ts', '/repo/')).toEqual({
      sessionId: 'user@local',
      path: '/repo/b.ts',
    })
  })

  it('refuses page tabs, absolute-scope addresses, and empty file paths', () => {
    expect(forwardRequestOf('sidebar://vscode', '/repo')).toBeNull()
    expect(forwardRequestOf('dsh-resource://absolute/etc/hosts', '/repo')).toBeNull()
    expect(forwardRequestOf('dsh-resource://file/session/sid/', '/repo')).toBeNull()
  })
})

describe('useVscodeAddressForward', () => {
  it('sends each new file address once while ready, and stays silent otherwise', () => {
    const send = vi.fn()
    const { rerender } = renderHook(
      ({ address, ready, root }: { address: string; ready: boolean; root: string | null }) =>
        useVscodeAddressForward(address, ready, root, send),
      { initialProps: { address: 'dsh-resource://file/session/sid/a.ts', ready: true, root: '/repo' } },
    )
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[0]).toEqual({ sessionId: 'sid', path: '/repo/a.ts' })
    // Same address → no re-fire.
    rerender({ address: 'dsh-resource://file/session/sid/a.ts', ready: true, root: '/repo' })
    expect(send).toHaveBeenCalledTimes(1)
    // New address → one more open.
    rerender({ address: 'dsh-resource://file/session/sid/b.ts', ready: true, root: '/repo' })
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1]?.[0]).toEqual({ sessionId: 'sid', path: '/repo/b.ts' })
  })

  it('sends nothing when the twin is missing its root or not yet ready', () => {
    const send = vi.fn()
    renderHook(
      ({ address, ready, root }: { address: string; ready: boolean; root: string | null }) =>
        useVscodeAddressForward(address, ready, root, send),
      { initialProps: { address: 'dsh-resource://file/session/sid/a.ts', ready: false, root: null } },
    )
    expect(send).not.toHaveBeenCalled()
  })
})
