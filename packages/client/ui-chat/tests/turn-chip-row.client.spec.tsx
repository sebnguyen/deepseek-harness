/**
 * The turn chip row: one chip per register slot of the turn, worktree
 * counts resolved from retained blobs, and click-through to the frozen
 * Changes stop — or the noted line for a note chip.
 */
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(cleanup)
import { TurnChipRow, chipLabel } from '../src/client/chat/TurnChipRow.tsx'
import { en } from '../src/client/locale.ts'

const BLOBS: Record<string, string> = {
  'sha256:a': 'one\n',
  'sha256:b': 'one\ntwo\n',
}

function t(key: keyof typeof en, params?: Record<string, unknown>): string {
  const line = en[key]
  if (params === undefined) return line
  return line.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match)
}

const TIMELINES = [{
  path: 'src/notes.txt',
  slots: [
    {
      slotId: 'c2', kind: 'worktree', path: 'src/notes.txt', label: 'write', turn: 2,
      callId: 'c2', createdAt: 2, before: 'sha256:a', after: 'sha256:b', detail: { toolName: 'write' },
    },
    {
      slotId: 'note-a', kind: 'note', path: 'src/notes.txt', label: 'careful', turn: 2,
      line: 4, createdAt: 3, detail: { text: 'careful' },
    },
    {
      slotId: 'c9', kind: 'worktree', path: 'src/other.txt', label: 'write', turn: 3,
      callId: 'c9', createdAt: 4, after: 'sha256:b', detail: { toolName: 'write' },
    },
  ],
}]

function Row({ openFile }: { openFile: (path: string, options?: unknown) => void }): ReactNode {
  return createElement(TurnChipRow, {
    turn: { turn: 2 },
    seq: 1,
    openFile,
    slots: () => Promise.resolve(TIMELINES as never),
    blob: async (digest: string) => BLOBS[digest] ?? null,
    t,
  } as never)
}

describe('TurnChipRow', () => {
  it('labels chips by their trailing path segment', () => {
    expect(chipLabel('src/notes.txt')).toBe('notes.txt')
    expect(chipLabel('lonely.txt')).toBe('lonely.txt')
  })

  it('lists only this turn\'s worktree and note slots', async () => {
    const openFile = vi.fn()
    const { container } = render(createElement(Row, { openFile }))
    await screen.findAllByText('notes.txt')
    const chips = container.querySelectorAll('[role=listitem]')
    expect(chips.length).toBe(2)
    expect(container.textContent).not.toContain('other.txt')
    await waitFor(() => { expect(container.textContent).toContain('+1 −0') })
  })

  it('opens a worktree chip on its frozen stop and a note chip on its line', async () => {
    const openFile = vi.fn()
    const { container } = render(createElement(Row, { openFile }))
    await waitFor(() => { expect(container.querySelectorAll('[role=listitem]').length).toBe(2) })
    const [worktree, note] = [...container.querySelectorAll('[role=listitem]')]
    act(() => { fireEvent.click(worktree as HTMLElement) })
    expect(openFile).toHaveBeenLastCalledWith('src/notes.txt', { display: 'changes', stop: 'c2' })
    act(() => { fireEvent.click(note as HTMLElement) })
    expect(openFile).toHaveBeenLastCalledWith('src/notes.txt', { line: 4 })
  })

  it('renders nothing for a turn with no slots', async () => {
    const openFile = vi.fn()
    render(createElement(TurnChipRow, {
      turn: { turn: 9 },
      seq: 1,
      openFile,
      slots: () => Promise.resolve(TIMELINES as never),
      blob: async () => null,
      t,
    } as never))
    await act(async () => {})
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('skips counts when a blob was pruned', async () => {
    const openFile = vi.fn()
    render(createElement(TurnChipRow, {
      turn: { turn: 2 },
      seq: 1,
      openFile,
      slots: () => Promise.resolve(TIMELINES as never),
      blob: async () => null,
      t,
    } as never))
    await screen.findAllByText('notes.txt')
    await act(async () => {})
    expect(screen.queryByText('+1 −0')).toBeNull()
  })
})
