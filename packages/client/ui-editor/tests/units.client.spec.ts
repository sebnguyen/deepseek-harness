/**
 * The stateless halves: every failure code maps to its line, and language
 * selection answers for the shipped names, suffixes, and interpreters (the
 * recognition rules themselves belong to the languages spec). */
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { describe, expect, it } from 'vitest'
import { createEditorExtensions, editorHighlight, editorTheme, isMarkdownPath, languageFor, saveCommand } from '../src/client/editor.ts'
import { en } from '../src/client/locales.ts'
import { decodeText, failureLine, sessionFileOf } from '../src/client/rpc.ts'

// The spec's translate backs the same `editor` namespace the framework would
// bind, plus the common-vocabulary miss the bound seat falls through to.
const t: TranslateNS<'editor'> = (key, params) => {
  const line = (en as Record<string, string>)[key]
  if (line === undefined || params === undefined) return line ?? key
  return line.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match)
}

describe('failureLine', () => {
  it('maps every named code and falls back to the carrier message', () => {
    const failure = (code: string) => ({ code, message: 'carrier text', details: {} } as never)
    expect(failureLine(t, failure('workspace-file/not-found'))).toBe(en['error.notFound'])
    expect(failureLine(t, failure('workspace-file/too-large'))).toBe(en['error.tooLarge'])
    expect(failureLine(t, failure('workspace-file/read-only'))).toBe(en['error.readOnly'])
    expect(failureLine(t, failure('workspace-file/stale'))).toBe(en['error.stale'])
    expect(failureLine(t, failure('gateway/gone'))).toBe(en['error.generic'].replace('{message}', 'carrier text'))
  })
})

describe('decodeText', () => {
  it('decodes base64 bodies as UTF-8', () => {
    expect(decodeText({ data: btoa('hello') } as never)).toBe('hello')
  })
})

describe('sessionFileOf', () => {
  it('decodes session addresses only', () => {
    expect(sessionFileOf('dsh-resource://file/session/s-1/a/b.txt')).toEqual({ sessionId: 's-1', path: 'a/b.txt' })
    expect(() => sessionFileOf('dsh-resource://file/absolute/a.txt')).toThrow()
  })
})

describe('languageFor', () => {
  it('chooses a grammar for every shipped name and none for the rest', () => {
    expect(languageFor('a/b.ts')).toBeDefined()
    expect(languageFor('b.tsx')).toBeDefined()
    expect(languageFor('c.js')).toBeDefined()
    expect(languageFor('c.jsx')).toBeDefined()
    expect(languageFor('d.mjs')).toBeDefined()
    expect(languageFor('e.cjs')).toBeDefined()
    expect(languageFor('f.json')).toBeDefined()
    expect(languageFor('f.jsonc')).toBeDefined()
    expect(languageFor('g.md')).toBeDefined()
    expect(languageFor('g.markdown')).toBeDefined()
    expect(languageFor('h.py')).toBeDefined()
    expect(languageFor('i.go')).toBeDefined()
    expect(languageFor('j.rs')).toBeDefined()
    expect(languageFor('l.yaml')).toBeDefined()
    expect(languageFor('m.yml')).toBeDefined()
    expect(languageFor('n.css')).toBeDefined()
    expect(languageFor('o.html')).toBeDefined()
    expect(languageFor('README')).toBeDefined()
    expect(languageFor('deploy', '#!/usr/bin/env python3')).toBeDefined()
    expect(languageFor('no-dot-or-unknown')).toBeUndefined()
    expect(languageFor('.bashrc')).toBeUndefined()
    expect(languageFor('x/unknown.zzz')).toBeUndefined()
  })
})

describe('isMarkdownPath', () => {
  it('claims exactly the Markdown suffixes', () => {
    expect(isMarkdownPath('a/b.md')).toBe(true)
    expect(isMarkdownPath('b.MARKDOWN')).toBe(true)
    expect(isMarkdownPath('c.txt')).toBe(false)
    expect(isMarkdownPath('md')).toBe(false)
  })
})

describe('createEditorExtensions', () => {
  it('extends the base with or without a grammar', () => {
    expect(createEditorExtensions(() => {})).toHaveLength(6)
    expect(createEditorExtensions(() => {}, languageFor('a.ts'))).toHaveLength(7)
  })
})

describe('editorTheme and editorHighlight', () => {
  it('build one extension each', () => {
    expect(editorTheme()).toBeDefined()
    expect(editorHighlight()).toBeDefined()
  })
})

describe('saveCommand', () => {
  it('runs save and always handles the key', () => {
    let saved = 0
    expect(saveCommand(() => { saved += 1 })()).toBe(true)
    expect(saved).toBe(1)
  })
})
