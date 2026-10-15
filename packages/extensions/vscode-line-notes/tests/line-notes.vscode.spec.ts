/** The line-notes plane skeleton: inject contract and a mountable apply. */

import { describe, expect, it } from 'vitest'
import { apply, inject } from '../src/vscode/index.ts'

describe('vscode-line-notes plane', () => {
  it('declares its seat services by inject list', () => {
    expect(inject).toEqual(['vscodeApi', 'remote.lineNotes'])
  })

  it('mounts without a vscode workbench in front of it', () => {
    expect(() => apply({} as never)).not.toThrow()
  })
})
