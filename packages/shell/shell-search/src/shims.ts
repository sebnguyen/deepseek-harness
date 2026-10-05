/**
 * Generators behind the shell-search shims: the POSIX wrapper scripts named
 * after the grep family, the generated Node translator source that maps GNU
 * grep argv onto ripgrep argv through the fail-open table, and `PATH`
 * discovery of fallback executables. All path-bearing values are baked into
 * the generated files at boot, so neither wrapper nor translator performs
 * discovery of its own at call time.
 *
 * @module @deepseek-ai/dsh-shell-search/shims
 */

import { accessSync, constants } from 'node:fs'
import { join } from 'node:path'

/** The command names the plugin shims, mirroring the GNU grep family. */
export const SHIM_NAMES = ['grep', 'egrep', 'fgrep'] as const

/** One shimmed command name. */
export type ShimName = (typeof SHIM_NAMES)[number]

/** The ripgrep regex-mode flag making each shim match its GNU name's dialect. */
export const MODE_FLAG: Record<ShimName, string> = { grep: '-G', egrep: '-E', fgrep: '-F' }

/** Fixed ripgrep defaults every translated invocation carries. */
export const RG_DEFAULTS = ['--hidden', '--sort=path', '--max-columns=500'] as const

/** Resolved binaries one shim generation targets. */
export interface ShimBackend {
  /** Absolute ripgrep binary the translators exec, when one is available. */
  rg?: string
  /** Absolute host GNU grep the shims fall back to. */
  hostGrep: string
}

/** Absolute path of the `node` executable the wrappers exec the translator with. */
export const NODE_BIN = process.execPath

/**
 * Locate the first executable file named `name` on the current `PATH`,
 * skipping empty entries and one caller-named directory (the shim directory
 * itself, which must never shadow discovery on re-boot).
 *
 * @param name - executable file name to look for.
 * @param skipDir - directory excluded from the search.
 * @returns the absolute executable path, or `undefined` when none is found.
 */
export function findExecutable(name: string, skipDir?: string): string | undefined {
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (dir === '' || dir === skipDir) continue
    const candidate = join(dir, name)
    try {
      accessSync(candidate, constants.X_OK)
    } catch {
      // ENOENT or EACCES: this PATH entry lacks the executable; the next entry decides.
      continue
    }
    return candidate
  }
  return undefined
}

/**
 * Render the wrapper script for one grep-family name. With a ripgrep backend
 * the wrapper execs the generated translator in the name's GNU compatibility
 * mode; without one the wrapper execs the host grep verbatim, keeping
 * byte-for-byte GNU semantics with no translator hop.
 *
 * @param shimName - the GNU command name the wrapper stands in for.
 * @param backend - the resolved binaries to embed.
 * @param translatePath - absolute path of the generated translator module.
 * @returns the complete wrapper script text.
 */
export function renderShim(shimName: ShimName, backend: ShimBackend, translatePath: string): string {
  const execLine = backend.rg === undefined
    ? `exec '${backend.hostGrep}' "$@"`
    : `exec '${NODE_BIN}' '${translatePath}' '${MODE_FLAG[shimName]}' '${backend.rg}' '${backend.hostGrep}' "$@"`
  return `#!/bin/sh\n# dsh-shell-search: ${shimName} shim, generated at boot and removed at plugin disposal.\n${execLine}\n`
}

/**
 * Render every grep-family wrapper for one generation.
 *
 * @param backend - the resolved binaries to embed.
 * @param translatePath - absolute path of the generated translator module.
 * @returns wrapper script text keyed by shimmed command name.
 */
export function renderShims(backend: ShimBackend, translatePath: string): Record<ShimName, string> {
  return {
    grep: renderShim('grep', backend, translatePath),
    egrep: renderShim('egrep', backend, translatePath),
    fgrep: renderShim('fgrep', backend, translatePath),
  }
}

/**
 * The generated Node translator source. It owns the fail-open table as
 * structured argv handling: a token outside the table, a value flag missing
 * its value, or a ripgrep binary absent at call time execs the host GNU grep
 * with the original argv, keeping script semantics byte-identical; a fully
 * translatable argv execs ripgrep with {@link RG_DEFAULTS}, the shim's mode
 * flag, and the translated tokens, passing stdio and the exit code through.
 *
 * @returns the complete translator module text.
 */
export function renderTranslator(): string {
  const defaults = [...RG_DEFAULTS].map(f => JSON.stringify(f)).join(', ')
  return `#!/usr/bin/env node
// dsh-shell-search translator, generated at boot and removed at plugin disposal.
// Maps GNU grep argv (argv[2..]) onto ripgrep argv; any token outside the
// fail-open table execs the host grep with the original argv, unchanged.
import { spawn } from 'node:child_process'

const [mode, rgPath, hostGrep, ...argv] = process.argv.slice(2)
const out = [${defaults}]
if (mode !== '') out.push(mode)

let open = false
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--') { out.push(...argv.slice(i)); break }
  if (!a.startsWith('-')) { out.push(a); continue }
  let m = /^--include=(.+)$/.exec(a)
  if (m) { out.push('--glob=' + m[1]); continue }
  m = /^--exclude=(.+)$/.exec(a)
  if (m) { out.push('--glob=!' + m[1]); continue }
  m = /^--exclude-dir=(.+)$/.exec(a)
  if (m) { out.push('--glob=!' + m[1] + '/**'); continue }
  if (/^-[^-]/.test(a) && !['-e', '-m', '-A', '-B', '-C', '-d'].includes(a)) {
    const vmc = /^-([mABC])([0-9]+)$/.exec(a)
    if (vmc !== null) { out.push('-' + vmc[1], vmc[2]); continue }
    let ok = true
    for (const ch of a.slice(1)) {
      if (ch === 'r' || ch === 'R') continue
      if ('EFilncowqvxs'.includes(ch)) { out.push('-' + ch); continue }
      ok = false
      break
    }
    if (ok) continue
    open = true
    break
  }
  if (a === '-r' || a === '-R' || a === '--directories=recurse') continue
  if (a === '-d') {
    if (argv[i + 1] === 'recurse') { i++; continue }
    if (i + 1 < argv.length) { i++; continue }
    open = true; break
  }
  if (['-E', '-F', '-i', '-n', '-l', '-c', '-o', '-w', '-q', '-v', '-x', '-s'].includes(a)) { out.push(a); continue }
  m = /^-([mABC])(.+)$/.exec(a)
  if (m) { out.push('-' + m[1], m[2]); continue }
  m = /^-([mABC])$/.exec(a)
  if (m) {
    if (i + 1 >= argv.length || !/^[0-9]+$/.test(argv[i + 1])) { open = true; break }
    out.push('-' + m[1], argv[++i]); continue
  }
  if (a === '-e') {
    if (i + 1 >= argv.length) { open = true; break }
    out.push('-e', argv[++i]); continue
  }
  if (/^-e.+/.test(a)) { out.push(a); continue }
  open = true
  break
}

function run(bin, args) {
  const child = spawn(bin, args, { stdio: 'inherit' })
  child.on('error', () => {
    if (bin === rgPath) run(hostGrep, argv)
    else process.exit(127)
  })
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 141 : 1)))
}
run(open ? hostGrep : rgPath, open ? argv : out)
`
}
