/**
 * Generic layout-mode host. `ui-layout` owns the single `layout.mode` seat and
 * knows nothing about mode ids or switching. This package owns the mutable
 * mode state, the one-time chooser, the keyed `layout.mode.entry` roster, and
 * the list roster of choice cards. Feature plugins register one entry in each
 * roster; the host selects the entry by the pinned mode key.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { LayoutModeInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { LayoutModeHostInjected, LayoutModeService } from './contract.ts'
import { DefaultOption } from './DefaultOption.tsx'
import { ModeHost } from './ModeHost.tsx'
import { en, zh, type LayoutModeKey } from './locales.ts'

export type {
  LayoutModeEntryOwnerProps, LayoutModeHostInjected, LayoutModeOptionOwnerProps, LayoutModeService,
} from './contract.ts'
export type { LayoutModeKey } from './locales.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Global shell-mode control; the chooser writes it. */
    layoutMode: LayoutModeService
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Launch-chooser copy. */
    'layout-mode': LayoutModeKey
  }

  interface SlotMap {
    /** Keyed alternate shell screens, selected by the pinned mode id. */
    'layout.mode.entry': { kind: 'keyed'; scope: 'root'; owner: import('./contract.ts').LayoutModeEntryOwnerProps }
    /** Ordered choice cards rendered by the launch chooser. */
    'layout.mode.option': { kind: 'list'; scope: 'root'; owner: import('./contract.ts').LayoutModeOptionOwnerProps }
  }
}

/** Services required by the generic mode host. */
export const inject = ['slots', 'locale']

const NS = 'layout-mode'

/** Register the host, both rosters, and the immutable mode state. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-layout-mode: dictionaries')

  ctx.effect(() => {
    const store = createSnapshotStore<LayoutModeInfo>({ phase: 'choosing', mode: 'default' })
    const service: LayoutModeService = {
      info: store,
      select: (mode) => {
        const state = store.getSnapshot()
        if (state.phase === 'active') return
        if (mode !== 'default'
          && !ctx.slots.entries('layout.mode.entry').some(entry => entry.options.key === mode)) return
        store.set({ phase: 'active', mode })
      },
    }
    const disposeModeInfo = ctx.slots.provideRoot({ hooks: { layoutMode: store } })
    const disposeService = ctx.reflect.provide('layoutMode', service)
    const disposeHost = ctx.slots.inject('layout.mode', () => ctx.slots.register({
      name: 'layout.mode',
      children: {
        'layout.mode.entry': { kind: 'keyed', scope: 'root' },
        'layout.mode.option': { kind: 'list', scope: 'root' },
      },
      inject: (): LayoutModeHostInjected => ({ choose: service.select }),
      locale: NS,
    }, ModeHost))
    const disposeDefaultOption = ctx.slots.inject('layout.mode.option', () => ctx.slots.register({
      name: 'layout.mode.option',
      id: 'default',
      order: -10,
      locale: NS,
    }, DefaultOption))
    const disposeModes = ctx.slots.subscribe('layout.mode.entry', () => {
      const state = store.getSnapshot()
      if (state.phase !== 'active' || state.mode === 'default') return
      if (ctx.slots.entries('layout.mode.entry').some(entry => entry.options.key === state.mode)) return
      store.set({ phase: 'active', mode: 'default' })
    })
    return () => {
      disposeDefaultOption()
      disposeModes()
      disposeHost()
      void disposeService()
      disposeModeInfo()
    }
  }, 'ui-layout-mode: state, host, rosters')
}
