// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { makeTranslate, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { TwinFrame } from '../src/client/twin.tsx'
import type { TwinFrameProps } from '../src/client/twin.tsx'
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
const frameT: TwinFrameProps['t'] = t

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

function props(session: string, status: VscodeBodyProps['status'], contentId = 'sidebar://vscode'): VscodeBodyProps {
  return {
    useTabInfo: () => ({ tab: { contentId } }),
    sessionId: session as SessionId,
    status,
    t,
  } as unknown as VscodeBodyProps
}

function view(session: string, status: VscodeBodyProps['status'], contentId = 'sidebar://vscode') {
  return render(<VscodeBody {...props(session, status, contentId)} />)
}

function frameSrc(root: string | null, tkn = 'tok'): string {
  const folder = root === null ? '' : `&folder=${encodeURIComponent(root)}`
  return `http://127.0.0.1:45999/?tkn=${tkn}${folder}&dshGlass=1`
}

const records = (container: HTMLElement): HTMLDivElement[] =>
  [...container.querySelectorAll('[data-twin-record]')] as HTMLDivElement[]
const currentRecord = (container: HTMLElement): HTMLDivElement | undefined =>
  records(container).find(record => record.hasAttribute('data-current'))
const currentFrame = (container: HTMLElement): HTMLIFrameElement | null =>
  currentRecord(container)?.querySelector('iframe') ?? null

async function mount(session: string, value: IdeBridgeStatus) {
  const v = render(<VscodeBody {...props(session, statusWith(value))} />)
  await act(async () => {})
  return v
}

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

  it('mounts the frame inline without a folder query when the twin has no workspace root', async () => {
    const v = await mount('n1', ready(null))
    await waitFor(() => {
      const frame = currentFrame(v.container)
      expect(frame?.getAttribute('src')?.startsWith('http://127.0.0.1:45999/?tkn=tok')).toBe(true)
      expect(frame?.getAttribute('src')).not.toContain('folder=')
    })
    v.unmount()
  })
})

describe('the twin frame (rendered inline)', () => {
  it('renders an iframe with the given src and a boot cover until load', async () => {
    vi.useFakeTimers()
    const v = render(<TwinFrame src={frameSrc('/wZ')} t={frameT} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(v.container.querySelector('output')).not.toBeNull()
    const frame = v.container.querySelector('iframe')
    expect(frame).not.toBeNull()
    expect(frame?.getAttribute('src')).toContain('folder=%2FwZ')
    if (frame) fireEvent.load(frame)
    await act(async () => { await vi.advanceTimersByTimeAsync(1_300) })
    expect(v.container.querySelector('output')).toBeNull()
    v.unmount()
  })

  it('renders nothing visible when src is null', () => {
    const v = render(<TwinFrame src={null} t={frameT} />)
    expect(v.container.querySelector('iframe')).toBeNull()
    v.unmount()
  })
})

describe('TwinFrame focus guard', () => {
  it('hands an automated focus grab back forever', async () => {
    vi.useFakeTimers()
    const v = render(<TwinFrame src={frameSrc('/wF')} t={frameT} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    const frame = v.container.querySelector('iframe') as HTMLIFrameElement
    expect(frame).not.toBeNull()
    const composer = document.createElement('div')
    composer.tabIndex = 0
    document.body.appendChild(composer)
    try {
      frame.focus()
      fireEvent.blur(window)
      expect(document.activeElement).toBe(document.body)

      composer.focus()
      expect(document.activeElement).toBe(composer)

      frame.focus()
      fireEvent.blur(window)
      expect(document.activeElement).toBe(composer)

      fireEvent.load(frame)
      await act(async () => { await vi.advanceTimersByTimeAsync(1_300) })
      composer.focus()
      frame.focus()
      fireEvent.blur(window)
      expect(document.activeElement).toBe(composer)

      frame.dispatchEvent(new Event('pointerover', { bubbles: true }))
      frame.focus()
      fireEvent.blur(window)
      expect(document.activeElement).toBe(frame)
      fireEvent.blur(window)
      expect(document.activeElement).toBe(frame)
      composer.focus()
      frame.dispatchEvent(new Event('pointerout', { bubbles: true }))
      frame.focus()
      fireEvent.blur(window)
      expect(document.activeElement).toBe(composer)

      fireEvent.keyDown(window, { key: 'Tab' })
      frame.focus()
      fireEvent.blur(window)
      expect(document.activeElement).toBe(frame)
      composer.focus()
      frame.focus()
      fireEvent.blur(window)
      expect(document.activeElement).toBe(composer)
    } finally {
      composer.remove()
      v.unmount()
    }
  })

  it('hands a boot-time grab back to the focus that predates the guard', async () => {
    vi.useFakeTimers()
    const composer = document.createElement('div')
    composer.tabIndex = 0
    document.body.appendChild(composer)
    composer.focus()
    expect(document.activeElement).toBe(composer)
    try {
      const v = render(<TwinFrame src={frameSrc('/wG')} t={frameT} />)
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      const frame = v.container.querySelector('iframe') as HTMLIFrameElement
      frame.focus()
      fireEvent.blur(window)
      expect(document.activeElement).toBe(composer)
      v.unmount()
    } finally {
      composer.remove()
    }
  })
})
