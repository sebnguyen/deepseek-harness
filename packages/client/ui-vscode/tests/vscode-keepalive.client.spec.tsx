// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { makeTranslate, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { resetTwinFrames, TwinFrameHost } from '../src/client/keep-alive.tsx'
import type { TwinFrameHostProps } from '../src/client/keep-alive.tsx'
import { zh } from '../src/client/locales.ts'
import type { IdeBridgeStatus } from '../src/client/rpc.ts'
import { VscodeBody } from '../src/client/VscodeBody.tsx'
import type { VscodeBodyProps } from '../src/client/VscodeBody.tsx'

let hostView: ReturnType<typeof render> | null = null

afterEach(() => {
  cleanup()
  resetTwinFrames()
  hostView = null
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

/** One app-lifetime host per test, as the shell provides in the product. */
function host(): void {
  if (hostView === null) hostView = render(<TwinFrameHost {...{} as unknown as TwinFrameHostProps} />)
}

const frames = (): HTMLIFrameElement[] => [...document.querySelectorAll('iframe')]
const floatOf = (frame: HTMLIFrameElement): HTMLDivElement => frame.parentElement as HTMLDivElement

async function mount(session: string, value: IdeBridgeStatus) {
  host()
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

  it('shows the unavailable line when the remote call itself fails', async () => {
    const errored = view('f1', statusErroring('gateway down'))
    await act(async () => {})
    expect(errored.container.querySelector('output')?.textContent).toBe(zh['state.unavailable'])
    errored.unmount()
  })

  it('shows the failed line with the spawn detail, and reads the session off file addresses', async () => {
    host()
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

  it('mounts the frame without a folder query when the twin has no workspace root', async () => {
    const bare = await mount('n1', ready(null))
    await waitFor(() => {
      const frame = frames()[0]
      expect(frame?.getAttribute('src')?.startsWith('http://127.0.0.1:45999/?tkn=tok')).toBe(true)
      expect(frame?.getAttribute('src')).not.toContain('folder=')
    })
    bare.unmount()
  })
})

describe('workspace-keyed keep-alive floats', () => {
  it('keeps one frame per workspace alive across a session remount without ever moving it', async () => {
    const a = await mount('m1', ready('/wA'))
    await waitFor(() => { expect(frames().length).toBe(1) })
    const frame = frames()[0]
    if (frame === undefined) throw new Error('frame missing')
    const float = floatOf(frame)
    expect(frame.getAttribute('src')).toContain('folder=%2FwA')
    // The frame's one and only home: the host's body-level float, visible while staked.
    expect(float.parentElement).toBe(document.body)
    expect(float.style.display).toBe('block')
    a.unmount()

    // Parked, not removed: the document survives the session switch.
    expect(float.parentElement).toBe(document.body)
    expect(float.style.display).toBe('none')

    const b = await mount('m2', ready('/wA'))
    if (frame === undefined) throw new Error('frame missing')
    expect(frames()).toEqual([frame])
    expect(floatOf(frame).style.display).toBe('block')
    b.unmount()
    expect(floatOf(frame).style.display).toBe('none')
  })

  it('gives each workspace its own float and restores the first on return', async () => {
    const a = await mount('e1', ready('/wA'))
    await waitFor(() => { expect(frames().length).toBe(1) })
    const frameA = frames()[0]
    if (frameA === undefined) throw new Error('first frame missing')
    a.unmount()

    const b = await mount('e2', ready('/wB'))
    await waitFor(() => { expect(frames().length).toBe(2) })
    const frameB = frames().find(candidate => candidate !== frameA)
    if (frameB === undefined) throw new Error('second frame missing')
    expect(floatOf(frameB).style.display).toBe('block')
    expect(floatOf(frameA).style.display).toBe('none')
    b.unmount()

    const c = await mount('e3', ready('/wA'))
    await waitFor(() => { expect(floatOf(frameA).style.display).toBe('block') })
    expect(frames().length).toBe(2)
    expect(floatOf(frameB).style.display).toBe('none')
    c.unmount()
  })

  it('loads a fresh frame when the ready src changes', async () => {
    const a = await mount('r1', ready('/wA', 'one'))
    await waitFor(() => { expect(frames().length).toBe(1) })
    const frameA = frames()[0]
    if (frameA === undefined) throw new Error('first frame missing')
    a.unmount()

    const b = await mount('r2', ready('/wA', 'two'))
    await waitFor(() => {
      expect(frames().find(frame => frame.getAttribute('src')?.includes('tkn=two'))).toBeDefined()
    })
    const shown = frames().find(frame => floatOf(frame).style.display === 'block')
    expect(shown?.getAttribute('src')).toContain('tkn=two')
    expect(floatOf(frameA).style.display).toBe('none')
    b.unmount()
  })

  it('never evicts a staked frame, and drops the oldest parked one past the cap', async () => {
    const a = await mount('v1', ready('/w1'))
    const b = await mount('v2', ready('/w2'))
    await waitFor(() => { expect(frames().length).toBe(2) })
    const [frame1, frame2] = frames()

    // A third workspace mounts while two frames are staked: nothing is evicted.
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

  it('shows one float for simultaneous bodies, keeping it visible while any stake remains', async () => {
    const view1 = await mount('j1', ready('/wJ'))
    const frame = frames()[0]
    if (frame === undefined) throw new Error('frame missing')
    expect(frame).toBeDefined()

    const view2 = await mount('j2', ready('/wJ'))
    expect(frames().length).toBe(1)

    view1.unmount()
    expect(floatOf(frame).style.display).toBe('block')
    view2.unmount()
    expect(floatOf(frame).style.display).toBe('none')
    expect(frame?.isConnected).toBe(true)
  })

  it('ignores a status answer that lands after the body unmounted, across a poll tick', async () => {
    vi.useFakeTimers()
    let resolve: (result: RemoteResult<IdeBridgeStatus>) => void = () => {}
    const deferred = vi.fn((): Promise<RemoteResult<IdeBridgeStatus>> => {
      return new Promise<RemoteResult<IdeBridgeStatus>>((done) => { resolve = done })
    })
    const gone = view('g1', deferred)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    // One poll interval fires while the body is still mounted and in flight.
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500) })
    gone.unmount()
    resolve({ ok: true, value: ready('/wG') })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(frames().length).toBe(0)
  })

  it('follows its box rect while staked', async () => {
    const v = await mount('p1', ready('/wP'))
    const frame = frames()[0]
    if (frame === undefined) throw new Error('frame missing')
    const box = v.container.firstElementChild as HTMLDivElement
    box.getBoundingClientRect = (): DOMRect => ({
      left: 12,
      top: 34,
      width: 560,
      height: 780,
      right: 572,
      bottom: 814,
      x: 12,
      y: 34,
      toJSON: () => ({}),
    })
    await waitFor(() => {
      const style = floatOf(frame).style
      expect(style.left).toBe('12px')
      expect(style.top).toBe('34px')
      expect(style.width).toBe('560px')
    })
    v.unmount()
  })

  it('restaking a loaded frame does not resurrect the boot cover', async () => {
    vi.useFakeTimers()
    host()
    const first = view('z1', statusWith(ready('/wZ')))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    const frame = frames()[0]
    if (frame === undefined) throw new Error('frame missing')
    fireEvent.load(frame)
    await act(async () => { await vi.advanceTimersByTimeAsync(1_300) })
    expect(document.body.querySelector('output')).toBeNull()
    first.unmount()

    // Same workspace under a fresh session body: the cover seals the first
    // boot only, never an already-alive frame.
    const second = view('z2', statusWith(ready('/wZ')))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(document.body.querySelector('output')).toBeNull()
    second.unmount()
  })

  it('seals the boot cover inside the float until the workbench document loads', async () => {
    vi.useFakeTimers()
    host()
    const sealed = view('b1', statusWith(ready('/wA')))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    // The cover lives in the body-level float, not in the body's own box.
    expect(sealed.container.querySelector('output')).toBeNull()
    expect(document.body.querySelector('output')).not.toBeNull()

    const frame = frames()[0]
    expect(frame).toBeDefined()
    fireEvent.load(frame as HTMLIFrameElement)
    await act(async () => { await vi.advanceTimersByTimeAsync(1_300) })
    expect(document.body.querySelector('output')).toBeNull()
    sealed.unmount()
  })
})
