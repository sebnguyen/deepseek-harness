// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import * as modulesClient from '@deepseek-ai/dsh-client-modules/client'
import type {
  ClientBundleRegistration, ClientModuleCreateOptions, ClientModuleLoaderTarget, DshWindow,
  WebBootEntry,
} from '@deepseek-ai/dsh-client-modules/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppWebEntry } from '../src/boot.ts'
import { awaitDataReady } from '../src/data-ready.ts'

const MODULES_ID = '@deepseek-ai/dsh-client-modules'
const PROVIDER_CLIENT_ID = 'provider/client'
const RUNTIME_CLIENT_ID = 'runtime/client'
const win = globalThis as DshWindow
const transportGlobal = globalThis as {
  __DSH_TRANSPORT__?: { loadBundle(url: string): Promise<void> }
}
const moduleFace = modulesClient as unknown as Record<string, unknown>

afterEach(() => {
  vi.restoreAllMocks()
  delete win.__DSH_BOOT__
  delete win.__ModuleLoader__
  delete transportGlobal.__DSH_TRANSPORT__
  document.body.innerHTML = ''
})

/** Install the stable facade shape that the Host injects before AppWebEntry runs. */
function installFacade(
  create?: (options: ClientModuleCreateOptions) => modulesClient.ClientModuleSystem,
): ClientModuleLoaderTarget {
  const pendingQueue: ClientBundleRegistration[] = []
  const target: ClientModuleLoaderTarget = {
    mode: 'queue',
    pendingQueue,
    load: (registration) => { pendingQueue.push(registration) },
    create: create ?? (options => modulesClient.createClientModuleSystem(target, {
      id: MODULES_ID,
      exports: moduleFace,
    }, options)),
  }
  win.__ModuleLoader__ = target
  return target
}

async function expectBootFailure(setup: () => void, message: string): Promise<void> {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const container = document.createElement('div')
  document.body.append(container)
  setup()
  const entry = new AppWebEntry(container)
  await entry.run()
  expect(container.textContent).toContain(message)
  expect(error).toHaveBeenCalledOnce()
  await entry.dispose()
}

describe('bootstrap failure rendering', () => {
  it('renders a missing bootstrap facade', async () => {
    await expectBootFailure(
      () => { delete win.__ModuleLoader__ },
      'window.__ModuleLoader__ bootstrap facade is missing',
    )
  })

  it('renders a create failure owned by the facade', async () => {
    await expectBootFailure(() => {
      installFacade(() => { throw new Error('facade create failed') })
    }, 'facade create failed')
  })

  it('renders a malformed boot manifest', async () => {
    await expectBootFailure(() => {
      installFacade()
      delete win.__DSH_BOOT__
    }, 'window.__DSH_BOOT__ is missing or not an object')
  })

  it('renders a module-system construction failure', async () => {
    await expectBootFailure(() => {
      installFacade()
      const duplicate = { id: 'duplicate', url: '/duplicate/client.js', rev: '1' }
      win.__DSH_BOOT__ = {
        rev: 'graph',
        entries: [duplicate, duplicate],
        batches: [{ phase: 'application', url: '/batch.js', rev: 'batch', entries: ['duplicate'] }],
      }
    }, 'duplicate graph entry "duplicate"')
  })
})

describe('plugin activation', () => {
  it('prefetches a parser-loaded immediate row through the injected bundle transport', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const target = installFacade()
    const entries: WebBootEntry[] = [
      { id: 'consumer', url: '/consumer.js', rev: '1' },
      {
        id: 'runtime',
        url: '/runtime.js',
        rev: '1',
        external: [PROVIDER_CLIENT_ID],
        immediately: true,
      },
      { id: 'provider', url: '/provider.js', rev: '1' },
      { id: 'renderer', url: '/renderer.js', rev: '1' },
    ]
    const applicationUrl = '/application.js'
    win.__DSH_BOOT__ = {
      rev: 'graph',
      entries,
      batches: [{ phase: 'application', url: applicationUrl, rev: 'batch', entries: entries.map(row => row.id) }],
    }
    const loaded: string[] = []
    const registrations: ClientBundleRegistration[] = [
      {
        id: 'consumer',
        factory: require => ({
          apply: () => {
            expect((require(RUNTIME_CLIENT_ID) as { marker: string }).marker).toBe('provider')
          },
        }),
      },
      {
        id: 'provider',
        factory: () => ({ apply: () => {}, marker: 'provider' }),
      },
      {
        id: 'runtime',
        factory: require => ({
          apply: () => {},
          marker: (require(PROVIDER_CLIENT_ID) as { marker: string }).marker,
        }),
      },
      {
        id: 'renderer',
        factory: () => ({
          apply: (ctx: Context) => {
            ctx.reflect.provide('uiRenderer', { mount: () => () => {} })
          },
        }),
      },
    ]
    transportGlobal.__DSH_TRANSPORT__ = {
      loadBundle: async (url) => {
        loaded.push(url)
        if (url !== applicationUrl) throw new Error(`missing fixture batch ${url}`)
        for (const registration of registrations) target.load(registration)
      },
    }

    const entry = new AppWebEntry(container)
    await entry.run()

    expect(loaded).toEqual([applicationUrl])
    await entry.dispose()
  })

  it('allows a modules-dependent row to be created before the modules row', async () => {
    const events: string[] = []
    const container = document.createElement('div')
    document.body.append(container)
    const target = installFacade()
    const entries: WebBootEntry[] = [
      { id: 'consumer', url: '/consumer.js', rev: '1' },
      { id: MODULES_ID, url: '/modules.js', rev: '1' },
      { id: 'renderer', url: '/renderer.js', rev: '1' },
    ]
    win.__DSH_BOOT__ = {
      rev: 'graph',
      entries,
      batches: [{
        phase: 'application',
        url: '/application.js',
        rev: 'batch',
        entries: entries.map(row => row.id),
      }],
    }
    const registrations = new Map<string, ClientBundleRegistration>([
      ['/consumer.js', {
        id: 'consumer',
        factory: () => ({
          inject: ['modules'],
          apply: (ctx: Context) => {
            expect(ctx.modules).toBeDefined()
            events.push('consumer')
          },
        }),
      }],
      ['/renderer.js', {
        id: 'renderer',
        factory: () => ({
          apply: (ctx: Context) => {
            ctx.reflect.provide('uiRenderer', {
              mount: (element: HTMLElement) => {
                events.push('mount')
                element.textContent = 'mounted'
                return () => {}
              },
            })
          },
        }),
      }],
    ])
    const entry = new AppWebEntry(container, {
      loadBundle: async (url) => {
        if (url !== '/application.js') throw new Error(`missing fixture batch ${url}`)
        for (const registration of registrations.values()) target.load(registration)
      },
    })

    await entry.run()

    expect(target.mode).toBe('live')
    expect(events).toEqual(['consumer', 'mount'])
    expect(container.textContent).toBe('mounted')
    await entry.dispose()
  })

  it('defers the renderer handoff until the session list baseline lands', async () => {
    const events: string[] = []
    const container = document.createElement('div')
    document.body.append(container)
    const target = installFacade()
    const listeners = new Set<() => void>()
    let listSnapshot: { phase: string } = { phase: 'pending' }
    const entries: WebBootEntry[] = [
      { id: 'sessions', url: '/sessions.js', rev: '1' },
      { id: 'renderer', url: '/renderer.js', rev: '1' },
    ]
    win.__DSH_BOOT__ = {
      rev: 'graph',
      entries,
      batches: [{ phase: 'application', url: '/application.js', rev: 'batch', entries: entries.map(row => row.id) }],
    }
    const registrations = new Map<string, ClientBundleRegistration>([
      ['/sessions.js', {
        id: 'sessions',
        factory: () => ({
          apply: (ctx: Context) => {
            ctx.reflect.provide('sessions', {
              list: {
                getSnapshot: () => listSnapshot,
                subscribe: (listener: () => void) => {
                  listeners.add(listener)
                  return () => { listeners.delete(listener) }
                },
              },
            })
          },
        }),
      }],
      ['/renderer.js', {
        id: 'renderer',
        factory: () => ({
          apply: (ctx: Context) => {
            ctx.reflect.provide('uiRenderer', {
              mount: (element: HTMLElement) => {
                events.push('mount')
                element.textContent = 'mounted'
                return () => {}
              },
            })
          },
        }),
      }],
    ])
    const entry = new AppWebEntry(container, {
      loadBundle: async (url) => {
        if (url !== '/application.js') throw new Error(`missing fixture batch ${url}`)
        for (const registration of registrations.values()) target.load(registration)
      },
    })
    setTimeout(() => {
      events.push('flip')
      listSnapshot = { phase: 'ready' }
      for (const listener of [...listeners]) listener()
    }, 25)

    await entry.run()

    expect(events).toEqual(['flip', 'mount'])
    expect(container.textContent).toBe('mounted')
    await entry.dispose()
  })
})

describe('host data-ready gate', () => {
  function controllableSource(initial: unknown) {
    const listeners = new Set<() => void>()
    let snapshot = initial
    return {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      set: (next: unknown) => {
        snapshot = next
        for (const listener of [...listeners]) listener()
      },
    }
  }

  it('resolves immediately when the boot graph provides none of the gated services', async () => {
    const ctx = new Context()
    await awaitDataReady(ctx)
  })

  it('waits for the connection outcome and both list baselines', async () => {
    const ctx = new Context()
    const connection = controllableSource('connecting')
    const workspaces = controllableSource({ phase: 'pending' })
    const sessions = controllableSource(undefined)
    ctx.reflect.provide('connection', { state: connection })
    ctx.reflect.provide('workspaces', { list: workspaces })
    ctx.reflect.provide('sessions', { list: sessions })

    let settled = false
    const waiting = awaitDataReady(ctx).then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    sessions.set({ phase: 'ready' })
    await Promise.resolve()
    expect(settled).toBe(false)
    workspaces.set({ phase: 'ready' })
    await Promise.resolve()
    expect(settled).toBe(false)
    connection.set('connected')
    await waiting
    expect(settled).toBe(true)
  })

  it('releases a stuck Host after the timeout', async () => {
    const ctx = new Context()
    ctx.reflect.provide('sessions', { list: controllableSource({ phase: 'pending' }) })
    await awaitDataReady(ctx, 20)
  })
})
