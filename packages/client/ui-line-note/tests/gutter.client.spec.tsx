/**
 * The note gutter end to end: a `+` per line, a pencil where a note
 * lives, and the popover that mints and puts the slot.
 */
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EditorState, StateEffect } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(cleanup)
import { EditorView as _needed } from '@codemirror/view'
import { LineNoteGutter } from '../src/client/LineNoteGutter.tsx'
import type { LineNoteGutterProps } from '../src/client/LineNoteGutter.tsx'
import { en } from '../src/client/locales.ts'
import type { LineNotesSnapshot } from '../src/client/source.ts'

void _needed

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
  readonly exts: unknown[]
  readonly putSlot: ReturnType<typeof vi.fn>
  readonly attach: (view: EditorView) => void
}

function Rig({ notes, absent = false }: {
  notes: readonly unknown[]
  absent?: boolean
}): Rig & { rerender: (version: number) => void } {
  const exts: unknown[] = []
  const putSlot = vi.fn(() => Promise.resolve({ ok: true }))
  let live: EditorView | undefined
  let version = 0
  const props = (): LineNoteGutterProps => ({
    file: { sessionId: 's-1', path: 'notes.txt' },
    append: (extension: unknown) => {
      exts.push(extension)
      return () => {}
    },
    view: () => live,
    viewVersion: version,
    useLineNotes: (selector: (snapshot: LineNotesSnapshot) => unknown) =>
      selector({
        byPath: new Map(absent ? [] : [['notes.txt', notes]]),
      } as LineNotesSnapshot),
    putSlot,
    t,
  } as never)
  let handle: ReturnType<typeof render> | undefined
  return {
    exts,
    putSlot,
    attach: (view) => { live = view },
    rerender(next: number) {
      version = next
      if (handle === undefined) handle = render(createElement(LineNoteGutter, props() as never))
      else handle.rerender(createElement(LineNoteGutter, props() as never))
    },
  }
}

describe('LineNoteGutter', () => {
  it('draws a plus per empty line and a pencil where a note lives', async () => {
    const rig = Rig({ notes: [NOTE] })
    rig.rerender(0)
    expect(rig.exts).toHaveLength(1)
    const host = document.createElement('div')
    document.body.append(host)
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: 'one\ntwo\nthree', extensions: rig.exts as never }),
    })
    rig.attach(view)
    rig.rerender(1)
    await waitFor(() => {
      const buttons = host.querySelectorAll('button')
      expect(buttons.length).toBeGreaterThan(0)
    })
    const buttons = [...host.querySelectorAll('button')]
    const noted = buttons.find(button => button.textContent === '✎')
    expect(noted).toBeDefined()
    expect(noted!.dataset.line).toBe('2')
    const plus = buttons.find(button => button.textContent === '+')
    expect(plus).toBeDefined()
    // Foreign effects keep the drawn note lines; only setNoteLines moves them.
    view.dispatch({ effects: StateEffect.appendConfig.of([]) })
    expect([...host.querySelectorAll('button')].some(button => button.textContent === '✎')).toBe(true)
    view.destroy()
    host.remove()
  })

  it('puts a minted note slot from the popover and closes it', async () => {
    const rig = Rig({ notes: [] })
    rig.rerender(0)
    const host = document.createElement('div')
    document.body.append(host)
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: 'one\ntwo\nthree', extensions: rig.exts as never }),
    })
    rig.attach(view)
    rig.rerender(1)
    await waitFor(() => { expect(host.querySelectorAll('button').length).toBeGreaterThan(0) })
    const plus = [...host.querySelectorAll('button')].find(button => button.dataset.line === '3')!
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
    host.remove()
  })

  it('retains nothing when the document shrank under the popover', async () => {
    const rig = Rig({ notes: [] })
    rig.rerender(0)
    const host = document.createElement('div')
    document.body.append(host)
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: 'one\ntwo\nthree', extensions: rig.exts as never }),
    })
    rig.attach(view)
    rig.rerender(1)
    await waitFor(() => { expect(host.querySelectorAll('button').length).toBeGreaterThan(0) })
    act(() => {
      fireEvent.click([...host.querySelectorAll('button')].find(button => button.dataset.line === '3') as HTMLElement)
    })
    act(() => { view.dispatch({ changes: { from: 0, to: view.state.doc.length } }) })
    act(() => { fireEvent.change(screen.getByPlaceholderText('Note for line 3…'), { target: { value: 'careful' } }) })
    act(() => { fireEvent.click(screen.getByText('Add')) })
    await waitFor(() => { expect(rig.putSlot).toHaveBeenCalledTimes(1) })
    const slot = rig.putSlot.mock.calls[0]?.[0] as Record<string, unknown>
    expect(slot.retained).toBe('')
    view.destroy()
    host.remove()
  })

  it('cancels the popover without putting', async () => {
    const rig = Rig({ notes: [] })
    rig.rerender(0)
    const host = document.createElement('div')
    document.body.append(host)
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: 'one', extensions: rig.exts as never }),
    })
    rig.attach(view)
    rig.rerender(1)
    await waitFor(() => { expect(host.querySelectorAll('button').length).toBeGreaterThan(0) })
    act(() => { fireEvent.click([...host.querySelectorAll('button')][0] as HTMLElement) })
    act(() => { fireEvent.click(screen.getByText('Cancel')) })
    expect(screen.queryByText('Cancel')).toBeNull()
    expect(rig.putSlot).not.toHaveBeenCalled()
    view.destroy()
    host.remove()
  })

  it('draws only plus marks for a file the register has no notes for', async () => {
    const rig = Rig({ notes: [], absent: true })
    rig.rerender(0)
    const host = document.createElement('div')
    document.body.append(host)
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: 'one\ntwo', extensions: rig.exts as never }),
    })
    rig.attach(view)
    rig.rerender(1)
    await waitFor(() => { expect(host.querySelectorAll('button').length).toBeGreaterThan(0) })
    const buttons = [...host.querySelectorAll('button')]
    expect(buttons.every(button => button.textContent === '+')).toBe(true)
    view.destroy()
    host.remove()
  })
})
