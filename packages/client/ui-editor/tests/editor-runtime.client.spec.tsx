/**
 * The editor runtime end to end: the annotation owner shares the
 * provider's CodeMirror namespaces and the retain-and-replay doors; added
 * and compartment contributions survive view re-creations, disposers stop
 * the replay, and the data bulletin draws through the single view.
 */
// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import * as cmState from '@codemirror/state'
import * as cmView from '@codemirror/view'
import { sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorBody, getEditorView } from '../src/client/EditorBody.tsx'
import { en } from '../src/client/locales.ts'
import type { EditorAnnotationOwner } from '../src/client/contract/slots.ts'

vi.stubGlobal('ResizeObserver', class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
})

// Inert geometry and RAF, as in the editor-body spec: the model is asserted,
// not the drawn text measure.
const rangeProto = Range.prototype as Range & { getClientRects(): DOMRectList; getBoundingClientRect(): DOMRect }
rangeProto.getClientRects = () => ([]) as unknown as DOMRectList
rangeProto.getBoundingClientRect = () => ({
  x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => '',
})
vi.stubGlobal('requestAnimationFrame', () => 0)
vi.stubGlobal('cancelAnimationFrame', () => {})

afterEach(cleanup)

function t(key: keyof typeof en, params?: Record<string, string | number>): string {
  const line = en[key]
  if (params === undefined) return line
  return line.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match)
}

interface Mounted {
  readonly owner: () => EditorAnnotationOwner
  readonly container: HTMLElement
  readonly unmount: () => void
}

/** One body whose annotation owner face the renderSlot recorder captures. */
function mount(path: string): Mounted {
  let captured: EditorAnnotationOwner | undefined
  const address = sessionFileAddress('s-1', path)
  const handle = render(createElement(EditorBody, {
    useTabInfo: () => ({
      sidebar: { expanded: true, fullscreen: false },
      panel: { id: 'main' },
      tab: {
        id: 'tab-1', contentId: address, visible: true,
        navigation: { address, params: undefined, revision: 0 },
        signal: new AbortController().signal,
        actions: { openResource: () => {}, openTab: () => {}, close: () => {} },
      },
    }),
    useResource: () => ({ status: 'none' }),
    load: async () => ({
      ok: true,
      value: {
        absolutePath: `/w/${path}`, version: 'v1', bytes: 8, offset: 0, data: btoa('one\ntwo\n'), eof: true,
      },
    }),
    save: async () => ({ ok: true, value: { absolutePath: `/w/${path}`, version: 'v2' } }),
    useSession: (selector: (snapshot: unknown) => unknown) => selector({ cwd: undefined }),
    useFileHistory: (selector: (snapshot: unknown) => unknown) => selector({ files: [] }),
    useInput: (selector: (snapshot: unknown) => unknown) => selector({ draft: '' }),
    inputActions: { setDraft: () => {} },
    blob: async () => ({ ok: true, value: null }),
    restore: async () => ({ ok: true, value: path }),
    renderSlot: (_name: string, owner: EditorAnnotationOwner) => {
      captured = owner
      return null
    },
    t,
  } as never))
  const owner = (): EditorAnnotationOwner => {
    if (captured === undefined) throw new Error('the body must render the annotation seat')
    return captured
  }
  return { owner, container: handle.container, unmount: handle.unmount }
}

async function viewOf(mounted: Mounted): Promise<cmView.EditorView> {
  await screen.findByText(en.saved)
  const view = getEditorView(mounted.container)
  if (view === undefined) throw new Error('the source view must mount')
  return view
}

/** Revert reloads the generation, re-creating the view over the replay. */
async function regenerate(mounted: Mounted): Promise<cmView.EditorView> {
  const before = getEditorView(mounted.container)
  act(() => {
    screen.getByRole('button', { name: en.revert }).click()
  })
  await waitFor(() => {
    expect(getEditorView(mounted.container)).not.toBe(before)
  })
  return getEditorView(mounted.container)!
}

describe('editor runtime', () => {
  it('shares the provider namespaces and the live view', async () => {
    const mounted = mount('notes.txt')
    const view = await viewOf(mounted)
    const owner = mounted.owner()
    // The one runtime copy: identity, not compatibility.
    expect(owner.modules.state).toBe(cmState)
    expect(owner.modules.view).toBe(cmView)
    expect(owner.liveView()).toBe(view)
    expect(owner.lineText(1)).toBe('one')
    expect(owner.lineText(9)).toBe('')
    mounted.unmount()
  })

  it('retains added extensions into the live view and replays them per generation', async () => {
    const mounted = mount('notes.txt')
    const view = await viewOf(mounted)
    const owner = mounted.owner()
    const present = cmState.StateField.define<number>({ create: () => 7, update: value => value })
    const dispose = owner.add('late', present)
    expect(view.state.field(present)).toBe(7)
    // A regenerated view composes the retained set without a dispatch.
    const next = await regenerate(mounted)
    expect(next.state.field(present)).toBe(7)
    // The disposer shapes later generations only.
    dispose()
    const third = await regenerate(mounted)
    expect(third.state.field(present, false)).toBeUndefined()
    mounted.unmount()
  })

  it('replace installs one compartment and replays its last content', async () => {
    const mounted = mount('notes.txt')
    const view = await viewOf(mounted)
    const owner = mounted.owner()
    const content = cmState.StateField.define<number>({ create: () => 9, update: value => value })
    expect(owner.compartmentOf('swap')).toBe(owner.compartmentOf('swap'))
    owner.replace('swap', content)
    expect(view.state.field(content)).toBe(9)
    const next = await regenerate(mounted)
    expect(next.state.field(content)).toBe(9)
    mounted.unmount()
  })

  it('a second replace swaps the compartment live and replays the last content', async () => {
    const mounted = mount('notes.txt')
    const view = await viewOf(mounted)
    const owner = mounted.owner()
    const first = cmState.StateField.define<number>({ create: () => 9, update: value => value })
    const second = cmState.StateField.define<number>({ create: () => 11, update: value => value })
    owner.replace('swap', first)
    expect(view.state.field(first)).toBe(9)
    // The installed compartment swaps through reconfigure, not append.
    owner.replace('swap', second)
    expect(view.state.field(second)).toBe(11)
    expect(view.state.field(first, false)).toBeUndefined()
    const next = await regenerate(mounted)
    expect(next.state.field(second)).toBe(11)
    mounted.unmount()
  })

  it('the bulletin column draws published markers through the single view', async () => {
    const mounted = mount('notes.txt')
    await viewOf(mounted)
    const owner = mounted.owner()
    const dispose = owner.describeColumn({ id: 'spec-column', className: 'spec-column' })
    act(() => {
      owner.publishMarkers('spec-column', [{ line: 1, label: '!' }])
    })
    await waitFor(() => {
      expect(mounted.container.querySelector('.spec-column')).not.toBeNull()
    })
    expect(mounted.container.querySelector('.spec-column [data-line="1"]')?.textContent).toBe('!')
    dispose()
    mounted.unmount()
  })

  it('a rendered display leaves the live view undefined', async () => {
    const mounted = mount('notes.md')
    await waitFor(() => {
      expect(mounted.container.querySelector('[data-editor-preview]')).not.toBeNull()
    })
    const owner = mounted.owner()
    expect(owner.liveView()).toBeUndefined()
    expect(owner.lineText(1)).toBe('')
    mounted.unmount()
  })
})
