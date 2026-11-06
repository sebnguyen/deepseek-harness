// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CordisRuntimeFiber, CordisRuntimeTree } from '@deepseek-ai/dsh-experimental-inspector/client'
import type { InspectorTreeSnapshot } from '../src/client/tree-source.ts'
import type { CordisServicePreviewState } from '../src/client/service-preview.ts'
import type { CordisServiceSelection } from '../src/client/service-selection.ts'
import { CordisTreePanel, type CordisTreePanelProps } from '../src/client/CordisTreePanel.tsx'
import { en } from '../src/client/locales.ts'

const selection: CordisServiceSelection = {
  kind: 'injected', sourceId: 'host-preview' as never, name: 'shell', consumerUid: 1, providerUid: 42,
}
const provider: CordisRuntimeFiber = {
  kind: 'fiber', uid: 42, pluginName: 'providerPlugin', entryName: null, state: 'active',
  inject: [], store: [], provides: ['shell'], children: [{ kind: 'context', children: [] }],
}
const tree: CordisRuntimeTree = {
  schemaVersion: 1,
  host: {
    source: { sourceId: 'host-preview' as never, kind: 'host', label: 'Host' },
    connection: { state: 'connected' }, revision: 1, truncated: false,
    root: { kind: 'context', children: [provider] },
  },
  clients: [],
}
const dictionary: Record<string, string> = en
const t: CordisTreePanelProps['t'] = (key, params = {}) => Object.entries(params).reduce(
  (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), dictionary[key] ?? key,
)

function renderPreview(state: CordisServicePreviewState) {
  const snapshot: InspectorTreeSnapshot = { tree, read: true }
  const onClosePreview = vi.fn()
  const props = {
    useInspection: (selector: (value: InspectorTreeSnapshot) => InspectorTreeSnapshot) => selector(snapshot),
    usePreview: (selector: (state: CordisServicePreviewState) => CordisServicePreviewState) => selector(state),
    onRefresh: vi.fn(), onSelectService: vi.fn(), onClosePreview, t,
  } as unknown as CordisTreePanelProps
  return { onClosePreview, ...render(<CordisTreePanel {...props} />) }
}

afterEach(cleanup)

describe('service preview pane', () => {
  it('renders JSON and summary states and closes through its callback', () => {
    const ready = renderPreview({ status: 'ready', selection, preview: { kind: 'json', value: { count: 2 } } })
    expect(screen.getByText('"count": 2', { exact: false })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }))
    expect(ready.onClosePreview).toHaveBeenCalledOnce()
    ready.unmount()
    renderPreview({ status: 'ready', selection, preview: { kind: 'summary', text: 'Function value' } })
    expect(screen.getByText('Function value')).toBeTruthy()
  })

  it('shows loading and failure states', () => {
    const loading = renderPreview({ status: 'loading', selection })
    expect(screen.getByRole('status').textContent).toContain('Reading the current value')
    loading.unmount()
    renderPreview({ status: 'error', selection, message: 'transport closed' })
    expect(screen.getByRole('alert').textContent).toContain('transport closed')
  })
})
