/**
 * Behavior tests for `@deepseek-ai/dsh-shell-search`: shim-wrapper rendering,
 * `PATH` discovery, backend resolution precedence, the generated
 * translator's fail-open table executed for real against the vendored
 * ripgrep binary and the host GNU grep, and the plugin's effect-scoped
 * ownership of the shim directory, `PATH`, and `DSH_SEARCH_BIN`.
 */

import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import * as ShellEnvPlugin from '@deepseek-ai/dsh-shell-env'
import * as ShellSearchPlugin from '@deepseek-ai/dsh-shell-search'
import { findExecutable, findHostGrep, MODE_FLAG, NODE_BIN, RG_DEFAULTS, SHIM_NAMES, renderShim, renderShims, renderTranslator } from '@deepseek-ai/dsh-shell-search/src/shims.ts'

function execution(): ToolExecution {
  return {
    signal: new AbortController().signal,
    token: Symbol('shell-search-test') as ToolExecution['token'],
    callId: ToolCallId('shell-search-call'),
    rootCallId: ToolCallId('shell-search-call'),
    name: 'bash',
    arguments: { command: 'grep x' },
  }
}

let sandbox: string
let fixture: string
let hostGrep: string
let vendoredRg: string

beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'dsh-shs-'))
  fixture = join(sandbox, 'fixture')
  mkdirSync(join(fixture, 'src'), { recursive: true })
  mkdirSync(join(fixture, 'junk'), { recursive: true })
  mkdirSync(join(fixture, '.hidden'), { recursive: true })
  writeFileSync(join(fixture, 'src', 'a.ts'), 'const needleTs = 1\n')
  writeFileSync(join(fixture, 'src', 'b.txt'), 'needle in txt\n')
  writeFileSync(join(fixture, 'junk', 'j.txt'), 'needle in junk\n')
  writeFileSync(join(fixture, '.hidden', 'h.txt'), 'needle hidden\n')
  writeFileSync(join(fixture, '.gitignore'), 'junk/\n')
  writeFileSync(join(fixture, '.ignore'), 'junk/\n')
  writeFileSync(join(fixture, 'longline.txt'), `needle ${'x'.repeat(900)}\n`)
  writeFileSync(join(fixture, 'src', 'pair.txt'), 'aa\nab\n')
  hostGrep = findHostGrep() as string
  vendoredRg = ShellSearchPlugin.resolveRg(undefined, sandbox) as string
  expect(hostGrep).toBeDefined()
  expect(vendoredRg).toBeDefined()
})

afterAll(async () => {
  await rm(sandbox, { recursive: true, force: true })
})

afterEach(() => vi.unstubAllEnvs())

function stubPlatform(value: string): () => void {
  const original = Object.getOwnPropertyDescriptor(process, 'platform') as PropertyDescriptor
  Object.defineProperty(process, 'platform', { value, configurable: true })
  return () => Object.defineProperty(process, 'platform', original)
}

describe('findHostGrep', () => {
  it('skips overlay shim directories and unwalkable entries', () => {
    const binDir = join(sandbox, 'hbin')
    const shimLike = join(sandbox, 'old-shell-search', 'bin')
    mkdirSync(binDir, { recursive: true })
    mkdirSync(shimLike, { recursive: true })
    for (const dir of [binDir, shimLike]) {
      writeFileSync(join(dir, 'grep'), '#!/bin/sh\nexit 0\n')
      chmodSync(join(dir, 'grep'), 0o755)
    }
    vi.stubEnv('PATH', `${shimLike}:/definitely-absent:${binDir}`)
    expect(findHostGrep()).toBe(join(binDir, 'grep'))
    expect(findHostGrep(binDir)).toBeUndefined()
    vi.stubEnv('PATH', undefined)
    expect(findHostGrep()).toBeUndefined()
  })
})

describe('findExecutable', () => {
  it('finds an executable on PATH, skipping empties and the named directory', () => {
    const binDir = join(sandbox, 'bin')
    mkdirSync(binDir, { recursive: true })
    const toy = join(binDir, 'toy')
    writeFileSync(toy, '#!/bin/sh\nexit 0\n')
    chmodSync(toy, 0o755)
    vi.stubEnv('PATH', `::${binDir}:/definitely-absent`)
    expect(findExecutable('toy')).toBe(toy)
    expect(findExecutable('toy', binDir)).toBeUndefined()
    expect(findExecutable('no-such-toy')).toBeUndefined()
    vi.stubEnv('PATH', undefined)
    expect(findExecutable('toy')).toBeUndefined()
  })
})

describe('shim rendering', () => {
  it('renders ripgrep-mode wrappers only for the rg-compatible dialects', () => {
    const shims = renderShims({ rg: '/x/rg', hostGrep: '/x/grep' }, '/x/translate.mjs')
    expect([...Object.keys(shims)].toSorted()).toEqual([...SHIM_NAMES].toSorted())
    expect(shims.grep).toContain('exec \'/x/grep\' "$@"')
    expect(shims.grep).not.toContain('translate')
    for (const shimName of ['egrep', 'fgrep'] as const) {
      expect(shims[shimName]).toContain(`exec '${NODE_BIN}' '/x/translate.mjs' '${MODE_FLAG[shimName]}' '/x/rg' '/x/grep' "$@"`)
    }
  })

  it('renders a verbatim host-grep wrapper when no ripgrep backend exists', () => {
    for (const shimName of SHIM_NAMES) {
      const text = renderShim(shimName, { hostGrep: '/x/grep' }, '/x/translate.mjs')
      expect(text).toContain('exec \'/x/grep\' "$@"')
      expect(text).not.toContain('translate')
    }
  })

  it('renders the translator with the fixed ripgrep defaults', () => {
    const source = renderTranslator()
    for (const flag of RG_DEFAULTS) expect(source).toContain(flag)
    expect(source).toContain('process.exit(')
  })
})

describe('generated translator behavior', () => {
  let wrapper: string
  let runNoRg: (args: string[]) => ReturnType<typeof spawnSync>

  beforeAll(() => {
    const translatePath = join(sandbox, 'translate.mjs')
    writeFileSync(translatePath, renderTranslator())
    wrapper = join(sandbox, 'grep-shim')
    writeFileSync(wrapper, `#!/bin/sh\nexec '${NODE_BIN}' '${translatePath}' '' '${vendoredRg}' '${hostGrep}' "$@"\n`)
    chmodSync(wrapper, 0o755)
    const absentRg = join(sandbox, 'grep-shim-norg')
    writeFileSync(absentRg, `#!/bin/sh\nexec '${NODE_BIN}' '${translatePath}' '-F' '/no-such-rg-binary' '${hostGrep}' "$@"\n`)
    chmodSync(absentRg, 0o755)
    runNoRg = (args: string[]) => spawnSync('sh', [absentRg, ...args], { cwd: fixture, encoding: 'utf8' })
  })

  const run = (args: string[]) => spawnSync('sh', [wrapper, ...args], { cwd: fixture, encoding: 'utf8' })

  it('naive recursive search mirrors grep traversal over hidden and ignored files', () => {
    const out = run(['-rn', 'needle', '.'])
    expect(out.stdout).toContain('src/a.ts')
    expect(out.stdout).toContain('.hidden/h.txt')
    expect(out.stdout).toContain('junk/j.txt')
  })

  it('truncates long matched lines instead of flooding', () => {
    expect(run(['-n', 'needle', 'longline.txt']).stdout).toContain('[Omitted long matching line]')
  })

  it('translates include and exclude globs', () => {
    const included = run(['-rn', '--include=*.ts', 'needle', '.'])
    expect(included.stdout).toContain('a.ts')
    expect(included.stdout).not.toContain('b.txt')
    const excluded = run(['-rn', '--exclude-dir=src', 'needle', '.'])
    expect(excluded.stdout).not.toContain('a.ts')
    expect(excluded.stdout).toContain('h.txt')
  })

  it('passes value flags through in both spellings', () => {
    expect(run(['-m', '1', '-n', 'needle', 'src/a.ts', 'src/b.txt']).stdout.match(/needle/g)).toHaveLength(2)
    expect(run(['-m1', '-n', 'needle', 'src/a.ts', 'src/b.txt']).stdout.match(/needle/g)).toHaveLength(2)
    expect(run(['-C', '1', 'needleTs', 'src/a.ts']).stdout).toContain('const needleTs = 1')
    expect(run(['-e', 'needleTs', 'src/a.ts']).status).toBe(0)
  })

  it('fails open on GNU-valid flags outside the table with GNU semantics', () => {
    const open = run(['--color=never', 'needle', 'src/a.ts'])
    expect(open.stdout).toContain('const needleTs = 1')
    expect(open.status).toBe(0)
    const rejected = run(['--unicorn=1', 'needle', 'src/a.ts'])
    expect(rejected.status).toBe(2)
  })

  it('fails open when a value flag lacks its value, mirroring GNU errors', () => {
    expect(run(['-m']).status).toBe(2)
    expect(run(['-e']).status).toBe(2)
    expect(run(['-d']).status).toBe(2)
  })

  it('keeps GNU exit codes through the translator', () => {
    expect(run(['needle', 'src/a.ts']).status).toBe(0)
    expect(run(['absent-token', 'src/a.ts']).status).toBe(1)
    expect(run(['[', 'src/a.ts']).status).toBe(2)
  })

  it('fails open on a bare directory operand, mirroring GNU grep', () => {
    const open = run(['needle', 'src'])
    expect(open.status).toBe(2)
    expect(open.stderr).toContain('Is a directory')
    const rec = run(['-rn', 'needle', 'src'])
    expect(rec.stdout).toContain('a.ts')
  })

  it('re-runs under GNU grep -E when ripgrep rejects the pattern', () => {
    const out = run(['(a)\\1', 'src/pair.txt'])
    expect(out.status).toBe(0)
    expect(out.stdout).toContain('aa')
  })

  it('re-runs under GNU when the ripgrep binary fails to spawn', () => {
    const out = runNoRg(['-Fn', 'needle', 'src/b.txt'])
    expect(out.status).toBe(0)
    expect(out.stdout).toContain('needle in txt')
  })
})

describe('backend resolution', () => {
  it('validates a configured rg path and fails loud when not executable', () => {
    const ghost = join(sandbox, 'ghost-rg')
    expect(() => ShellSearchPlugin.resolveRg(ghost, sandbox)).toThrow(/not executable/)
    writeFileSync(ghost, '#!/bin/sh\nexit 0\n')
    chmodSync(ghost, 0o755)
    expect(ShellSearchPlugin.resolveRg(ghost, sandbox)).toBe(ghost)
  })

  it('resolves the vendored platform-package binary by default on this platform', () => {
    expect(vendoredRg).toContain('@vscode+ripgrep')
    expect(statSync(vendoredRg).mode & 0o111).not.toBe(0)
  })

  it('finds rg on PATH when the platform package is unknown', () => {
    const binDir = join(sandbox, 'rgbin')
    mkdirSync(binDir, { recursive: true })
    const fakeRg = join(binDir, 'rg')
    writeFileSync(fakeRg, '#!/bin/sh\nexit 0\n')
    chmodSync(fakeRg, 0o755)
    vi.stubEnv('PATH', binDir)
    const restore = stubPlatform('sunos')
    try {
      expect(ShellSearchPlugin.resolveRg(undefined, join(sandbox, 'skip'))).toBe(fakeRg)
    } finally {
      restore()
    }
  })

  it('resolves the backend with and without a ripgrep tier', () => {
    expect(ShellSearchPlugin.resolveBackend(undefined, join(sandbox, 'nobin'))).toEqual({ hostGrep, rg: vendoredRg })

    const binDir = join(sandbox, 'greponly')
    mkdirSync(binDir, { recursive: true })
    const fakeGrep = join(binDir, 'grep')
    writeFileSync(fakeGrep, '#!/bin/sh\nexit 0\n')
    chmodSync(fakeGrep, 0o755)
    vi.stubEnv('PATH', binDir)
    const restore = stubPlatform('sunos')
    try {
      expect(ShellSearchPlugin.resolveBackend(undefined, sandbox)).toEqual({ hostGrep: fakeGrep })
      rmSync(fakeGrep)
      expect(() => ShellSearchPlugin.resolveBackend(undefined, sandbox)).toThrow(/no host grep/)
    } finally {
      restore()
    }
  })
})

describe('plugin lifecycle', () => {
  it('generates shims, prepends PATH, exposes DSH_SEARCH_BIN, and disposes all three', async () => {
    const home = join(sandbox, 'home')
    const ctx = new Context()
    await ctx.plugin(ShellEnvPlugin, { dshHome: home })
    const priorPath = process.env.PATH
    const fiber = await ctx.plugin(ShellSearchPlugin, { dshHome: home })
    const binDir = join(resolve(home), 'shell-search', 'bin')

    expect(process.env.PATH?.startsWith(`${binDir}:`)).toBe(true)
    for (const shimName of SHIM_NAMES) {
      expect(statSync(join(binDir, shimName)).mode & 0o111).not.toBe(0)
    }
    expect(readShim(binDir, 'grep')).toContain(`exec '${hostGrep}' "$@"`)
    expect(readShim(binDir, 'grep')).not.toContain('translate')
    expect(readShim(binDir, 'egrep')).toContain('translate.mjs')
    expect(existsSync(join(resolve(home), 'shell-search', 'translate.mjs'))).toBe(true)
    expect(ctx.shellEnv.list().map(entry => entry.key)).toContain('DSH_SEARCH_BIN')
    const collected = ctx.shellEnv.collect(execution())
    expect(collected.DSH_SEARCH_BIN).toBe(binDir)

    await fiber.dispose()
    expect(process.env.PATH).toBe(priorPath)
    expect(existsSync(join(resolve(home), 'shell-search'))).toBe(false)
    expect(ctx.shellEnv.list()).toEqual([])
  })

  it('skips the PATH prepend on win32 while still generating shims', async () => {
    const home = join(sandbox, 'home-win')
    const ctx = new Context()
    await ctx.plugin(ShellEnvPlugin, { dshHome: home })
    const restore = stubPlatform('win32')
    const priorPath = process.env.PATH
    try {
      const fiber = await ctx.plugin(ShellSearchPlugin, { dshHome: home })
      expect(process.env.PATH).toBe(priorPath)
      expect(existsSync(join(resolve(home), 'shell-search', 'bin', 'grep'))).toBe(true)
      await fiber.dispose()
    } finally {
      restore()
    }
  })

  it('fails boot loud on a non-executable configured rg', async () => {
    const home = join(sandbox, 'home-bad')
    const ctx = new Context()
    await ctx.plugin(ShellEnvPlugin, { dshHome: home })
    await expect(ctx.plugin(ShellSearchPlugin, { dshHome: home, rg: join(sandbox, 'ghost-2') })).rejects.toThrow(/not executable/)
  })
})

import { readFileSync } from 'node:fs'

function readShim(binDir: string, shimName: string): string {
  return readFileSync(join(binDir, shimName), 'utf8')
}
