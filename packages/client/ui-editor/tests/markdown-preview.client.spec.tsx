/**
 * The rendered display mode and its faces: the preview swap round-trips the
 * live buffer, Markdown files open rendered, saves work from either display,
 * and the primitive's chrome is localized through the `editor` namespace.
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

const MD_ADDRESS = sessionFileAddress('s-1', 'notes.md')

interface SaveCall {
  readonly content: string
  readonly expectedVersion: string | undefined
}

/** One scripted `workspaceFiles` face: base64 bodies, recorded saves, a movable version. */
function fakeFace(text = '# Notes\n\nbody\n') {
  const saves: SaveCall[] = []
  const readAlls: string[] = []
  const probe = { version: 'v1' }
  const load = async (file: SessionFile): Promise<unknown> => {
    readAlls.push(file.path)
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
    return { ok: true, value: { absolutePath: '/w/notes.md', version: probe.version } }
  }
  return { load, save, saves, readAlls, probe }
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
    restore: async () => ({ ok: true, value: 'notes.md' }),
    renderSlot: () => null,
    t,
  } as never)
}

async function mountPreview(): Promise<{ face: ReturnType<typeof fakeFace>; container: HTMLElement }> {
  const face = fakeFace()
  const rendered = render(createElement(Harness, { address: MD_ADDRESS, load: face.load, save: face.save }))
  await screen.findByText('Notes')
  return { face, container: rendered.container }
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

describe('EditorBody display modes', () => {
  it('opens a Markdown file rendered and swaps to the source editor and back', async () => {
    const { container } = await mountPreview()
    expect(container.querySelector('[data-editor-preview]')).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'Notes' })).toBeDefined()
    pressEdit(container)
    expect(container.querySelector('[data-editor-preview]')).toBeNull()
    expect(container.querySelector('.cm-content')).not.toBeNull()
    act(() => {
      fireEvent.click(screen.getByText(en.preview))
    })
    expect(await screen.findByRole('heading', { name: 'Notes' })).toBeDefined()
  })

  it('carries unsaved edits through the display swap', async () => {
    const { face, container } = await mountPreview()
    pressEdit(container)
    typeText(container, 'more\n')
    expect(screen.getByText(en.unsaved)).toBeDefined()
    act(() => {
      fireEvent.click(screen.getByText(en.preview))
    })
    expect(await screen.findByText(text => text === 'body more')).toBeDefined()
    pressEdit(container)
    expect(getEditorView(container)?.state.doc.toString()).toBe('# Notes\n\nbody\nmore\n')
    // The save from the source display still guards the loaded version.
    act(() => {
      fireEvent.keyDown(container.querySelector('.cm-content') as Element, { key: 's', ctrlKey: true })
    })
    await waitFor(() => {
      expect(face.saves).toHaveLength(1)
    })
    expect(face.saves[0]).toEqual({ content: '# Notes\n\nbody\nmore\n', expectedVersion: 'v1' })
  })

  it('saves the committed generation straight from the rendered display', async () => {
    const { face, container } = await mountPreview()
    pressEdit(container)
    typeText(container, 'x\n')
    act(() => {
      fireEvent.click(screen.getByText(en.preview))
    })
    await screen.findByText(text => text === 'body x')
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: en.save }))
    })
    await waitFor(() => {
      expect(face.saves).toHaveLength(1)
    })
    expect(face.saves[0]).toEqual({ content: '# Notes\n\nbody\nx\n', expectedVersion: 'v1' })
    await screen.findByText(en.saved)
  })

  it('renders localized code-fence chrome in the preview', async () => {
    const face = { ...fakeFace('```js\nlet a = 1\n```\n') }
    const rendered = render(createElement(Harness, { address: MD_ADDRESS, load: face.load, save: face.save }))
    expect(await screen.findByText(en['code.copy'])).toBeDefined()
    rendered.unmount()
  })
})
