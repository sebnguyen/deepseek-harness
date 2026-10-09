/**
 * The change-marker entry: appends its gutter extension once and seeds
 * the live view's marked-line field from the file's latest frozen stop;
 * the field's gutter dots land on exactly the changed after-lines.
 */
// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(cleanup)
import {
  ChangeMarkers, markedLinesField, markersExtension, setMarkedLines,
} from '../src/client/change-markers.tsx'
import css from '../src/client/change-markers.module.css'

const BLOBS: Record<string, string> = {
  'sha256:a': 'one\n',
  'sha256:b': 'one\ntwo\n',
}

interface MountOptions {
  readonly stops: readonly unknown[]
  readonly blob?: (digest: string) => Promise<string | null>
  readonly view?: () => unknown
  readonly history?: unknown
}

/** Mount the entry over one file's stops; the append log captures its extension. */
function mount({ stops, blob, view, history }: MountOptions) {
  const appended: unknown[] = []
  const handle = render(createElement(ChangeMarkers, {
    file: { sessionId: 's-1', path: 'notes.txt' },
    append: (extension: unknown) => {
      appended.push(extension)
      return () => {
        const at = appended.indexOf(extension)
        if (at >= 0) appended.splice(at, 1)
      }
    },
    blob: blob ?? (async (digest: string) => BLOBS[digest] ?? null),
    view: view ?? (() => undefined),
    viewVersion: 0,
    useFileHistory: (selector: (snapshot: unknown) => unknown) =>
      selector(history ?? { files: [{ path: 'notes.txt', stops }] }),
  } as never))
  return { appended, ...handle }
}

const STOP = {
  seq: 2, time: 2, callId: 'c2', toolName: 'write', turn: 2, before: 'sha256:a', after: 'sha256:b',
}

describe('change markers', () => {
  it('marks changed lines end to end', async () => {
    // The field applies its effect and ignores foreign transactions.
    const bare = EditorState.create({ doc: 'a\nb', extensions: [markedLinesField] })
    const marked = bare.update({ effects: setMarkedLines.of([2]) }).state
    expect(marked.field(markedLinesField)).toEqual([2])
    expect(marked.update({}).state.field(markedLinesField)).toEqual([2])

    // The extension composes into a live view and draws one dot per line.
    const host = document.createElement('div')
    document.body.append(host)
    const live = new EditorView({
      parent: host,
      state: EditorState.create({ doc: 'one\ntwo\nthree', extensions: [markersExtension()] }),
    })
    live.dispatch({ effects: setMarkedLines.of([1, 3]) })
    await waitFor(() => { expect(host.querySelectorAll(`.${css.dot}`).length).toBe(2) })
    live.dispatch({ effects: setMarkedLines.of([]) })
    await waitFor(() => { expect(host.querySelectorAll(`.${css.dot}`).length).toBe(0) })
    // Foreign transactions leave the marked set untouched.
    live.dispatch({})
    expect(live.state.field(markedLinesField)).toEqual([])
    live.destroy()
    host.remove()

    // The entry renders nothing and appends its extension exactly once.
    const seed = mount({ stops: [] })
    expect(seed.appended).toHaveLength(1)
    expect(seed.container.firstChild).toBeNull()

    // With a frozen stop, its changed lines reach the live view's field.
    const dispatches: unknown[] = []
    const withStop = mount({
      stops: [STOP],
      view: () => ({ dispatch: (arg: unknown) => { dispatches.push(arg) } }),
    })
    await waitFor(() => { expect(dispatches.length).toBeGreaterThan(0) })
    expect(withStop.appended).toHaveLength(1)
    withStop.unmount()
    seed.unmount()

    // A first-appearance stop diffs against nothing and marks its added lines.
    const created: unknown[] = []
    const firstAppearance = mount({
      stops: [{ seq: 3, time: 3, callId: 'c3', toolName: 'write', turn: 3, after: 'sha256:b' }],
      view: () => ({ dispatch: (arg: unknown) => { created.push(arg) } }),
    })
    await waitFor(() => { expect(created.length).toBeGreaterThan(0) })
    firstAppearance.unmount()

    // A history without the file never marks a line.
    const absent: unknown[] = []
    const absentMount = mount({
      stops: [],
      history: { files: [] },
      view: () => ({ dispatch: (arg: unknown) => { absent.push(arg) } }),
    })
    await act(async () => {})
    absentMount.unmount()

    // Pruned blobs leave the field empty after the mount dispatch.
    const pruned: unknown[] = []
    const prunedMount = mount({
      stops: [STOP],
      blob: async () => null,
      view: () => ({ dispatch: (arg: unknown) => { pruned.push(arg) } }),
    })
    await waitFor(() => { expect(pruned.length).toBeGreaterThan(0) })
    prunedMount.unmount()

    // No frozen stop, or none with an after digest: no blob reads at all.
    const blob = vi.fn(async (): Promise<string | null> => null)
    const idle = mount({ stops: [], blob })
    const dangling = mount({
      stops: [{ seq: 1, time: 1, callId: 'c1', toolName: 'write', turn: 1 }],
      blob,
    })
    await act(async () => {})
    expect(blob).not.toHaveBeenCalled()
    idle.unmount()
    dangling.unmount()
  })
})
