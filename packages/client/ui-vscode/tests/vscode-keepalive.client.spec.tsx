// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { makeTranslate, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { resetTwinFrames } from '../src/client/keep-alive.tsx'
import { zh } from '../src/client/locales.ts'
import type { IdeBridgeStatus } from '../src/client/rpc.ts'
import { VscodeBody } from '../src/client/VscodeBody.tsx'
import type { VscodeBodyProps } from '../src/client/VscodeBody.tsx'

afterEach(() => {
  cleanup()
  resetTwinFrames()
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

function statusFailing(message: string): VscodeBodyProps['status'] {
  return statusWith({ enabled: true, ready: false, url: null, tkn: null, workspaceRoot: null, detail: message })
}

function statusErroring(message: string): VscodeBodyProps['status'] {
  return vi.fn(async (): Promise<RemoteResult<IdeBridgeStatus>> => ({ ok: false, error: new RemoteError('gateway/cancelled', message, {}) }))
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

const frames = (): HTMLIFrameElement[] => [...document.querySelectorAll('iframe')]

async function mount(session: string, value: IdeBridgeStatus) {
  const view = render(<VscodeBody {...props(session, statusWith(value))} />)
  await act(async () => {})
  return view
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

describe('workspace-keyed keep-alive frames', () => {
  it('keeps one live frame per workspace across a session remount', async () => {
    const a = await mount('m1', ready('/wA'))
    await waitFor(() => { expect(frames().length).toBe(1) })
    const frame = frames()[0]
    expect(frame?.getAttribute('src')).toContain('folder=%2FwA')
    expect(frame?.style.display).toBe('block')
    a.unmount()

    // The document survives the session switch, parked hidden in the host.
    expect(frame?.isConnected).toBe(true)
    expect(frame?.style.display).toBe('none')

    const b = await mount('m2', ready('/wA'))
    await waitFor(() => { expect(frame?.style.display).toBe('block') })
    expect(frames()).toEqual([frame])
    b.unmount()
  })

  it('gives each workspace its own frame and restores the first on return', async () => {
    const a = await mount('e1', ready('/wA'))
    await waitFor(() => { expect(frames().length).toBe(1) })
    const frameA = frames()[0]
    a.unmount()

    const b = await mount('e2', ready('/wB'))
    await waitFor(() => { expect(frames().length).toBe(2) })
    const frameB = frames().find(candidate => candidate !== frameA)
    expect(frameB?.style.display).toBe('block')
    expect(frameA?.style.display).toBe('none')
    b.unmount()

    const c = await mount('e3', ready('/wA'))
    await waitFor(() => { expect(frameA?.style.display).toBe('block') })
    expect(frames().length).toBe(2)
    expect(frameB?.style.display).toBe('none')
    c.unmount()
  })

  it('shows the new frame when the ready src changes, parking the old one', async () => {
    const a = await mount('r1', ready('/wA', 'one'))
    await waitFor(() => { expect(frames().length).toBe(1) })
    const frameA = frames()[0]
    a.unmount()

    const b = await mount('r1', ready('/wA', 'two'))
    await waitFor(() => {
      expect(frames().find(frame => frame.getAttribute('src')?.includes('tkn=two'))?.style.display).toBe('block')
    })
    expect(frameA?.style.display).toBe('none')
    b.unmount()
  })

  it('never evicts a shown frame, and drops the oldest parked one past the cap', async () => {
    const a = await mount('v1', ready('/w1'))
    const b = await mount('v2', ready('/w2'))
    await waitFor(() => { expect(frames().length).toBe(2) })
    const [frame1, frame2] = frames()

    // A third workspace mounts while two frames are shown: nothing is evicted.
    const c = await mount('v3', ready('/w3'))
    await waitFor(() => { expect(frames().length).toBe(3) })
    a.unmount()
    b.unmount()

    const d = await mount('v4', ready('/w4'))
    await waitFor(() => { expect(frame1?.isConnected).toBe(false) })
    expect(frame2?.isConnected).toBe(true)
    expect(frames().length).toBe(3)
    c.unmount()
    d.unmount()
  })

  it('mounts the frame without a folder query when the twin has no workspace root', async () => {
    const bare = view('n1', statusWith(ready(null)))
    await act(async () => {})
    await waitFor(() => {
      const frame = frames()[0]
      expect(frame?.getAttribute('src')).toBe('http://127.0.0.1:45999/?tkn=tok&dshGlass=1')
    })
    bare.unmount()
  })

  it('shows the unavailable line when the remote call itself fails', async () => {
    const errored = view('f1', statusErroring('gateway down'))
    await act(async () => {})
    expect(errored.container.querySelector('output')?.textContent).toBe(zh['state.unavailable'])
    errored.unmount()
  })

  it('shares one live frame between simultaneous bodies, keeping it shown while any view remains', async () => {
    vi.useFakeTimers()
    let resolve: (result: RemoteResult<IdeBridgeStatus>) => void = () => {}
    const deferred = vi.fn(async (): Promise<RemoteResult<IdeBridgeStatus>> => {
      return await new Promise<RemoteResult<IdeBridgeStatus>>((done) => { resolve = done })
    })
    const view1 = render(<VscodeBody {...props('j1', statusWith(ready('/wJ')))} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    const frame = frames()[0]
    expect(frame).toBeDefined()

    // A tick resolving after its body unmounts takes the not-mounted bail-out.
    const ghost = render(<VscodeBody {...props('j0', deferred)} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    ghost.unmount()
    resolve({ ok: true, value: ready('/wJ') })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })

    fireEvent.load(frame as HTMLIFrameElement)
    await act(async () => { await vi.advanceTimersByTimeAsync(1_300) })

    const view2 = render(<VscodeBody {...props('j2', statusWith(ready('/wJ')))} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1_300) })
    expect(frames().length).toBe(1)
    expect(deferred).toHaveBeenCalled()

    // The first view leaves; the frame stays shown for the second.
    view1.unmount()
    expect(frame?.style.display).toBe('block')
    view2.unmount()
    expect(frame?.style.display).toBe('none')
    expect(frame?.isConnected).toBe(true)
  })

  it('lifts the boot cover once the workbench document loads', async () => {
    vi.useFakeTimers()
    const sealed = render(<VscodeBody {...props('b1', statusWith(ready('/wA')))} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(sealed.container.querySelector('output')).not.toBeNull()

    const frame = frames()[0]
    expect(frame).toBeDefined()
    fireEvent.load(frame as HTMLIFrameElement)
    await act(async () => { await vi.advanceTimersByTimeAsync(1_300) })
    expect(sealed.container.querySelector('output')).toBeNull()
    sealed.unmount()
  })
})
