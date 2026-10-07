// @vitest-environment jsdom

/** Covers the file-history panel: stop selection, turn zoom, diff, and restore. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FileHistoryPanel, type FileHistoryPanelProps } from '../src/client/FileHistoryView.tsx'
import type { FileHistorySnapshot } from '../src/client/fold.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

/** Translate through the shipped English dictionary, substituting `{name}` placeholders. */
function translate(key: string, params?: Record<string, string | number>): string {
  const template = (en as Record<string, string>)[key] ?? key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name]))
}

const t = translate as unknown as FileHistoryPanelProps['t']

/** Content the panel reads back for the digests these fixtures record. */
const CONTENT: Record<string, string> = { 'sha256:one': 'one\n', 'sha256:two': 'two\n', 'sha256:three': 'three\n' }

function loadText(digest: string): Promise<string | null> {
  return Promise.resolve(CONTENT[digest] ?? null)
}

/** A file whose stops span two turns, so the zoom control has something to collapse. */
const HISTORY: FileHistorySnapshot = {
  files: [{
    path: 'a.txt',
    stops: [
      { seq: 1, time: 1, callId: 'c1', toolName: 'writer', purpose: 'first write', turn: 1, step: 1, after: 'sha256:one' },
      {
        seq: 2, time: 2, callId: 'c2', toolName: 'writer', purpose: 'second write', turn: 1, step: 2,
        before: 'sha256:one', after: 'sha256:two',
      },
      {
        seq: 3, time: 3, callId: 'c3', toolName: 'writer', purpose: 'third write', turn: 2, step: 1,
        before: 'sha256:two', after: 'sha256:three',
      },
    ],
  }],
}

/** Render the panel with the fixtures above. */
function renderPanel(overrides: Partial<FileHistoryPanelProps> = {}): {
  restore: ReturnType<typeof vi.fn>
  container: HTMLElement
} {
  const restore = vi.fn(() => Promise.resolve('a.txt'))
  const { container } = render(
    <FileHistoryPanel
      history={HISTORY}
      t={t}
      restore={restore}
      loadText={loadText}
      {...overrides}
    />,
  )
  return { restore, container }
}

describe('FileHistoryPanel', () => {
  it('opens on a file’s newest stop with its purpose and diff', async () => {
    const { container } = renderPanel()
    // The path is the file-list entry and the diff header, so both sites show it.
    expect(screen.getAllByText('a.txt').length).toBe(2)
    expect(screen.getByRole('button', { name: /3 stops/ })).toBeTruthy()
    expect(screen.getByText('third write')).toBeTruthy()
    expect(screen.getByText('Turn 2 · step 1')).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByText('three')).toBeTruthy()
    })
    const slider = screen.getByLabelText('Snapshot stop') as HTMLInputElement
    expect(slider.max).toBe('2')
    expect(slider.value).toBe('2')
    expect(container.querySelectorAll('[class*="_del_"]').length).toBe(1)
  })

  it('scrubs to an earlier stop and marks the file’s creation', async () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText('Snapshot stop'), { target: { value: '0' } })
    expect(screen.getByText('first write')).toBeTruthy()
    expect(screen.getByText('created')).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByText('one')).toBeTruthy()
    })
  })

  it('zooms to one stop per turn and keeps the turn’s last stop', async () => {
    renderPanel()
    const slider = screen.getByLabelText('Snapshot stop') as HTMLInputElement
    expect(slider.max).toBe('2')
    fireEvent.click(screen.getByText('By turn'))
    expect((screen.getByLabelText('Snapshot stop') as HTMLInputElement).max).toBe('1')
    expect(screen.getByText('third write')).toBeTruthy()
    expect(screen.getByText('Turn 2 · step 1')).toBeTruthy()
  })

  it('restores the shown stop through the injected action', async () => {
    const { restore } = renderPanel()
    fireEvent.click(screen.getByText('Restore this stop'))
    await waitFor(() => {
      expect(restore).toHaveBeenCalledWith('a.txt', 'sha256:three')
    })
    expect(await screen.findByText('Restored a.txt')).toBeTruthy()
  })

  it('reports a failed restore instead of leaving the button pending', async () => {
    const restore = vi.fn(() => Promise.reject(new Error('snapshot blob sha256:three is not retained for this session')))
    renderPanel({ restore })
    fireEvent.click(screen.getByText('Restore this stop'))
    expect(await screen.findByText(/not retained/)).toBeTruthy()
    expect(screen.getByText('Restore this stop')).toBeTruthy()
  })

  it('renders the empty message for a session that captured nothing', () => {
    renderPanel({ history: { files: [] } })
    expect(screen.getByText('No file has changed in this session yet.')).toBeTruthy()
  })
})
