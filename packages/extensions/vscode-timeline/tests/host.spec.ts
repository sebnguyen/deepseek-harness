import { describe, expect, it } from 'vitest'
import { apply, inject } from '../src/index.ts'

describe('vscode-timeline host face', () => {
  it('declares no host services', () => {
    expect(inject).toEqual([])
    expect(apply()).toBeUndefined()
  })
})
