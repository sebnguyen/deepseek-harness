/** The vscode-manifest schema: accepts a declared row set and refuses malformed ones. */

import { describe, expect, it } from 'vitest'
import { VscodeManifestSchema } from '../src/manifest.ts'

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
