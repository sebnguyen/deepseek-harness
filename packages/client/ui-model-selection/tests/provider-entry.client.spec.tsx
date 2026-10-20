// @vitest-environment jsdom
// Regression: the portaled window renders as a SIBLING of the trigger
// button, so clicks inside the dialog (and its close button) never bubble
// into the trigger's open/close toggle.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { zh } from '../src/client/provider/locales.ts'
import type { ProviderWindowState } from '../src/client/provider/store.ts'
import type { ProviderWindowStore } from '../src/client/provider/store.ts'
import { ProviderEntry } from '../src/client/provider/ProviderEntry.tsx'
import type { ProviderEntryProps } from '../src/client/provider/ProviderEntry.tsx'

const t = (key: keyof typeof zh, params?: Record<string, string>): string => {
  const template = zh[key]
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

const STATE: ProviderWindowState = {
  status: 'ready',
  error: null,
  failure: null,
  writable: true,
  routes: [],
  current: undefined,
  profile: undefined,
  models: [],
  protocols: [],
  credentials: {},
  pricing: undefined,
  session: undefined,
  sessionWritable: false,
  revision: undefined,
}

function renderEntry(missing = false) {
  const store = createSnapshotStore(STATE)
  const controller = {
    load: async () => undefined,
    startupCheck: async () => missing,
  } as unknown as ProviderWindowStore
  const props = {
    wide: true,
    t,
    provider: () => ({ controller, hooks: { provider: store }, t }),
  } as unknown as ProviderEntryProps
  return render(<ProviderEntry {...props} />)
}

afterEach(cleanup)

describe('provider entry', () => {
  it('keeps the window open while interacting inside it', async () => {
    renderEntry()
    const trigger = screen.getByRole('button', { name: zh['entry.aria'] })
    fireEvent.click(trigger)
    const panel = await screen.findByRole('dialog')
    // A click inside the dialog body must not toggle the trigger.
    fireEvent.click(screen.getByText(zh['table.empty']))
    expect(screen.getByRole('dialog')).toBe(panel)
  })

  it('closes through the window close and refocuses the trigger', async () => {
    renderEntry()
    const trigger = screen.getByRole('button', { name: zh['entry.aria'] })
    fireEvent.click(trigger)
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: zh['window.close'] }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('opens on a fresh start when the route key is unconfigured', async () => {
    renderEntry(true)
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('stays closed on a fresh start when the key is configured', async () => {
    renderEntry(false)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
