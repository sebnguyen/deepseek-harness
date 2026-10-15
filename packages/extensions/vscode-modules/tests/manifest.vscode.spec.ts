/** The vscode-manifest schema: accepts a declared row set and refuses malformed ones. */

import { describe, expect, it } from 'vitest'
import { parseDshVscode, planeIdOf, VscodeManifestSchema } from '../src/manifest.ts'

const row = {
  id: 'dsh-vscode-timeline',
  name: '@deepseek-ai/dsh-vscode-timeline',
  rev: '4d2u',
  url: '/vscode/plugin/dsh-vscode-timeline',
  inject: ['vscodeApi', 'remote.timeline'],
  external: [],
  immediately: true,
} as const

describe('VscodeManifestSchema', () => {
  it('accepts a well-formed manifest', () => {
    expect(VscodeManifestSchema.parse({ rev: 'v1:deadbeef', plugins: [row] }))
      .toEqual({ rev: 'v1:deadbeef', plugins: [row] })
  })

  it('accepts the empty-typed declaration the registry emits before planes exist', () => {
    expect(VscodeManifestSchema.parse({ rev: 'empty', plugins: [] }))
      .toEqual({ rev: 'empty', plugins: [] })
  })

  it('refuses rows missing fields and non-array plugin lists', () => {
    const { immediately: _dropped, ...incomplete } = row
    expect(() => VscodeManifestSchema.parse({ rev: 'v1:x', plugins: [incomplete] })).toThrow()
    expect(() => VscodeManifestSchema.parse({ rev: 'v1:x', plugins: row })).toThrow()
    expect(() => VscodeManifestSchema.parse({ plugins: [] })).toThrow()
  })
})

describe('parseDshVscode', () => {
  it('parses a well-formed vscode face declaration', () => {
    expect(parseDshVscode('@deepseek-ai/dsh-vscode-timeline', {
      platform: 'vscode',
      inject: ['vscodeApi', 'remote.timeline'],
      immediately: true,
    })).toEqual({ platform: 'vscode', inject: ['vscodeApi', 'remote.timeline'], immediately: true })
  })

  it('is a negative verdict only when the field is absent', () => {
    expect(parseDshVscode('pkg', undefined)).toBeUndefined()
    expect(() => parseDshVscode('pkg', 'vscode')).toThrow(/non-object/)
    expect(() => parseDshVscode('pkg', { inject: 'vscodeApi' })).toThrow(/platform must be a string/)
    expect(() => parseDshVscode('pkg', { platform: 'vscode', inject: 'vscodeApi' })).toThrow(/string array/)
    expect(() => parseDshVscode('pkg', { platform: 'vscode', immediately: 1 })).toThrow(/boolean/)
  })

  it('never absorbs a dsh.client declaration through this parser', () => {
    expect(parseDshVscode('pkg', undefined)).toBeUndefined()
  })
})

describe('planeIdOf', () => {
  it('strips the harness scope prefix', () => {
    expect(planeIdOf('@deepseek-ai/dsh-vscode-timeline')).toBe('dsh-vscode-timeline')
    expect(planeIdOf('standalone-plane')).toBe('standalone-plane')
  })
})
