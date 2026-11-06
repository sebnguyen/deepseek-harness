import { describe, expect, it, vi } from 'vitest'
import type { CordisServiceGetQuery, CordisServicePreview } from '@deepseek-ai/dsh-experimental-inspector/client'
import { createServicePreview } from '../src/client/service-preview.ts'
import type { CordisServiceSelection } from '../src/client/service-selection.ts'

const provided: CordisServiceSelection = {
  kind: 'provided',
  sourceId: 'host-preview' as never,
  name: 'shell',
  providerUid: 42,
  ordinal: 0,
  occurrences: 1,
}
const injected: CordisServiceSelection = {
  kind: 'injected',
  sourceId: 'client-preview' as never,
  name: 'editor',
  consumerUid: 9,
  providerUid: 42,
}

const flush = async (): Promise<void> => { await new Promise<void>((resolve) => { setTimeout(resolve, 0) }) }

describe('service preview controller', () => {
  it('queries exact coordinates, discards an older response, and clears through publication', async () => {
    const responses: ((preview: CordisServicePreview) => void)[] = []
    const read = vi.fn((_query: CordisServiceGetQuery) => new Promise<CordisServicePreview>((resolve) => { responses.push(resolve) }))
    const preview = createServicePreview(read)
    const listener = vi.fn()
    preview.subscribe(listener)
    preview.select(provided)
    expect(preview.getSnapshot()).toEqual({ status: 'loading', selection: provided })
    preview.select(injected)
    expect(read).toHaveBeenCalledTimes(2)
    expect(read.mock.calls[0]?.[0]).toEqual({
      op: 'cordis-service/get', targetSourceId: 'host-preview', kind: 'provided', fiberUid: 42, name: 'shell', ordinal: 0, occurrences: 1,
    })
    expect(read.mock.calls[1]?.[0]).toEqual({
      op: 'cordis-service/get', targetSourceId: 'client-preview', kind: 'injected', fiberUid: 9, name: 'editor', providerUid: 42,
    })

    responses[0]?.({ kind: 'json', value: 'stale' })
    await flush()
    expect(preview.getSnapshot()).toEqual({ status: 'loading', selection: injected })
    responses[1]?.({ kind: 'json', value: { ready: true } })
    await flush()
    expect(preview.getSnapshot()).toEqual({
      status: 'ready', selection: injected, preview: { kind: 'json', value: { ready: true } },
    })
    preview.clear()
    expect(preview.getSnapshot()).toBeNull()
    expect(listener).toHaveBeenCalled()
    preview.dispose()
  })

  it('reports failures and suppresses results after close or disposal', async () => {
    const pending: Array<{
      resolve: (preview: CordisServicePreview) => void
      reject: (reason: unknown) => void
    }> = []
    const preview = createServicePreview(() => new Promise<CordisServicePreview>((resolve, reject) => {
      pending.push({ resolve, reject })
    }))
    preview.select(provided)
    pending[0]?.reject(new Error('transport closed'))
    await flush()
    expect(preview.getSnapshot()).toEqual({ status: 'error', selection: provided, message: 'transport closed' })

    preview.select(injected)
    preview.clear()
    expect(preview.getSnapshot()).toBeNull()
    pending[1]?.resolve({ kind: 'summary', text: 'ignored' })
    await flush()
    expect(preview.getSnapshot()).toBeNull()

    preview.select(provided)
    const listener = vi.fn()
    preview.subscribe(listener)
    preview.dispose()
    pending[2]?.resolve({ kind: 'summary', text: 'disposed' })
    await flush()
    expect(preview.getSnapshot()).toBeNull()
    expect(listener).not.toHaveBeenCalled()
    preview.dispose()
  })
})
