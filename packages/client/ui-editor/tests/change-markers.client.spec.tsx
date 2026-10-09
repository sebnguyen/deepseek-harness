/**
 * The change-marker entry: describes one gutter column and publishes the
 * changed lines of the file's latest frozen stop as plain dot markers;
 * the editor's compositor draws published markers through its one view.
 */
// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { annotationGutter, setGutterMarkers } from '../src/client/annotations.ts'
import { ChangeMarkers } from '../src/client/change-markers.tsx'
import css from '../src/client/change-markers.module.css'
import type { EditorGutterDescriptor, EditorGutterMarker } from '../src/client/contract/slots.ts'

afterEach(cleanup)

const BLOBS: Record<string, string> = {
  'sha256:a': 'one\n',
  'sha256:b': 'one\ntwo\n',
}

const STOP = {
  seq: 2, time: 2, callId: 'c2', toolName: 'write', turn: 2, before: 'sha256:a', after: 'sha256:b',
}

interface MountResult {
  readonly columns: EditorGutterDescriptor[]
  readonly published: Array<readonly [string, readonly EditorGutterMarker[]]>
  readonly unmount: () => void
  readonly container: HTMLElement
}

/** Mount the entry over one file's stops; recorders capture the bulletin. */
function mount(options: {
  readonly stops: readonly unknown[]
  readonly blob?: (digest: string) => Promise<string | null>
  readonly history?: unknown
}): MountResult {
  const columns: EditorGutterDescriptor[] = []
  const published: Array<readonly [string, readonly EditorGutterMarker[]]> = []
  const handle = render(createElement(ChangeMarkers, {
    file: { sessionId: 's-1', path: 'notes.txt' },
    blob: options.blob ?? (async (digest: string) => BLOBS[digest] ?? null),
    viewVersion: 0,
    describeColumn: (descriptor: EditorGutterDescriptor) => {
      columns.push(descriptor)
      return () => {
        const at = columns.indexOf(descriptor)
        if (at >= 0) columns.splice(at, 1)
      }
    },
    publishMarkers: (id: string, markers: readonly EditorGutterMarker[]) => {
      published.push([id, markers])
    },
    useFileHistory: (selector: (snapshot: unknown) => unknown) =>
      selector(options.history ?? { files: [{ path: 'notes.txt', stops: options.stops }] }),
  } as never))
  return { columns, published, unmount: handle.unmount, container: handle.container }
}

describe('change markers', () => {
  it('describes one column, publishes the changed lines, and draws them through the compositor', async () => {
    const seeded = mount({ stops: [STOP] })
    await waitFor(() => {
      expect(seeded.published.at(-1)?.[1]).toHaveLength(1)
    })
    expect(seeded.columns).toHaveLength(1)
    expect(seeded.columns[0]?.id).toBe('change-markers')
    expect(seeded.container.firstChild).toBeNull()
    const [, markers] = seeded.published.at(-1) ?? ['', []]
    expect(markers[0]).toMatchObject({ line: 2, label: '', className: css.dot })

    // The editor side of the bulletin: composed once, published markers draw.
    const host = document.createElement('div')
    document.body.append(host)
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: 'one\ntwo\n', extensions: [annotationGutter(seeded.columns[0]!)] }),
    })
    act(() => {
      view.dispatch({ effects: setGutterMarkers.of({ id: 'change-markers', markers }) })
    })
    await waitFor(() => {
      expect(host.querySelectorAll(`.${css.dot}`)).toHaveLength(1)
    })
    view.destroy()
    host.remove()
    seeded.unmount()
  })

  it('a first-appearance stop diffs against nothing and marks its added lines', async () => {
    const created = mount({ stops: [{ seq: 3, time: 3, callId: 'c3', toolName: 'write', turn: 3, after: 'sha256:b' }] })
    await waitFor(() => {
      expect(created.published.at(-1)?.[1]).toHaveLength(2)
    })
    created.unmount()
  })

  it('no stop, no after digest, pruned blobs, or a rejecting blob publish empty', async () => {
    const idle = mount({ stops: [] })
    const dangling = mount({ stops: [{ seq: 1, time: 1, callId: 'c1', toolName: 'write', turn: 1 }] })
    const pruned = mount({ stops: [STOP], blob: async () => null })
    const rejecting = mount({ stops: [STOP], blob: () => Promise.reject(new Error('down')) })
    await act(async () => {})
    await waitFor(() => {
      expect(pruned.published.at(-1)?.[1]).toEqual([])
    })
    await waitFor(() => {
      expect(rejecting.published.at(-1)?.[1]).toEqual([])
    })
    expect(idle.published.at(-1)?.[1]).toEqual([])
    expect(dangling.published.at(-1)?.[1]).toEqual([])
    idle.unmount()
    dangling.unmount()
    pruned.unmount()
    rejecting.unmount()
  })

  it('an aborted read after unmount keeps the current marks', async () => {
    let release: (value: string | null) => void = () => {}
    const held = mount({
      stops: [STOP],
      blob: () => new Promise<string | null>((resolve) => {
        release = resolve
      }),
    })
    await act(async () => {})
    held.unmount()
    release('one\n')
    await act(async () => {})
    // The resolve lands after disposal: nothing but the initial publish.
    expect(held.published.every(([, markers]) => markers.length === 0)).toBe(true)
  })
})
