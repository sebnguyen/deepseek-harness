/**
 * The language registry: what each shipped language claims, the order
 * recognition runs in, and the conflicts a contribution can trip.
 */
import type { Extension } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { BUILTIN_LANGUAGES, createLanguageRegistry } from '../src/client/languages/index.ts'
import { extensionOf, fileNameOf } from '../src/client/languages/path.ts'
import { LanguageRegistry, type LanguageContribution } from '../src/client/languages/registry.ts'
import { shebangInterpreter } from '../src/client/languages/shebang.ts'

/** A stand-in grammar: these specs exercise recognition, not parsing. */
const grammar = {} as Extension

/** One contribution claiming `.stub`, for conflict, disposal, and ordering specs. */
function stub(id: string, overrides: Partial<LanguageContribution> = {}): LanguageContribution {
  return { id, extensions: ['.stub'], load: () => grammar, ...overrides }
}

describe('BUILTIN_LANGUAGES', () => {
  it('loads every claimed name and covers the shipped ids', () => {
    for (const language of BUILTIN_LANGUAGES) {
      for (const extension of language.extensions) {
        expect(language.load(`a/b/name${extension}`), language.id).toBeDefined()
      }
      for (const name of language.filenames ?? []) {
        expect(language.load(`a/b/${name}`), language.id).toBeDefined()
      }
    }
    expect(BUILTIN_LANGUAGES.map(language => language.id)).toEqual([
      'css', 'go', 'html', 'javascript', 'json', 'markdown', 'python', 'rust', 'yaml',
    ])
  })
})

describe('LanguageRegistry.resolve', () => {
  const languages = createLanguageRegistry()

  it('resolves every shipped suffix', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['a/b.ts', 'javascript'],
      ['b.tsx', 'javascript'],
      ['c.mts', 'javascript'],
      ['d.cts', 'javascript'],
      ['e.js', 'javascript'],
      ['f.mjs', 'javascript'],
      ['g.cjs', 'javascript'],
      ['h.jsx', 'javascript'],
      ['i.json', 'json'],
      ['j.jsonc', 'json'],
      ['k.md', 'markdown'],
      ['l.markdown', 'markdown'],
      ['m.py', 'python'],
      ['n.go', 'go'],
      ['o.rs', 'rust'],
      ['p.yaml', 'yaml'],
      ['q.yml', 'yaml'],
      ['r.css', 'css'],
      ['s.html', 'html'],
      ['t.htm', 'html'],
    ]
    for (const [path, id] of cases) expect(languages.resolve(path)?.id, path).toBe(id)
  })

  it('matches suffixes case-insensitively, on either separator', () => {
    expect(languages.resolve('A/B/File.TS')?.id).toBe('javascript')
    expect(languages.resolve('C:\\work\\main.Go')?.id).toBe('go')
  })

  it('claims the suffixless prose names by hand', () => {
    expect(languages.resolve('README')?.id).toBe('markdown')
    expect(languages.resolve('/repo/LICENSE')?.id).toBe('markdown')
    expect(languages.resolve('ChangeLog')?.id).toBe('markdown')
    expect(languages.resolve('.bashrc')).toBeUndefined()
  })

  it('leaves unclaimed paths to plain text', () => {
    expect(languages.resolve('no-dot')).toBeUndefined()
    expect(languages.resolve('a.zzz')).toBeUndefined()
    expect(languages.resolve('')).toBeUndefined()
    expect(languages.resolve('a.zzz', 'plain text')).toBeUndefined()
  })

  it('prefers the longest suffix a contribution claims', () => {
    const custom = new LanguageRegistry()
    custom.register(stub('outer'))
    custom.register(stub('inner', { extensions: ['.stub.d'] }))
    expect(custom.resolve('a.stub.d')?.id).toBe('inner')
    expect(custom.resolve('a.stub')?.id).toBe('outer')
  })

  it('reads the interpreter from the buffer only after names and suffixes', () => {
    expect(languages.resolve('tool', '#!/usr/bin/env python3')?.id).toBe('python')
    expect(languages.resolve('cli', '#! /usr/bin/env node')?.id).toBe('javascript')
    expect(languages.resolve('a.zzz', '#!/usr/bin/env python3')?.id).toBe('python')
    expect(languages.resolve('a.py', '#!/usr/bin/env node')?.id).toBe('python')
    expect(languages.resolve('script', '#!/usr/bin/env ruby')?.id).toBeUndefined()
  })
})

describe('LanguageRegistry.register', () => {
  it('refuses a repeated id, extension, or file name', () => {
    const registry = new LanguageRegistry()
    registry.register(stub('one'))
    registry.register(stub('two', { extensions: ['.x'], filenames: ['named'] }))
    expect(() => registry.register(stub('one', { extensions: ['.y'] }))).toThrow(/already registered/)
    expect(() => registry.register(stub('three'))).toThrow(/already claimed/)
    expect(() => registry.register(stub('four', { extensions: ['.a', '.a'] }))).toThrow(/repeated extension/)
    expect(() => registry.register(stub('five', { extensions: ['.b'], filenames: ['named'] }))).toThrow(/already claimed/)
    expect(() => registry.register(stub('six', { extensions: ['.c'], filenames: ['dup', 'dup'] }))).toThrow(/repeated file name/)
  })

  it('rejects keys that could never match a lowercased path', () => {
    const registry = new LanguageRegistry()
    expect(() => registry.register(stub('bare', { extensions: ['stub'] }))).toThrow(/malformed extension/)
    expect(() => registry.register(stub('shout', { extensions: ['.STUB'] }))).toThrow(/malformed extension/)
    expect(() => registry.register(stub('empty', { extensions: ['.ok'], filenames: [''] }))).toThrow(/malformed file name/)
    expect(() => registry.register(stub('title', { extensions: ['.ok2'], filenames: ['README'] }))).toThrow(/malformed file name/)
  })

  it('reserves nothing when a registration fails', () => {
    const registry = new LanguageRegistry()
    registry.register(stub('one'))
    expect(() => registry.register(stub('two', { extensions: ['.free', '.stub'] }))).toThrow(/already claimed/)
    expect(registry.resolve('a.stub')?.id).toBe('one')
    expect(registry.resolve('a.free')).toBeUndefined()
    const dispose = registry.register(stub('two', { extensions: ['.free'] }))
    expect(registry.resolve('a.free')?.id).toBe('two')
    dispose()
    expect(registry.resolve('a.free')).toBeUndefined()
  })

  it('releases every claimed key on disposal, once', () => {
    const registry = new LanguageRegistry()
    const first = registry.register(stub('first', { filenames: ['named'] }))
    expect(registry.resolve('a.stub')?.id).toBe('first')
    expect(registry.resolve('named')?.id).toBe('first')
    first()
    expect(registry.resolve('a.stub')).toBeUndefined()
    expect(registry.resolve('named')).toBeUndefined()
    const second = registry.register(stub('second', { filenames: ['named'] }))
    const redo = registry.register(stub('first', { extensions: ['.again'] }))
    first()
    expect(registry.resolve('a.stub')?.id).toBe('second')
    expect(registry.resolve('named')?.id).toBe('second')
    expect(registry.resolve('a.again')?.id).toBe('first')
    redo()
    second()
  })
})

describe('path helpers', () => {
  it('reads the last segment and its suffix', () => {
    expect(fileNameOf('a/b/c.ts')).toBe('c.ts')
    expect(fileNameOf('c.ts')).toBe('c.ts')
    expect(fileNameOf('a\\b\\c.ts')).toBe('c.ts')
    expect(extensionOf('a/b/NAME.TS')).toBe('.ts')
    expect(extensionOf('.bashrc')).toBe('')
    expect(extensionOf('no-dot')).toBe('')
  })
})

describe('shebangInterpreter', () => {
  it('names the interpreter on a shebang line', () => {
    expect(shebangInterpreter('#!/bin/sh')).toBe('sh')
    expect(shebangInterpreter('#! /usr/bin/env bash')).toBe('bash')
    expect(shebangInterpreter('#!/usr/bin/env -S python3 -u')).toBe('python3')
    expect(shebangInterpreter('#!/usr/bin/env FOO=bar node')).toBe('node')
    expect(shebangInterpreter('\uFEFF#!/bin/zsh')).toBe('zsh')
  })

  it('returns nothing when the line names no interpreter', () => {
    expect(shebangInterpreter('not a shebang')).toBeUndefined()
    expect(shebangInterpreter('#!')).toBeUndefined()
    expect(shebangInterpreter('#!/usr/bin/env')).toBeUndefined()
    expect(shebangInterpreter('#!/usr/bin/env -i')).toBeUndefined()
  })
})
