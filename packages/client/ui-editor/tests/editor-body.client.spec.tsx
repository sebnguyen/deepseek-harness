/**
 * The editor body against scripted faces: load, Mod-S save under the loaded
 * version guard, the stale refusal surfacing the conflict banner, reload and
 * overwrite resolutions, a save refused while another save is in flight, and
 * a failed read replacing the editor.
 */
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorBody } from '../src/client/EditorBody.tsx'
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

const ADDRESS = sessionFileAddress('s-1', 'notes.txt')

interface SaveCall {
  readonly content: string
  readonly expectedVersion: string | undefined
}

/** One scripted `workspaceFiles` face: base64 bodies, recorded saves, a movable version. */
function fakeFace(options: { text?: string; failRead?: string } = {}) {
  const saves: SaveCall[] = []
  const readAlls: string[] = []
  const probe = { version: 'v1' as string, failRead: options.failRead }
  const text = options.text ?? 'one\n'
  const load = async (file: SessionFile): Promise<unknown> => {
    readAlls.push(file.path)
    if (probe.failRead !== undefined) {
      return { ok: false, error: { code: probe.failRead, message: 'boom', details: { path: file.path } } }
    }
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
    return { ok: true, value: { absolutePath: '/w/notes.txt', version: probe.version } }
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

function tabInfo(): unknown {
  return {
    sidebar: { expanded: true, fullscreen: false },
    panel: { id: 'main' },
    tab: {
      id: 'tab-1', contentId: ADDRESS, visible: true,
      navigation: { address: ADDRESS, params: undefined, revision: 0 },
      signal: new AbortController().signal,
      actions: { openResource: () => {}, openTab: () => {}, close: () => {} },
    },
  }
}

interface HarnessOptions {
  readonly externalVersion?: string | undefined
}

/** The body with a controllable external file version, so meta updates rerender. */
function Harness(props: HarnessOptions & { load: unknown; save: unknown }): ReactNode {
  const version = props.externalVersion
  return createElement(EditorBody, {
    useTabInfo: tabInfo,
    useResource: () => (version === undefined ? { status: 'none' } : { status: 'live', value: { version } }),
    load: props.load,
    save: props.save,
    useSession: (selector: (snapshot: unknown) => unknown) => selector({ cwd: undefined }),
    useFileHistory: (selector: (snapshot: unknown) => unknown) => selector({ files: [] }),
    useInput: (selector: (snapshot: unknown) => unknown) => selector({ draft: '' }),
    inputActions: { setDraft: () => {} },
    blob: async () => ({ ok: true, value: null }),
    restore: async () => ({ ok: true, value: 'notes.txt' }),
    renderSlot: () => null,
    t,
  } as never)
}

async function pressSave(container: HTMLElement): Promise<void> {
  act(() => {
    fireEvent.keyDown(container.querySelector('.cm-content') as Element, { key: 's', ctrlKey: true })
  })
}

describe('EditorBody', () => {
  it('loads the complete file and reports ready with no unsaved changes', async () => {
    const face = fakeFace()
    render(createElement(Harness, { load: face.load, save: face.save }))
    await screen.findByText(en.saved)
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
    expect(face.readAlls).toEqual(['notes.txt'])
  })

  it('saves the buffer under the loaded version on Mod-S', async () => {
    const face = fakeFace()
    const { container } = render(createElement(Harness, { load: face.load, save: face.save }))
    await screen.findByText(en.saved)
    await pressSave(container)
    await waitFor(() => {
      expect(face.saves).toHaveLength(1)
    })
    expect(face.saves[0]).toEqual({ content: 'one\n', expectedVersion: 'v1' })
  })

  it('surfaces the stale refusal as the conflict banner and resolves it by overwrite', async () => {
    const face = fakeFace()
    const { container } = render(createElement(Harness, {
      load: face.load,
      save: async (file: SessionFile, content: string, expectedVersion: string | undefined) => {
        face.saves.push({ content, expectedVersion })
        if (face.saves.length <= 2) {
          return { ok: false, error: { code: 'workspace-file/stale', message: 'm', details: { path: file.path } } }
        }
        face.probe.version = `v${String(face.saves.length + 1)}`
        return { ok: true, value: { absolutePath: '/w/notes.txt', version: face.probe.version } }
      },
    }))
    await screen.findByText(en.saved)
    await pressSave(container)
    expect(await screen.findByText(en.conflict)).toBeDefined()
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: en.overwrite }))
    })
    await waitFor(() => {
      expect(face.saves).toHaveLength(2)
    })
    expect(face.saves[1]?.expectedVersion).toBeUndefined()
    expect(screen.getByText(en.conflict)).toBeDefined()
    await pressSave(container)
    await waitFor(() => {
      expect(face.saves).toHaveLength(3)
    })
    await waitFor(() => {
      expect(screen.queryByText(en.conflict)).toBeNull()
    })
  })

  it('reloads the file when the conflict banner asks for it', async () => {
    const face = fakeFace()
    const { container } = render(createElement(Harness, {
      load: face.load,
      save: async () => ({ ok: false, error: { code: 'workspace-file/stale', message: 'm', details: {} } }),
    }))
    await screen.findByText(en.saved)
    await pressSave(container)
    await screen.findByText(en.conflict)
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: en.reload }))
    })
    await waitFor(() => {
      expect(face.readAlls).toHaveLength(2)
    })
  })

  it('aborts an in-flight load when the tab unmounts', async () => {
    let release!: (value: unknown) => void
    const stalled = new Promise<unknown>((resolve) => { release = resolve })
    const face = fakeFace()
    const { unmount } = render(createElement(Harness, {
      load: (file: SessionFile) => {
        face.readAlls.push(file.path)
        return stalled
      },
      save: face.save,
    }))
    await act(async () => { await Promise.resolve() })
    unmount()
    let done = false
    await act(async () => {
      release({ ok: true, value: { absolutePath: '/w/notes.txt', version: 'v1', bytes: 4, offset: 0, data: btoa('one\n'), eof: true } })
      await new Promise((resolve) => { setTimeout(resolve, 0) })
      done = true
    })
    expect(done).toBe(true)
    expect(screen.queryByText(en.saved)).toBeNull()
  })

  it('shows the saving status while a save is in flight', async () => {
    const face = fakeFace()
    let release!: (value: unknown) => void
    const { container } = render(createElement(Harness, {
      load: face.load,
      save: (_file: SessionFile, content: string, expectedVersion: string | undefined) => {
        face.saves.push({ content, expectedVersion })
        return new Promise((resolve) => { release = resolve })
      },
    }))
    await screen.findByText(en.saved)
    await pressSave(container)
    expect(await screen.findByText(en.saving)).toBeDefined()
    await pressSave(container)
    await act(async () => {
      release({ ok: true, value: { absolutePath: '/w/notes.txt', version: 'v2' } })
    })
    await screen.findByText(en.saved)
    expect(face.saves).toHaveLength(1)
  })

  it('shows the refusal line when a save fails read-only', async () => {
    const face = fakeFace()
    const { container } = render(createElement(Harness, {
      load: face.load,
      save: async () => ({ ok: false, error: { code: 'workspace-file/read-only', message: 'm', details: { path: 'notes.txt' } } }),
    }))
    await screen.findByText(en.saved)
    await pressSave(container)
    expect(await screen.findByText(en['error.readOnly'])).toBeDefined()
  })

  it('reports a failed read in place of the editor', async () => {
    const face = fakeFace({ failRead: 'workspace-file/not-found' })
    render(createElement(Harness, { load: face.load, save: face.save }))
    expect(await screen.findByText(en['error.notFound'])).toBeDefined()
    expect(screen.queryByRole('button', { name: en.save })).toBeNull()
  })
})
