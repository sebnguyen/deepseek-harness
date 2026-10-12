import { describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { apply as hostApply } from '../src/index.ts'
import { apply as clientApply } from '../src/client/index.ts'
import { VSCODE_ID, VSCODE_KIND, vscodeDefinition } from '../src/client/definition.ts'
import { basenameOf } from '../src/client/name.ts'

describe('host half', () => {
  it('contributes nothing to the host tree', () => {
    expect(() => { hostApply() }).not.toThrow()
  })
})

describe('vscodeDefinition', () => {
  it('claims session-scoped file addresses at the extension band', () => {
    const def = vscodeDefinition()
    expect(def.id).toBe(VSCODE_ID)
    expect(def.kind).toBe(VSCODE_KIND)
    expect(def.priority).toBe('extension')
    expect(def.canOpen?.('dsh-resource://file/session/s1/dir/f.ts')).toBe(true)
    expect(def.canOpen?.('dsh-resource://file/absolute/dir/f.ts')).toBe(false)
    expect(def.canOpen?.('sidebar://vscode')).toBe(false)
  })
})

describe('basenameOf', () => {
  it('shortens to the decoded last segment', () => {
    expect(basenameOf('dsh-resource://file/session/s1/dir/f.ts')).toBe('f.ts')
    expect(basenameOf('dsh-resource://file/session/s1/dir/caf%C3%A9.md')).toBe('café.md')
  })

  it('keeps the address raw when the last segment is empty or escapes badly', () => {
    expect(basenameOf('dsh-resource://file/session/s1/dir/')).toBe('dsh-resource://file/session/s1/dir/')
    expect(basenameOf('x/%zz')).toBe('%zz')
  })
})

describe('client apply', () => {
  interface SlotReg {
    readonly name: string
    readonly key: string
    readonly locale: string
    readonly inject: () => unknown
  }

  function fakeClient() {
    const seen: {
      def?: unknown
      locales?: unknown
      adopt?: (sessionId: string) => void
    } = {}
    const bodies: Record<string, unknown> = {}
    const injects: Record<string, () => unknown> = {}
    const status = vi.fn()
    const openTabIn = vi.fn()
    const ctx = {
      remote: { ideBridge: { status } },
      effect: (fn: () => unknown) => { fn(); return () => {} },
      sidebarRightTabs: { register: (def: unknown) => { seen.def = def; return () => {} } },
      locale: { register: (ns: string, dicts: unknown) => { seen.locales = { ns, dicts }; return () => {} } },
      slots: {
        inject: (seat: string, factory: () => unknown) => { injects[seat] = factory; return () => {} },
        register: (reg: SlotReg, body: unknown) => { bodies[reg.name] = body; return reg },
      },
      sidebarRight: {
        onSessionAdopted: (cb: (sessionId: string) => void) => { seen.adopt = cb; return () => {} },
        openTabIn,
      },
    }
    return { seen, bodies, injects, status, openTabIn, ctx: ctx as unknown as ClientContext }
  }

  it('registers the type, dictionaries, body seat, adoption hook, and the root-scoped float host', () => {
    const { seen, bodies, injects, status, openTabIn, ctx } = fakeClient()
    clientApply(ctx)
    expect(seen.def).toBeDefined()
    expect(seen.locales).toMatchObject({ ns: 'vscode' })

    // The seat factories register the tab body on the keyed seat and the
    // float host on the root-scoped shell overlay.
    const tabReg = injects['sidebar.right.pane.tab']?.() as SlotReg
    const overlayReg = injects['shell.overlay']?.() as SlotReg
    expect(tabReg.key).toBe(VSCODE_ID)
    expect(tabReg.locale).toBe('vscode')
    expect(bodies['sidebar.right.pane.tab']).toBeDefined()
    expect(overlayReg.name).toBe('shell.overlay')
    expect(bodies['shell.overlay']).toBeDefined()

    // The injected face delegates to the remote namespace.
    void (tabReg.inject() as { status: typeof status }).status('s1', new AbortController().signal)
    expect(status).toHaveBeenCalled()

    // Adoption auto-opens the twin tab, and a thrown claim loses quietly.
    seen.adopt?.('s1')
    expect(openTabIn).toHaveBeenCalledWith('s1', VSCODE_KIND)
    openTabIn.mockImplementation(() => { throw new Error('type not registered') })
    expect(() => { seen.adopt?.('s2') }).not.toThrow()
  })
})
