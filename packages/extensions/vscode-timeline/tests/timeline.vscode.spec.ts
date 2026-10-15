/** The timeline plane: mounts its checkpoint virtual-document provider via the seat's vscodeApi facade. */

import { describe, expect, it } from 'vitest'
import { apply, inject } from '../src/vscode/index.ts'

describe('vscode-timeline plane', () => {
  it('declares its seat services by inject list', () => {
    expect(inject).toEqual(['vscodeApi', 'remote.timeline'])
  })

  it('registers the dsh-checkpoint content provider on apply', () => {
    const registrations: Array<{ scheme: string; provider: object }> = []
    const ctx = {
      vscodeApi: {
        workspace: {
          registerTextDocumentContentProvider(scheme: string, provider: object): object {
            registrations.push({ scheme, provider })
            return provider
          },
        },
      },
    }
    apply(ctx as never)
    expect(registrations.map(registration => registration.scheme)).toEqual(['dsh-checkpoint'])
  })
})
