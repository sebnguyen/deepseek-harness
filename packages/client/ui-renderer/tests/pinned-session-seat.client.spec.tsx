// @vitest-environment jsdom
/**
 * The PinnedSessionProvider seat: session-scoped subtrees bound to a named
 * non-current binding while the ambient selection stays absent/elsewhere.
 */
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import {
  SlotCore, type PropsRenderSlots, type PinnedSessionProviderComponent, type SlotRendererHost,
  type SlotScopeAdapter, type ScopedStandardSourceBinding, type StandardSourceBinding,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { Context } from '@deepseek-ai/cordis'
import { createSlotRenderer } from '../src/client/scoped-slots.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'spec.pinned.body': { kind: 'single'; scope: 'session'; owner: object }
  }
}

type FrameSlots = PropsRenderSlots<'spec.pinned.body'> & {
  PinnedSessionProvider?: PinnedSessionProviderComponent | undefined
}

/** One per-key binding: the session id surfaces as the standard sessionId prop. */
function bindingFor(key: string): ScopedStandardSourceBinding {
  return { key, ctx: undefined as unknown as Context, hooks: {}, keyedHooks: {}, props: { sessionId: key } }
}

function hostOver(core: SlotCore, known: readonly string[]): SlotRendererHost {
  const absentBinding: StandardSourceBinding = { key: undefined, hooks: {}, keyedHooks: {}, props: {} }
  const source = {
    getSnapshot: () => absentBinding,
    subscribe: () => () => {},
  }
  const bindings = new Map<string, ScopedStandardSourceBinding>(known.map(key => [key, bindingFor(key)]))
  const sessionAdapter: SlotScopeAdapter = {
    current: source,
    resolve: key => bindings.get(key),
    renderArea: (_binding, { children }) => <>{children}</>,
  }
  return {
    subscribe: (key, fn) => core.subscribe(key, fn),
    getVersion: key => core.getVersion(key),
    entriesOf: key => core.entries(key),
    entriesOfSlot: key => core.entriesOfSlot(key),
    reportEntryError: (key, entry, error, info) => { core.reportEntryError(key, entry, error, info) },
    specOf: key => core.specDynamic(key),
    isLive: entry => core.isLive(entry),
    storeOf: () => undefined,
    root: source,
    scopeRevision: { getSnapshot: () => 0, subscribe: () => () => {} },
    scope: () => sessionAdapter,
  }
}

describe('PinnedSessionProvider seat', () => {
  it('binds a session subtree to the named binding while the current one is absent', () => {
    const core = new SlotCore()
    core.register({
      name: 'root',
      children: { 'spec.pinned.body': { kind: 'single', scope: 'session' } },
    }, (props: FrameSlots) => {
      const pin = props.PinnedSessionProvider
      if (pin === undefined) return null
      return (
        <>
          {pin({ sessionId: 'beta', children: props.renderSlot('spec.pinned.body', {}) })}
          {pin({ sessionId: 'missing', empty: () => <i>empty</i>, children: props.renderSlot('spec.pinned.body', {}) })}
        </>
      )
    })
    core.register({ name: 'spec.pinned.body' }, ({ sessionId }: { sessionId?: string }) => (
      <b>{sessionId}</b>
    ))
    const view = render(<>{createSlotRenderer().renderRoot(hostOver(core, ['beta']), {})}</>)
    expect(view.container.textContent).toBe('betaempty')
  })

  it('renders the empty branch when no empty body was given and nothing resolves', () => {
    const core = new SlotCore()
    core.register({
      name: 'root',
      children: { 'spec.pinned.body': { kind: 'single', scope: 'session' } },
    }, (props: FrameSlots) => {
      const pin = props.PinnedSessionProvider
      if (pin === undefined) return null
      return pin({ sessionId: 'gone', children: props.renderSlot('spec.pinned.body', {}) })
    })
    core.register({ name: 'spec.pinned.body' }, ({ sessionId }: { sessionId?: string }) => (
      <b>{sessionId}</b>
    ))
    const view = render(<>{createSlotRenderer().renderRoot(hostOver(core, []), {})}</>)
    expect(view.container.textContent).toBe('')
  })
})
