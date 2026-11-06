// @vitest-environment jsdom
/** Real Web Loader/renderer composition with the Inspector transport mocked at its service boundary. */
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { fireEvent, within } from '@testing-library/react'
import { describe, expect, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type {
  CordisRuntimeTree,
  InspectorService,
} from '@deepseek-ai/dsh-experimental-inspector/client'
import {
  ClientRoster,
  createClientTest,
  webApp,
} from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import { apply as inspectorUiApply, inject as inspectorUiInject } from '../src/client/index.ts'

const INSPECTOR = '@deepseek-ai/dsh-experimental-inspector'
const SELF = '@deepseek-ai/dsh-experimental-client-ui-inspector'
const TREE: CordisRuntimeTree = {
  schemaVersion: 1,
  host: {
    source: { sourceId: 'host-composition' as never, kind: 'host', label: 'Composed Host' },
    connection: { state: 'connected' },
    revision: 1,
    truncated: false,
    root: {
      kind: 'context',
      children: [{
        kind: 'fiber',
        uid: 42,
        pluginName: 'composedPlugin',
        entryName: '@fixture/composed-plugin',
        state: 'active',
        inject: ['shell'],
        store: [{ name: 'shell', providerUid: 7 }],
        provides: ['visitor'],
        children: [{ kind: 'context', children: [] }],
      }],
    },
  },
  clients: [],
}
const getTree = vi.fn(async () => TREE)
const inspector: InspectorService = {
  publish: () => undefined,
  cordis: {
    getTree,
    getService: vi.fn(async () => ({ kind: 'json' as const, value: { state: 'preview-ready' } })),
  },
}

const it = createClientTest({
  roster: ClientRoster.of([
    ...webApp.rows,
    { name: INSPECTOR, inject: [], immediately: true },
    {
      name: SELF,
      inject: [
        '@deepseek-ai/dsh-client-locale',
        '@deepseek-ai/dsh-client-ui-renderer',
        '@deepseek-ai/dsh-client-ui-sidebar',
        '@deepseek-ai/dsh-client-ui-layout',
        INSPECTOR,
      ],
      immediately: false,
    },
  ]),
  provide: {
    [INSPECTOR]: {
      apply(ctx: Context) { ctx.provide('inspector', inspector) },
    },
    // Supply the real source module directly: the test-runtime package must not
    // gain a module-resolution dependency on every opt-in plugin it can host.
    [SELF]: { apply: inspectorUiApply, inject: inspectorUiInject },
  },
}, { mount: true })

describe('experimental Inspector sidebar composition', () => {
  it('opens the real global tab, renders and refreshes the Fiber tree, and unloads both registrations', async ({ start }) => {
    const client = await start()
    const footerEntries = client.ctx.slots.entries('sidebar.footer.action')
    expect(footerEntries.map(entry => entry.options.id)).toContain('cordis-inspector')
    expect(client.ctx.slots.entries('sidebar.panellist').map(entry => entry.options.id)).not.toContain('cordis-inspector')
    expect(client.ctx.slots.entries('main').map(entry => entry.options.key)).toContain('cordis-inspector')

    const defaultMode = client.container!.querySelector<HTMLButtonElement>('[data-choice="default"]')
    if (defaultMode !== null) fireEvent.click(defaultMode)
    const tab = await within(client.container!).findByRole('button', { name: 'Cordis runtime' })
    fireEvent.click(tab)
    await vi.waitFor(() => { expect(client.container!.textContent).toContain('Fiber #42') })
    expect(client.container!.textContent).toContain('Composed Host')
    expect(client.container!.textContent).toContain('@fixture/composed-plugin')
    expect(client.container!.textContent).toContain('shell → Fiber #7')
    expect(getTree).toHaveBeenCalled()
    fireEvent.click(within(client.container!).getByRole('button', { name: 'Focus provider of shell, Fiber #7' }))
    await vi.waitFor(() => { expect(client.container!.textContent).toContain('preview-ready') })

    const reads = getTree.mock.calls.length
    fireEvent.click(within(client.container!).getByRole('button', { name: /Refresh|刷新/u }))
    await vi.waitFor(() => { expect(getTree.mock.calls.length).toBeGreaterThan(reads) })

    await client.unload(SELF)
    await client.flush()
    expect(client.ctx.slots.entries('sidebar.footer.action').map(entry => entry.options.id)).not.toContain('cordis-inspector')
    expect(client.ctx.slots.entries('main').map(entry => entry.options.key)).not.toContain('cordis-inspector')
    await vi.waitFor(() => { expect(client.container!.textContent).not.toContain('Fiber #42') })
  }, 60_000)
})
