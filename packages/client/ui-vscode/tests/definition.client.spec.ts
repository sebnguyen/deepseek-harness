/** The definition's degrade contract, read straight off canOpen. */
import { describe, expect, it } from 'vitest'
import { VSCODE_ID, VSCODE_KIND, vscodeDefinition } from '../src/client/definition.ts'
import { sessionFileOf } from '../src/client/rpc.ts'

const ADDR = 'dsh-resource://file/session/s1/packages/host/ide/src/index.ts'

describe('vscode tab definition', () => {
  it('claims session file addresses only while readiness holds', () => {
    let ready = false
    const definition = vscodeDefinition(() => ready)
    expect(definition.id).toBe(VSCODE_ID)
    expect(definition.kind).toBe(VSCODE_KIND)
    expect(definition.priority).toBe('builtin')
    expect(definition.canOpen?.(ADDR)).toBe(false)
    ready = true
    expect(definition.canOpen?.(ADDR)).toBe(true)
    expect(definition.canOpen?.('dsh-resource://doc/session/s1/x')).toBe(false)
    expect(definition.title?.('dsh-resource://file/session/s1/a%20b.ts')).toBe('a b.ts')
    expect(definition.title?.('dsh-resource://file/session/s1/')).toBe('dsh-resource://file/session/s1/')
    expect(definition.title?.('dsh-resource://file/session/s1/a%zz.ts')).toBe('a%zz.ts')
  })

  it('decodes the addressed session file and rejects anything else', () => {
    expect(sessionFileOf(ADDR)).toEqual({ sessionId: 's1', path: 'packages/host/ide/src/index.ts' })
    expect(() => sessionFileOf('https://example.com/x')).toThrow('not a session file address')
  })
})
