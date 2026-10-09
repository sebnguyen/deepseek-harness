/**
 * The note gutter end to end: a `+` per line, a pencil where a note
 * lives, and the popover that mints and puts the slot. The column
 * extension rides the runtime doors the owner face carries; this rig
 * stands in for them with a real retained set and a live dispatch.
 */
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as cmState from '@codemirror/state'
import * as cmView from '@codemirror/view'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setGutterMarkers } from '@deepseek-ai/dsh-client-ui-editor/client'
import { LineNoteGutter } from '../src/client/LineNoteGutter.tsx'
import type { LineNoteGutterProps } from '../src/client/LineNoteGutter.tsx'
import { en } from '../src/client/locales.ts'
import type { LineNotesSnapshot } from '../src/client/source.ts'

afterEach(cleanup)

const NOTE = {
  slotId: 'note-a', kind: 'note', path: 'notes.txt', label: 'careful', line: 2, createdAt: 1, detail: { text: 'careful' },
}

function t(key: keyof typeof en, params?: Record<string, unknown>): string {
  const line = en[key]
  if (params === undefined) return line
  return line.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match)
}

interface Rig {
  readonly exts: cmState.Extension[]
  readonly disposed: string[]
  readonly putSlot: ReturnType<typeof vi.fn>
  readonly attach: (view: cmView.EditorView) => void
  readonly rerender: (version: number) => void
  readonly unmount: () => void
}

function Rig({ notes, absent = false }: {
  readonly notes: readonly unknown[]
  readonly absent?: boolean
}): Rig {
  const exts: cmState.Extension[] = []
  const disposed: string[] = []
  const putSlot = vi.fn(() => Promise.resolve({ ok: true }))
  let live: cmView.EditorView | undefined
  let version = 0
  let handle: ReturnType<typeof render> | undefined
  // Identity-stable faces, like the owner's useCallback-backed ones; a
  // rerender must not re-register the column.
  const add = (id: string, extension: cmState.Extension): (() => void) => {
    exts.push(extension)
    return () => {
      disposed.push(id)
      const at = exts.indexOf(extension)
      if (at >= 0) exts.splice(at, 1)
    }
  }
  const publishMarkers = (id: string, markers: readonly unknown[]): void => {
    live?.dispatch({ effects: setGutterMarkers.of({ id, markers: markers as never }) })
  }
  const lineText = (line: number): string =>
    live !== undefined && line <= live.state.doc.lines ? live.state.doc.line(line).text : ''
  const props = (): LineNoteGutterProps => ({
    file: { sessionId: 's-1', path: 'notes.txt' },
    viewVersion: version,
    modules: { state: cmState, view: cmView },
    liveView: () => live,
    add,
    replace: () => {},
    compartmentOf: () => new cmState.Compartment(),
    describeColumn: () => () => {},
    publishMarkers,
    lineText,
    useLineNotes: (selector: (snapshot: LineNotesSnapshot) => unknown) =>
      selector({
        byPath: new Map(absent ? [] : [['notes.txt', notes]]),
      } as LineNotesSnapshot),
    putSlot,
    t,
  } as never)
  return {
    exts,
    disposed,
    putSlot,
    attach: (view) => {
      live = view
    },
    rerender(next: number) {
      version = next
      if (handle === undefined) handle = render(createElement(LineNoteGutter, props() as never))
      else handle.rerender(createElement(LineNoteGutter, props() as never))
    },
    unmount: () => {
      handle?.unmount()
    },
  }
}

function viewOver(rig: Rig, doc: string): cmView.EditorView {
  const host = document.createElement('div')
  document.body.append(host)
  return new cmView.EditorView({
    parent: host,
    state: cmState.EditorState.create({ doc, extensions: rig.exts }),
  })
}

describe('LineNoteGutter', () => {
  it('draws a plus per empty line and a pencil where a note lives', async () => {
    const rig = Rig({ notes: [NOTE] })
    rig.rerender(0)
    expect(rig.exts).toHaveLength(1)
    const view = viewOver(rig, 'one\ntwo\nthree')
    rig.attach(view)
    rig.rerender(1)
    await waitFor(() => {
      expect(view.dom.querySelectorAll('button').length).toBeGreaterThan(0)
    })
    const buttons = [...view.dom.querySelectorAll('button')]
    const noted = buttons.find(button => button.textContent === '✎')
    expect(noted).toBeDefined()
    expect(noted!.dataset.line).toBe('2')
    const plus = buttons.find(button => button.textContent === '+')
    expect(plus).toBeDefined()
    // Foreign effects keep the drawn note lines; only publishMarkers moves them.
    view.dispatch({ effects: cmState.StateEffect.appendConfig.of([]) })
    expect([...view.dom.querySelectorAll('button')].some(button => button.textContent === '✎')).toBe(true)
    // Unmounting disposes the retained column through its disposer.
    rig.unmount()
    expect(rig.disposed).toEqual(['line-note'])
    expect(rig.exts).toHaveLength(0)
    view.destroy()
    view.dom.parentElement?.remove()
  })

  it('puts a minted note slot from the popover and closes it', async () => {
    const rig = Rig({ notes: [] })
    rig.rerender(0)
    const view = viewOver(rig, 'one\ntwo\nthree')
    rig.attach(view)
    rig.rerender(1)
    await waitFor(() => { expect(view.dom.querySelectorAll('button').length).toBeGreaterThan(0) })
    const plus = [...view.dom.querySelectorAll('button')].find(button => button.dataset.line === '3')!
    act(() => { fireEvent.click(plus) })
    const box = screen.getByPlaceholderText('Note for line 3…')
    // An empty note refuses to put.
    act(() => { fireEvent.click(screen.getByText('Add')) })
    expect(rig.putSlot).not.toHaveBeenCalled()
    act(() => { fireEvent.change(box, { target: { value: 'careful' } }) })
    act(() => { fireEvent.click(screen.getByText('Add')) })
    await waitFor(() => { expect(rig.putSlot).toHaveBeenCalledTimes(1) })
    const slot = rig.putSlot.mock.calls[0]?.[0] as Record<string, unknown>
    expect(slot).toMatchObject({
      kind: 'note', path: 'notes.txt', label: 'careful', line: 3, retained: 'three', detail: { text: 'careful' },
    })
    expect(String(slot.slotId)).toMatch(/^note-[0-9a-f]{12}$/)
    await waitFor(() => { expect(screen.queryByText('Cancel')).toBeNull() })
    view.destroy()
    view.dom.parentElement?.remove()
  })

  it('retains nothing when the document shrank under the popover', async () => {
    const rig = Rig({ notes: [] })
    rig.rerender(0)
    const view = viewOver(rig, 'one\ntwo\nthree')
    rig.attach(view)
    rig.rerender(1)
    await waitFor(() => { expect(view.dom.querySelectorAll('button').length).toBeGreaterThan(0) })
    act(() => {
      fireEvent.click([...view.dom.querySelectorAll('button')].find(button => button.dataset.line === '3') as HTMLElement)
    })
    act(() => { view.dispatch({ changes: { from: 0, to: view.state.doc.length } }) })
    act(() => { fireEvent.change(screen.getByPlaceholderText('Note for line 3…'), { target: { value: 'careful' } }) })
    act(() => { fireEvent.click(screen.getByText('Add')) })
    await waitFor(() => { expect(rig.putSlot).toHaveBeenCalledTimes(1) })
    const slot = rig.putSlot.mock.calls[0]?.[0] as Record<string, unknown>
    expect(slot.retained).toBe('')
    view.destroy()
    view.dom.parentElement?.remove()
  })

  it('cancels the popover without putting', async () => {
    const rig = Rig({ notes: [] })
    rig.rerender(0)
    const view = viewOver(rig, 'one')
    rig.attach(view)
    rig.rerender(1)
    await waitFor(() => { expect(view.dom.querySelectorAll('button').length).toBeGreaterThan(0) })
    act(() => { fireEvent.click([...view.dom.querySelectorAll('button')][0] as HTMLElement) })
    act(() => { fireEvent.click(screen.getByText('Cancel')) })
    expect(screen.queryByText('Cancel')).toBeNull()
    expect(rig.putSlot).not.toHaveBeenCalled()
    view.destroy()
    view.dom.parentElement?.remove()
  })

  it('draws only plus marks for a file the register has no notes for', async () => {
    const rig = Rig({ notes: [], absent: true })
    rig.rerender(0)
    const view = viewOver(rig, 'one\ntwo')
    rig.attach(view)
    rig.rerender(1)
    await waitFor(() => { expect(view.dom.querySelectorAll('button').length).toBeGreaterThan(0) })
    const buttons = [...view.dom.querySelectorAll('button')]
    expect(buttons.every(button => button.textContent === '+')).toBe(true)
    view.destroy()
    view.dom.parentElement?.remove()
  })
})
