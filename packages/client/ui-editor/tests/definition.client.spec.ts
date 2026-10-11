/** The editor tab definition: its band, its claimable addresses, its titles. */
import { sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { describe, expect, it } from 'vitest'
import { basenameOf, editorDefinition, EDITOR_ID, EDITOR_KIND } from '../src/client/definition.ts'

describe('editorDefinition', () => {
  it('claims session file addresses at the builtin band', () => {
    const definition = editorDefinition()
    const canOpen = definition.canOpen
    if (canOpen === undefined) throw new Error('the editor type must vet addresses')
    expect(definition.id).toBe(EDITOR_ID)
    expect(definition.kind).toBe(EDITOR_KIND)
    expect(definition.priority).toBe('builtin')
    expect(definition.patterns).toEqual(['dsh-resource://file/**'])
    expect(canOpen(sessionFileAddress('s-1', 'a/b.txt'))).toBe(true)
    expect(canOpen('dsh-resource://file/absolute/a.txt')).toBe(false)
    expect(canOpen('not-an-address')).toBe(false)
  })
})

describe('basenameOf', () => {
  it('decodes the last path segment and falls back to the raw address', () => {
    expect(basenameOf('dsh-resource://file/session/s-1/dir/notes%20v2.md')).toBe('notes v2.md')
    expect(basenameOf('dsh-resource://file/session/s-1/')).toBe('dsh-resource://file/session/s-1/')
    expect(basenameOf('dsh-resource://file/session/s-1/%zz-bad.md')).toBe('%zz-bad.md')
  })
})
