/**
 * The Changes display: turn scrubber over the stops, the frozen unified
 * page from retained blobs, the purpose box, and the round button that
 * quotes the stop into the composer draft. Missing blobs refuse loudly.
 */
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

afterEach(cleanup)
import type { FileStop } from '@deepseek-ai/dsh-client-ui-file-history/client'
import { placeStops, quoteInput } from '../src/client/ChangesSurface.tsx'
import { EditorBody } from '../src/client/EditorBody.tsx'
import { en } from '../src/client/locales.ts'

const ADDRESS = 'dsh-resource://file/session/s-1/notes.txt'

const BLOBS: Record<string, string> = {
  'sha256:a': 'one\n',
  'sha256:b': 'one\ntwo\n',
}

function stopFixture(): FileStop[] {
  return [
    { seq: 1, time: 1, callId: 'c1', toolName: 'write', turn: 1, step: 0, purpose: 'initial', after: 'sha256:a' },
    { seq: 2, time: 2, callId: 'c2', toolName: 'write', turn: 2, step: 0, purpose: 'fix the x', before: 'sha256:a', after: 'sha256:b' },
  ]
}

function t(key: keyof typeof en, params?: Record<string, string | number>): string {
  const line = en[key]
  if (params === undefined) return line
  return line.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match)
}

function tabInfo(params?: { display: 'changes'; stop?: string }): unknown {
  return {
    sidebar: { expanded: true, fullscreen: false },
    panel: { id: 'main' },
    tab: {
      id: 'tab-1', contentId: ADDRESS, visible: true,
      navigation: { address: ADDRESS, params, revision: 0 },
      signal: new AbortController().signal,
      actions: { openResource: () => {}, openTab: () => {}, close: () => {} },
    },
  }
}

interface HarnessOptions {
  readonly stops: readonly FileStop[]
  readonly draft?: string
  readonly pruned?: boolean
  readonly setDrafts: string[]
  readonly params?: { display: 'changes'; stop?: string }
}

/** The body over a fixed two-stop timeline with a controllable input machine. */
function Harness({ stops, draft = '', pruned = false, setDrafts, params }: HarnessOptions): ReactNode {
  return createElement(EditorBody, {
    useTabInfo: () => tabInfo(params),
    useResource: () => ({ status: 'none' }),
    useFileHistory: (selector: (snapshot: unknown) => unknown) =>
      selector({ files: [{ path: 'notes.txt', stops }] }),
    useInput: (selector: (snapshot: unknown) => unknown) => selector({ draft }),
    inputActions: {
      setDraft: (text: string) => { setDrafts.push(text) },
    },
    load: async () => ({
      ok: true,
      value: { absolutePath: '/w/notes.txt', version: 'v1', bytes: 4, offset: 0, data: btoa('one\n'), eof: true },
    }),
    save: async () => ({ ok: true, value: { absolutePath: '/w/notes.txt', version: 'v2' } }),
    blob: async (_file: unknown, digest: string) => {
      const text = pruned ? null : BLOBS[digest] ?? null
      return { ok: true, value: text }
    },
    restore: async () => ({ ok: true, value: 'notes.txt' }),
    t,
  } as never)
}

async function enterChanges(): Promise<void> {
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: en.changes }))
  })
}

describe('Changes display', () => {
  it('shows the last stop as one frozen unified page with its purpose', async () => {
    const setDrafts: string[] = []
    render(createElement(Harness, { stops: stopFixture(), setDrafts }))
    await enterChanges()
    expect(await screen.findByText('two')).toBeDefined()
    expect(screen.getByText(t('meta', { turn: 2, tool: 'write', call: 'c2' }))).toBeDefined()
    expect(screen.getByText('fix the x')).toBeDefined()
  })

  it('scrubs to an earlier stop through its tick', async () => {
    const setDrafts: string[] = []
    render(createElement(Harness, { stops: stopFixture(), setDrafts }))
    await enterChanges()
    await screen.findByText('two')
    act(() => {
      fireEvent.click(screen.getByTitle(t('turnN', { n: 1 }) + ' · write'))
    })
    expect(screen.getByText(t('meta', { turn: 1, tool: 'write', call: 'c1' }))).toBeDefined()
    expect(screen.queryByText('two')).toBeNull()
  })

  it('lands a drag on the nearest stop', async () => {
    const setDrafts: string[] = []
    const { container } = render(createElement(Harness, { stops: stopFixture(), setDrafts }))
    await enterChanges()
    await screen.findByText('two')
    const track = container.querySelector('[class*="track"]') as HTMLElement
    act(() => {
      fireEvent.pointerDown(track, { clientX: 0, pointerId: 1 })
      fireEvent.pointerMove(track, { clientX: 0, pointerId: 1 })
      fireEvent.pointerUp(track, { clientX: 0, pointerId: 1 })
    })
    expect(screen.getByText(t('meta', { turn: 1, tool: 'write', call: 'c1' }))).toBeDefined()
  })

  it('quotes the selected stop and purpose into the draft', async () => {
    const setDrafts: string[] = []
    render(createElement(Harness, { stops: stopFixture(), setDrafts, draft: 'hello ' }))
    await enterChanges()
    await screen.findByText('two')
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: en.addNext }))
    })
    expect(setDrafts).toEqual(['hello\n@notes.txt#2#c2\nfix the x'])
  })

  it('quotes address only for an empty draft and no stated purpose', async () => {
    const setDrafts: string[] = []
    const stops: FileStop[] = [{ seq: 1, time: 1, callId: 'c9', toolName: 'write', turn: 4, step: 1, after: 'sha256:a' }]
    render(createElement(Harness, { stops, setDrafts }))
    await enterChanges()
    await screen.findByText('one')
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: en.addNext }))
    })
    expect(setDrafts).toEqual(['@notes.txt#4#c9'])
  })

  it('opens straight onto the Changes display when the tab params ask for it', async () => {
    const setDrafts: string[] = []
    render(createElement(Harness, { stops: stopFixture(), setDrafts, params: { display: 'changes' } }))
    expect(await screen.findByText(t('meta', { turn: 2, tool: 'write', call: 'c2' }))).toBeDefined()
  })

  it('selects the stop a tab navigation names', async () => {
    const setDrafts: string[] = []
    render(createElement(Harness, { stops: stopFixture(), setDrafts, params: { display: 'changes', stop: 'c1' } }))
    expect(await screen.findByText(t('meta', { turn: 1, tool: 'write', call: 'c1' }))).toBeDefined()
  })

  it('marks a stop whose call never logged a turn as a gap diamond', async () => {
    const setDrafts: string[] = []
    const stops: FileStop[] = [
      { seq: 1, time: 1, callId: 'cg', toolName: 'write', after: 'sha256:a' },
      { seq: 2, time: 2, callId: 'c2', toolName: 'write', turn: 2, step: 0, after: 'sha256:b' },
    ]
    const { container } = render(createElement(Harness, { stops, setDrafts }))
    await enterChanges()
    await screen.findByText(t('meta', { turn: 2, tool: 'write', call: 'c2' }))
    expect(container.querySelector('[class*="diamond"]')).not.toBeNull()
    act(() => {
      fireEvent.click(screen.getByTitle(en.gapMeta))
    })
    expect(screen.getByText(en.gapMeta)).toBeDefined()
  })

  it('reports pruned blobs instead of a page', async () => {
    const setDrafts: string[] = []
    render(createElement(Harness, { stops: stopFixture(), setDrafts, pruned: true }))
    await enterChanges()
    expect(await screen.findByText(en.missingBlob)).toBeDefined()
  })

  it('tells the file has no stops yet', async () => {
    const setDrafts: string[] = []
    const { container } = render(createElement(Harness, { stops: [], setDrafts }))
    await enterChanges()
    expect(await screen.findByText(en['changes.empty'])).toBeDefined()
    expect(container.querySelector('[data-changes]')).toBeDefined()
  })

  it('quotes a gap stop with the gap turn slot', async () => {
    const setDrafts: string[] = []
    const stops: FileStop[] = [{ seq: 1, time: 1, callId: 'cg', toolName: 'write', purpose: 'orphan', after: 'sha256:a' }]
    render(createElement(Harness, { stops, setDrafts }))
    await enterChanges()
    await screen.findByText('orphan')
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: en.addNext }))
    })
    expect(setDrafts).toEqual(['@notes.txt#gap#cg\norphan'])
  })

  it('shows removals when the file left the workspace', async () => {
    const setDrafts: string[] = []
    const stops: FileStop[] = [{ seq: 1, time: 1, callId: 'cd', toolName: 'bash', turn: 3, step: 0, before: 'sha256:b' }]
    render(createElement(Harness, { stops, setDrafts }))
    await enterChanges()
    expect(await screen.findByText('two')).toBeDefined()
    expect(screen.queryByText('+')).toBeNull()
  })

  it('ignores pointer moves and ups that never started a drag', async () => {
    const setDrafts: string[] = []
    const { container } = render(createElement(Harness, { stops: stopFixture(), setDrafts }))
    await enterChanges()
    await screen.findByText('two')
    const track = container.querySelector('[class*="track"]') as HTMLElement
    act(() => {
      fireEvent.pointerMove(track, { clientX: 4, pointerId: 1 })
      fireEvent.pointerUp(track, { clientX: 4, pointerId: 1 })
    })
    expect(screen.getByText(t('meta', { turn: 2, tool: 'write', call: 'c2' }))).toBeDefined()
    expect(container.querySelector('[class*="ghost"]')).toBeNull()
  })

  it('shows the ghost while dragging over a measured track', async () => {
    const setDrafts: string[] = []
    const { container } = render(createElement(Harness, { stops: stopFixture(), setDrafts }))
    await enterChanges()
    await screen.findByText('two')
    const track = container.querySelector('[class*="track"]') as HTMLElement
    Object.defineProperty(track, 'getBoundingClientRect', {
      value: () => ({ left: 0, width: 100, top: 0, right: 100, bottom: 24, height: 24, x: 0, y: 0, toJSON: () => '' }),
    })
    act(() => {
      fireEvent.pointerDown(track, { clientX: 100, pointerId: 1 })
    })
    act(() => {
      fireEvent.pointerMove(track, { clientX: 100, pointerId: 1 })
    })
    expect(container.querySelector('[class*="ghost"]')).toBeDefined()
    act(() => {
      fireEvent.pointerUp(track, { clientX: 100, pointerId: 1 })
    })
    expect(container.querySelector('[class*="ghost"]')).toBeNull()
    expect(screen.getByText(t('meta', { turn: 2, tool: 'write', call: 'c2' }))).toBeDefined()
  })

  it('drops an in-flight blob read when the surface unmounts', async () => {
    const setDrafts: string[] = []
    let release!: (value: string | null) => void
    const stalled = new Promise<string | null>((resolve) => { release = resolve })
    const { container, unmount } = render(createElement(EditorBody, {
      useTabInfo: tabInfo,
      useResource: () => ({ status: 'none' }),
      useFileHistory: (selector: (snapshot: unknown) => unknown) =>
        selector({ files: [{ path: 'notes.txt', stops: stopFixture() }] }),
      useInput: (selector: (snapshot: unknown) => unknown) => selector({ draft: '' }),
      inputActions: { setDraft: (text: string) => { setDrafts.push(text) } },
      load: async () => ({
        ok: true,
        value: { absolutePath: '/w/notes.txt', version: 'v1', bytes: 4, offset: 0, data: btoa('one\n'), eof: true },
      }),
      save: async () => ({ ok: true, value: { absolutePath: '/w/notes.txt', version: 'v2' } }),
      blob: () => stalled,
      restore: async () => ({ ok: true, value: 'notes.txt' }),
      t,
    } as never))
    await enterChanges()
    await waitFor(() => {
      expect(container.querySelector('[data-changes]')).toBeDefined()
    })
    unmount()
    await act(async () => {
      release('one\n')
      await Promise.resolve()
    })
    expect(screen.queryByText(en.missingBlob)).toBeNull()
  })
})

describe('quoteInput and placeStops', () => {
  it('quotes a bare address for a purpose-less stop', () => {
    const stop: FileStop = { seq: 1, time: 1, callId: 'c7', toolName: 'write', turn: 5, step: 0, after: 'd' }
    expect(quoteInput('x', 'a/b.ts', stop)).toBe('x\n@a/b.ts#5#c7')
  })

  it('places no stops, centers a single one, and spreads several', () => {
    expect(placeStops([])).toEqual([])
    expect(placeStops([{ seq: 1, time: 1, callId: 'c', toolName: 'w', turn: 3, step: 0 }])).toEqual([50])
    expect(placeStops([
      { seq: 1, time: 1, callId: 'a', toolName: 'w', turn: 1, step: 0 },
      { seq: 2, time: 2, callId: 'b', toolName: 'w', step: 0 },
      { seq: 3, time: 3, callId: 'c', toolName: 'w', turn: 3, step: 0 },
    ])).toEqual([0, 25, 100])
  })
})
