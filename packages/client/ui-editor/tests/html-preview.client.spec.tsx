/**
 * The sandboxed rendered HTML display: HTML files open on a rendered page of
 * the buffer, the Source/Preview swap round-trips the live buffer, saves work
 * from either display, and the frame's accessible name is localized.
 */
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorBody, getEditorView } from '../src/client/EditorBody.tsx'
import { en } from '../src/client/locales.ts'
import type { SessionFile } from '../src/client/rpc.ts'

vi.stubGlobal('ResizeObserver', class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
})

// jsdom's Range lacks the geometry CodeMirror's measure pass needs, and its
// rescheduling never settles in a headless DOM. The tests assert model and
// status, not drawn text, so the measure pass gets inert geometry and never
// runs at all.
const rangeProto = Range.prototype as Range & { getClientRects(): DOMRectList; getBoundingClientRect(): DOMRect }
rangeProto.getClientRects = () => ([]) as unknown as DOMRectList
rangeProto.getBoundingClientRect = () => ({
  x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => '',
})
// CodeMirror's measure pass reschedules through requestAnimationFrame and
// never settles against jsdom's zero geometry. The tests assert model and
// status, not drawn text, so RAF stays inert; view updates are dispatched
// directly against the reported editor view.
vi.stubGlobal('requestAnimationFrame', () => 0)
vi.stubGlobal('cancelAnimationFrame', () => {})

afterEach(cleanup)

const HTML_ADDRESS = sessionFileAddress('s-1', 'demo.html')
const PAGE = '<h1>Snapshot timeline</h1>\n<p>body</p>\n'

interface SaveCall {
  readonly content: string
  readonly expectedVersion: string | undefined
}

/** One scripted `workspaceFiles` face: base64 bodies, recorded saves, a movable version. */
function fakeFace(text = PAGE) {
  const saves: SaveCall[] = []
  const probe = { version: 'v1' }
  const load = async (file: SessionFile): Promise<unknown> => {
    return {
      ok: true,
      value: {
        absolutePath: `/w/${file.path}`, version: probe.version, bytes: text.length,
        offset: 0, data: btoa(text), eof: true,
      },
    }
  }
  const save = async (_file: SessionFile, content: string, expectedVersion: string | undefined): Promise<unknown> => {
    saves.push({ content, expectedVersion })
    probe.version = `v${saves.length + 1}`
    return { ok: true, value: { absolutePath: '/w/demo.html', version: probe.version } }
  }
  return { load, save, saves, probe }
}

/** Translate bound to the English dictionary, interpolating `{placeholders}`. */
function t(key: keyof typeof en, params?: Record<string, string | number>): string {
  const line = en[key]
  if (params === undefined) return line
  return line.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match)
}

function tabInfo(address: string): unknown {
  return {
    sidebar: { expanded: true, fullscreen: false },
    panel: { id: 'main' },
    tab: {
      id: 'tab-1', contentId: address, visible: true,
      navigation: { address, params: undefined, revision: 0 },
      signal: new AbortController().signal,
      actions: { openResource: () => {}, openTab: () => {}, close: () => {} },
    },
  }
}

/** The body with a controllable external file version, so meta updates rerender. */
function Harness(props: { address: string; load: unknown; save: unknown }): ReactNode {
  return createElement(EditorBody, {
    useTabInfo: () => tabInfo(props.address),
    useResource: () => ({ status: 'none' }),
    load: props.load,
    save: props.save,
    useFileHistory: (selector: (snapshot: unknown) => unknown) => selector({ files: [] }),
    useInput: (selector: (snapshot: unknown) => unknown) => selector({ draft: '' }),
    inputActions: { setDraft: () => {} },
    blob: async () => ({ ok: true, value: null }),
    restore: async () => ({ ok: true, value: 'a.html' }),
    t,
  } as never)
}

async function mountHtml(): Promise<{ face: ReturnType<typeof fakeFace>; container: HTMLElement }> {
  const face = fakeFace()
  const rendered = render(createElement(Harness, { address: HTML_ADDRESS, load: face.load, save: face.save }))
  await screen.findByTitle(en['html.rendered'])
  return { face, container: rendered.container }
}

function frameOf(container: HTMLElement): HTMLIFrameElement {
  const frame = container.querySelector('iframe')
  if (frame === null) throw new Error('no rendered frame mounted')
  return frame
}

function pressEdit(container: HTMLElement): void {
  act(() => {
    fireEvent.click(screen.getByText(en.edit))
  })
  expect(container.querySelector('[data-editor-mode="edit"]')).not.toBeNull()
}

function typeText(container: HTMLElement, addition: string): void {
  const view = getEditorView(container)
  if (view === undefined) throw new Error('no editor view mounted')
  act(() => {
    view.dispatch({ changes: { from: view.state.doc.length, insert: addition } })
  })
}

describe('EditorBody rendered HTML display', () => {
  it('opens an HTML file sandboxed-rendered and swaps to the source editor and back', async () => {
    const { container } = await mountHtml()
    expect(container.querySelector('[data-editor-preview]')).not.toBeNull()
    const frame = frameOf(container)
    expect(frame.getAttribute('sandbox')).toBe('')
    expect(frame.getAttribute('srcdoc')).toContain('Snapshot timeline')
    pressEdit(container)
    expect(container.querySelector('[data-editor-preview]')).toBeNull()
    expect(container.querySelector('.cm-content')).not.toBeNull()
    act(() => {
      fireEvent.click(screen.getByText(en.preview))
    })
    await waitFor(() => {
      expect(frameOf(container).getAttribute('srcdoc')).toContain('Snapshot timeline')
    })
  })

  it('carries unsaved edits through the display swap', async () => {
    const { face, container } = await mountHtml()
    pressEdit(container)
    typeText(container, '<p>more</p>\n')
    expect(screen.getByText(en.unsaved)).toBeDefined()
    act(() => {
      fireEvent.click(screen.getByText(en.preview))
    })
    await waitFor(() => {
      expect(frameOf(container).getAttribute('srcdoc')).toContain('<p>more</p>')
    })
    pressEdit(container)
    expect(getEditorView(container)?.state.doc.toString()).toBe(`${PAGE}<p>more</p>\n`)
    act(() => {
      fireEvent.keyDown(container.querySelector('.cm-content') as Element, { key: 's', ctrlKey: true })
    })
    await waitFor(() => {
      expect(face.saves).toHaveLength(1)
    })
    expect(face.saves[0]).toEqual({ content: `${PAGE}<p>more</p>\n`, expectedVersion: 'v1' })
  })

  it('saves the committed generation straight from the rendered display', async () => {
    const { face, container } = await mountHtml()
    pressEdit(container)
    typeText(container, '<p>x</p>\n')
    act(() => {
      fireEvent.click(screen.getByText(en.preview))
    })
    await waitFor(() => {
      expect(frameOf(container).getAttribute('srcdoc')).toContain('<p>x</p>')
    })
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: en.save }))
    })
    await waitFor(() => {
      expect(face.saves).toHaveLength(1)
    })
    expect(face.saves[0]).toEqual({ content: `${PAGE}<p>x</p>\n`, expectedVersion: 'v1' })
    await screen.findByText(en.saved)
  })
})
