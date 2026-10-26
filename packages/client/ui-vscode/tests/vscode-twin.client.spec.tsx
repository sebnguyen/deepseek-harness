// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { makeTranslate, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { zh } from '../src/client/locales.ts'
import type { IdeBridgeStatus } from '../src/client/rpc.ts'
import { VscodeBody } from '../src/client/VscodeBody.tsx'
import type { VscodeBodyProps } from '../src/client/VscodeBody.tsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const t: VscodeBodyProps['t'] = makeTranslate(zh)

function ready(root: string | null, tkn = 'tok'): IdeBridgeStatus {
  return { enabled: true, ready: true, url: 'http://127.0.0.1:45999', tkn, workspaceRoot: root, detail: null }
}

function idle(): IdeBridgeStatus {
  return { enabled: false, ready: false, url: null, tkn: null, workspaceRoot: null, detail: null }
}

function statusWith(value: IdeBridgeStatus): VscodeBodyProps['status'] {
  return vi.fn(async (): Promise<RemoteResult<IdeBridgeStatus>> => ({ ok: true, value }))
}

function statusErroring(message: string): VscodeBodyProps['status'] {
  return vi.fn(async (): Promise<RemoteResult<IdeBridgeStatus>> => ({
    ok: false,
    error: new RemoteError('gateway/cancelled', message, {}),
  }))
}

function statusFailing(message: string): VscodeBodyProps['status'] {
  return statusWith({ enabled: true, ready: false, url: null, tkn: null, workspaceRoot: null, detail: message })
}

function props(session: string, status: VscodeBodyProps['status'], address = 'sidebar://vscode'): VscodeBodyProps {
  return {
    useTabInfo: () => ({
      tab: {
        contentId: 'sidebar://vscode',
        navigation: { address, params: undefined, revision: 0 },
      },
    }),
    sessionId: session as SessionId,
    status,
    t,
  } as unknown as VscodeBodyProps
}

function view(session: string, status: VscodeBodyProps['status'], address = 'sidebar://vscode') {
  return render(<VscodeBody {...props(session, status, address)} />)
}

const frame = (container: HTMLElement): HTMLIFrameElement | null => container.querySelector('iframe')
const cover = (container: HTMLElement): HTMLElement | null => container.querySelector('[data-twin-cover]')

describe('VscodeBody state lines', () => {
  it('shows the opening line before any answer and for a not-ready twin without detail', async () => {
    const first = view('s1', statusWith(ready('/wA')))
    expect(first.container.querySelector('output')?.textContent).toBe(zh['state.opening'])
    first.unmount()

    const slow = view('s2', statusWith({ ...ready('/wA'), ready: false, url: null, tkn: null }))
    await act(async () => {})
    expect(slow.container.querySelector('output')?.textContent).toBe(zh['state.opening'])
    slow.unmount()
  })

  it('shows the unavailable line for a disabled twin', async () => {
    const disabled = view('s1', statusWith(idle()))
    await act(async () => {})
    expect(disabled.container.querySelector('output')?.textContent).toBe(zh['state.unavailable'])
    disabled.unmount()
  })

  it('shows the unavailable line when the remote call itself fails', async () => {
    const errored = view('f1', statusErroring('gateway down'))
    await act(async () => {})
    expect(errored.container.querySelector('output')?.textContent).toBe(zh['state.unavailable'])
    errored.unmount()
  })

  it('shows the failed line with the spawn detail, and reads the session off file addresses', async () => {
    const failed = view('s1', statusFailing('boom'))
    await act(async () => {})
    expect(failed.container.textContent).toContain('boom')
    failed.unmount()

    const status = statusWith(ready('/wA'))
    const addr = view('ignored', status, 'dsh-resource://file/session/s9/dir/f.ts')
    await act(async () => {})
    expect(status).toHaveBeenCalledWith('s9', expect.anything())
    addr.unmount()
  })
})

describe('the workspace frame', () => {
  it('renders the ready source in the body own box', async () => {
    const mounted = view('m1', statusWith(ready('/wA')))
    await waitFor(() => {
      expect(frame(mounted.container)?.getAttribute('src')).toBe('http://127.0.0.1:45999/?tkn=tok&folder=%2FwA')
    })
    // The body, not the retired root-scoped seat: the element lives under the
    // body's own box and no shell.ide host remains.
    expect(document.body.querySelector('[data-twin-frame-seat]')).toBeNull()
    expect(mounted.container.querySelector('[data-twin-frame]')).not.toBeNull()
    const element = frame(mounted.container)
    expect(element?.getAttribute('allow')).toBe('clipboard-read; clipboard-write')
    expect(element?.getAttribute('allowtransparency')).toBe('true')
    mounted.unmount()
  })

  it('mounts the frame without a folder query when the twin has no workspace root', async () => {
    const bare = view('n1', statusWith(ready(null)))
    await waitFor(() => {
      const src = frame(bare.container)?.getAttribute('src')
      expect(src?.startsWith('http://127.0.0.1:45999/?tkn=tok')).toBe(true)
      expect(src).not.toContain('folder=')
    })
    bare.unmount()
  })

  it('removes the document with the body: a tab switch boots cold', async () => {
    const mounted = view('t1', statusWith(ready('/wA')))
    await waitFor(() => { expect(frame(mounted.container)).not.toBeNull() })
    const element = frame(mounted.container)
    if (element === null) throw new Error('frame missing')
    mounted.unmount()
    expect(element.isConnected).toBe(false)
  })

  it('seals the boot cover until load settles, and re-seals on a changed source', async () => {
    vi.useFakeTimers()
    const mounted = view('z1', statusWith(ready('/wZ')))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(cover(mounted.container)).not.toBeNull()
    const element = frame(mounted.container)
    if (element === null) throw new Error('frame missing')
    fireEvent.load(element)
    await act(async () => { await vi.advanceTimersByTimeAsync(1_300) })
    expect(cover(mounted.container)).toBeNull()

    // A new workspace source is a fresh document: the cover comes back.
    mounted.rerender(<VscodeBody {...props('z1', statusWith(ready('/wS')))} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(cover(mounted.container)).not.toBeNull()
    mounted.unmount()
  })

  it('hands an automated focus grab back, and honors a pointed or tabbed entry', async () => {
    vi.useFakeTimers()
    const composer = document.createElement('div')
    composer.tabIndex = 0
    document.body.appendChild(composer)
    try {
      const mounted = view('f1', statusWith(ready('/wF')))
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      const element = frame(mounted.container)
      if (element === null) throw new Error('frame missing')

      // No owner on record: the grab is dumped onto <body>, never kept.
      element.focus()
      fireEvent.blur(window)
      expect(document.activeElement).toBe(document.body)

      composer.focus()
      element.focus()
      fireEvent.blur(window)
      expect(document.activeElement).toBe(composer)

      // A pointer over the frame marks the user's own entry.
      element.dispatchEvent(new Event('pointerover', { bubbles: true }))
      element.focus()
      fireEvent.blur(window)
      expect(document.activeElement).toBe(element)
      fireEvent.blur(window)
      expect(document.activeElement).toBe(element)
      composer.focus()
      element.dispatchEvent(new Event('pointerout', { bubbles: true }))
      element.focus()
      fireEvent.blur(window)
      expect(document.activeElement).toBe(composer)

      // A Tab keydown grants the same entry for the keyboard, once.
      fireEvent.keyDown(window, { key: 'Tab' })
      element.focus()
      fireEvent.blur(window)
      expect(document.activeElement).toBe(element)
      composer.focus()
      element.focus()
      fireEvent.blur(window)
      expect(document.activeElement).toBe(composer)
      mounted.unmount()
    } finally {
      composer.remove()
    }
  })
})
