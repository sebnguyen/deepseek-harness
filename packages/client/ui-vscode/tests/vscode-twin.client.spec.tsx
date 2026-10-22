// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import { makeTranslate, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { resetTwinIntent, TwinFrame } from '../src/client/twin.tsx'
import type { TwinFrameProps } from '../src/client/twin.tsx'
import { zh } from '../src/client/locales.ts'
import type { IdeBridgeStatus } from '../src/client/rpc.ts'
import { VscodeBody } from '../src/client/VscodeBody.tsx'
import type { VscodeBodyProps } from '../src/client/VscodeBody.tsx'

let hostView: ReturnType<typeof render> | null = null

afterEach(() => {
  cleanup()
  resetTwinIntent()
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

function props(session: string, status: VscodeBodyProps['status'], address = 'sidebar://vscode', revision = 0): VscodeBodyProps {
  return {
    useTabInfo: () => ({
      tab: {
        contentId: 'sidebar://vscode',
        navigation: { address, params: undefined, revision },
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

/** The one seat occupant per test, as ui-layout renders it in the product. */
function host(): void {
  if (hostView === null) hostView = render(<TwinFrame {...{ t } as unknown as TwinFrameProps} />)
}

const seat = (): HTMLDivElement => {
  if (hostView === null) throw new Error('seat host not mounted')
  return hostView.container.querySelector('[data-twin-frame-seat]') as HTMLDivElement
}
const records = (): HTMLDivElement[] => [...seat().querySelectorAll('[data-twin-record]')] as HTMLDivElement[]
const currentRecord = (): HTMLDivElement | undefined => records().find(record => record.hasAttribute('data-current'))
const currentFrame = (): HTMLIFrameElement | null => currentRecord()?.querySelector('iframe') ?? null

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
      const frame = currentFrame()
      expect(frame?.getAttribute('src')?.startsWith('http://127.0.0.1:45999/?tkn=tok')).toBe(true)
      expect(frame?.getAttribute('src')).not.toContain('folder=')
    })
    bare.unmount()
  })
})

describe('the twin frame cache', () => {
  it('keeps the live frame alive across a session remount', async () => {
    const a = await mount('m1', ready('/wA'))
    await waitFor(() => { expect(currentFrame()).not.toBeNull() })
    const frame = currentFrame()
    if (frame === null) throw new Error('frame missing')
    expect(frame.getAttribute('src')).toContain('folder=%2FwA')
    expect(records().length).toBe(1)
    a.unmount()

    // Parked, never removed: the document survives the session switch.
    expect(frame.isConnected).toBe(true)
    expect(records()[0]?.style.display).toBe('none')

    const b = await mount('m2', ready('/wA'))
    // Same workspace, same src: the same element shows again, never re-pointed.
    expect(currentFrame()).toBe(frame)
    expect(currentRecord()?.style.display).not.toBe('none')
    expect(records().length).toBe(1)
    b.unmount()
  })

  it('never resurrects a pre-respawn ready answer on a fresh mount', async () => {
    // First life of the twin: ready with token A, the frame mounts on it.
    const a = await mount('r1', ready('/wR', 'tokA'))
    await waitFor(() => { expect(currentFrame()?.getAttribute('src')).toContain('tkn=tokA') })
    a.unmount()
    // The release parks the record: nothing is current while no body shows.
    expect(currentRecord()).toBeUndefined()

    // The twin respawned behind the client's back, so the next poll will
    // answer token B. Land the mount BEFORE that answer: with the old
    // module-level readyCache this mount painted token A from a cached
    // answer minted by a process that no longer exists — the stale-src
    // ghost the restructure exists to kill.
    let resolve: (result: RemoteResult<IdeBridgeStatus>) => void = () => {}
    const deferred = vi.fn((): Promise<RemoteResult<IdeBridgeStatus>> => {
      return new Promise<RemoteResult<IdeBridgeStatus>>((done) => { resolve = done })
    })
    const b = view('r1', deferred)
    await act(async () => {})
    expect(currentRecord()).toBeUndefined()

    // The fresh answer wins: the frame re-points to the live token.
    resolve({ ok: true, value: ready('/wR', 'tokB') })
    await act(async () => {})
    await waitFor(() => { expect(currentFrame()?.getAttribute('src')).toContain('tkn=tokB') })
    b.unmount()
  })

  it('parks the previous workspace and restores it instantly on flip-back', async () => {
    const a = await mount('m1', ready('/wA'))
    await waitFor(() => { expect(currentFrame()?.getAttribute('src')).toContain('folder=%2FwA') })
    const frameA = currentFrame()
    if (frameA === null) throw new Error('first frame missing')
    a.unmount()

    const b = await mount('m2', ready('/wB'))
    await waitFor(() => { expect(currentFrame()?.getAttribute('src')).toContain('folder=%2FwB') })
    const frameB = currentFrame()
    if (frameB === null) throw new Error('second frame missing')
    // Two records: the live one and the parked spare, its document untouched.
    expect(records().length).toBe(2)
    expect(frameB).not.toBe(frameA)
    expect(frameA.isConnected).toBe(true)
    expect(records().find(record => record.querySelector('iframe') === frameA)?.style.display).toBe('none')
    b.unmount()

    // Flip back: the parked spare unhides — no reload, no new element.
    const c = await mount('m3', ready('/wA'))
    await waitFor(() => { expect(currentFrame()).toBe(frameA) })
    expect(currentFrame()?.getAttribute('src')).toContain('folder=%2FwA')
    expect(records().length).toBe(2)
    c.unmount()
  })

  it('evicts the least-recently-shown record past the spares', async () => {
    const a = await mount('m1', ready('/w1'))
    await waitFor(() => { expect(currentFrame()).not.toBeNull() })
    const frame1 = currentFrame()
    if (frame1 === null) throw new Error('first frame missing')
    a.unmount()

    const b = await mount('m2', ready('/w2'))
    await waitFor(() => { expect(currentFrame()?.getAttribute('src')).toContain('folder=%2Fw2') })
    const frame2 = currentFrame()
    b.unmount()

    const c = await mount('m3', ready('/w3'))
    await waitFor(() => { expect(currentFrame()?.getAttribute('src')).toContain('folder=%2Fw3') })
    // The cap is 3: every shown workspace so far stays parked, its document
    // untouched — this IS the three-workspace switch cycle from the field.
    expect(frame1.isConnected).toBe(true)
    expect(records().length).toBe(3)
    c.unmount()

    const e = await mount('m4', ready('/w4'))
    await waitFor(() => { expect(currentFrame()?.getAttribute('src')).toContain('folder=%2Fw4') })
    // Past the spares, the least-recently-shown workspace falls out.
    expect(frame1.isConnected).toBe(false)
    expect(records().length).toBe(3)
    e.unmount()

    // The surviving parked record still flips back by pure unhide.
    const d = await mount('m5', ready('/w2'))
    await waitFor(() => { expect(currentFrame()).toBe(frame2 ?? null) })
    expect(records().length).toBe(3)
    d.unmount()
  })

  it('ignores a stale body release while a live publisher holds the intent', async () => {
    const a = await mount('m1', ready('/wA'))
    const b = await mount('m2', ready('/wB'))
    await waitFor(() => { expect(currentFrame()?.getAttribute('src')).toContain('folder=%2FwB') })
    a.unmount()
    // The stale body's release does not blank the live publisher's intent.
    expect(currentFrame()?.getAttribute('src')).toContain('folder=%2FwB')
    b.unmount()
    // The live release drops the intent: everything parks, nothing is removed.
    expect(currentRecord()).toBeUndefined()
    expect(records().length).toBe(2)
    expect(records().every(record => record.style.display === 'none')).toBe(true)
  })

  it('keeps the frames inside the seat — no document-level portal, no rect tracking', async () => {
    const a = await mount('m1', ready('/wA'))
    await waitFor(() => { expect(currentFrame()).not.toBeNull() })
    const frame = currentFrame()
    if (frame === null) throw new Error('frame missing')
    // Nothing escapes to document level: the old floats are gone.
    expect(document.body.querySelectorAll('[data-twin-float]').length).toBe(0)
    expect(hostView?.container.contains(frame)).toBe(true)
    a.unmount()
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
    host()
    // The late answer was discarded: nothing publishes an intent from a body
    // that is gone, so the cache stays empty.
    expect(records().length).toBe(0)
  })

  it('seals the boot cover until the workbench loads, and parks the settled document on flip', async () => {
    vi.useFakeTimers()
    host()
    const first = view('z1', statusWith(ready('/wZ')))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    // The cover sits in the seat, over the frame, until load plus the settle margin.
    expect(seat().querySelector('output')).not.toBeNull()
    const frame = currentFrame()
    if (frame === null) throw new Error('frame missing')
    fireEvent.load(frame)
    await act(async () => { await vi.advanceTimersByTimeAsync(1_300) })
    expect(seat().querySelector('output')).toBeNull()
    first.unmount()

    // Same workspace under a fresh body: the settled document shows at once.
    const second = view('z2', statusWith(ready('/wZ')))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(currentFrame()).toBe(frame)
    expect(seat().querySelector('output')).toBeNull()
    second.unmount()
  })

  it('hands an automated focus grab back forever, and honors only a pointed or tabbed entry', async () => {
    vi.useFakeTimers()
    const a = await mount('f1', ready('/wF'))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    const frame = currentFrame()
    if (frame === null) throw new Error('frame missing')
    // The composer stand-in: whatever held the document's focus before.
    const composer = document.createElement('div')
    composer.tabIndex = 0
    document.body.appendChild(composer)
    try {
      // No owner on record at all: the grab is dumped onto <body> — the
      // frame never holds a focus it took itself.
      frame.focus()
      fireEvent.blur(window)
      expect(document.activeElement).toBe(document.body)

      composer.focus()
      expect(document.activeElement).toBe(composer)

      // The booting workbench focuses its restored editor; browser-level
      // focus lands on the iframe element. No gesture stands behind the
      // move, so the composer gets the keyboard back.
      frame.focus()
      fireEvent.blur(window)
      expect(document.activeElement).toBe(composer)

      // The guard never ages out: an editor-restore focus landing past the
      // settle margin is handed back all the same.
      fireEvent.load(frame)
      await act(async () => { await vi.advanceTimersByTimeAsync(1_300) })
      composer.focus()
      frame.focus()
      fireEvent.blur(window)
      expect(document.activeElement).toBe(composer)

      // A pointer over the frame marks the user's click-through: the frame
      // owns the keyboard, and blurs that move nothing stand down — until
      // the pointer is back out and an ungestured grab lands again.
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

      // A Tab keydown grants the same entry for the keyboard; once the
      // user is back in the document, an ungestured grab is barred again.
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
      a.unmount()
    }
  })

  it('hands a boot-time grab back to the focus that predates the guard itself', async () => {
    // The composer's autofocus runs before the seat installs its listeners,
    // so focusin never sees it: without the install-time seed, the first
    // workbench restore would be dumped onto <body> and stay lost.
    vi.useFakeTimers()
    const composer = document.createElement('div')
    composer.tabIndex = 0
    document.body.appendChild(composer)
    composer.focus()
    expect(document.activeElement).toBe(composer)
    try {
      const a = await mount('g1', ready('/wG'))
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      const frame = currentFrame()
      if (frame === null) throw new Error('frame missing')
      frame.focus()
      fireEvent.blur(window)
      expect(document.activeElement).toBe(composer)
      a.unmount()
    } finally {
      composer.remove()
    }
  })

  it('a parked or evicted record hands its focus back instead of dropping it on <body>', async () => {
    vi.useFakeTimers()
    const first = await mount('h1', ready('/wH'))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    const frameH = currentFrame()
    if (frameH === null) throw new Error('frame missing')
    const composer = document.createElement('div')
    composer.tabIndex = 0
    document.body.appendChild(composer)
    try {
      // No owner on record at all: parking the focused frame blurs it
      // outright, so the keyboard lands on <body>, never stranded inside
      // the hidden frame.
      frameH.focus()
      expect(document.activeElement).toBe(frameH)
      first.unmount()
      expect(document.activeElement).toBe(document.body)

      // The frame owns the keyboard by a pointed entry. Parking it for a
      // workspace switch hands the keyboard back to the document owner.
      composer.focus()
      const second = await mount('h2', ready('/wH'))
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      frameH.dispatchEvent(new Event('pointerover', { bubbles: true }))
      frameH.focus()
      fireEvent.blur(window)
      expect(document.activeElement).toBe(frameH)
      const third = await mount('h3', ready('/wQ'))
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(currentFrame()?.getAttribute('src')).toContain('folder=%2FwQ')
      expect(document.activeElement).toBe(composer)

      // The owner is gone: nothing to hand back to, so the switch blurs
      // the focused frame rather than marooning the keyboard inside it.
      const frameQ = currentFrame()
      if (frameQ === null) throw new Error('frame missing')
      composer.remove()
      frameQ.focus()
      expect(document.activeElement).toBe(frameQ)
      const fourth = await mount('h4', ready('/wR'))
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(document.activeElement).toBe(document.body)
      second.unmount()
      third.unmount()
      fourth.unmount()
    } finally {
      composer.remove()
    }
  })

  it('re-seals a fresh document when the workspace actually changes', async () => {
    vi.useFakeTimers()
    const a = await mount('r1', ready('/wR'))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    fireEvent.load(currentFrame() as HTMLIFrameElement)
    await act(async () => { await vi.advanceTimersByTimeAsync(1_300) })
    expect(seat().querySelector('output')).toBeNull()
    a.unmount()

    const b = await mount('r2', ready('/wS'))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(seat().querySelector('output')).not.toBeNull()
    b.unmount()
  })
})
