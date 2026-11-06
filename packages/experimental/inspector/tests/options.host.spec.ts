/** Deployment-facing Inspector option defaults and overrides. */

import { describe, expect, it } from 'vitest'
import { resolveInspectorOptions } from '../src/host/bridge/controller.ts'

describe('Inspector option resolution', () => {
  it('admits a complete rich Host and Client runtime within the default frame budget', () => {
    const defaults = resolveInspectorOptions()
    expect(defaults.maxSourceFrameBytes).toBe(1024 * 1024)
    expect(defaults.maxCordisNodes).toBe(2_048)
  })

  it('retains explicit smaller per-deployment limits', () => {
    expect(resolveInspectorOptions({ maxSourceFrameBytes: 256 * 1024 }).maxSourceFrameBytes)
      .toBe(256 * 1024)
    expect(() => resolveInspectorOptions({ maxSourceFrameBytes: 0 })).toThrow('must be a positive safe integer')
  })
})
