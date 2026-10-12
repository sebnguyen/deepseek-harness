/**
 * The terminal application's ordinary command-line provider over a real
 * Loader tree: the parsed styling choice and optional seed prompt become
 * injected runner config, while help leaves the consumer pending.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { internals, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, TUI_STARTUP_SERVICE, type TuiStartupValues } from '../src/startup.ts'

/** What one boot of the fixture tree observed. */
interface Observed {
  exits: number[]
  out: string
  runnerConfig?: unknown
}

const disposers: (() => Promise<void>)[] = []

/** Fixture tree roots, removed after their booted tree has been disposed. */
const tempDirs: string[] = []

/** The process-level NO_COLOR value around a boot; restored afterwards. */
let savedNoColor: string | undefined

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  internals.stdout = process.stdout
  internals.stderr = process.stderr
  if (savedNoColor === undefined) delete process.env.NO_COLOR
  else process.env.NO_COLOR = savedNoColor
})

/**
 * Mount the real provider over a runner stand-in.
 * @param args - the invocation's inner arguments.
 * @param noColor - the NO_COLOR environment during the boot, if any.
 * @returns the resolved service value and observed runner/process effects.
 */
async function bootStartup(args: string[], noColor?: string): Promise<{ values: TuiStartupValues | undefined; observed: Observed }> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-tui-startup-'))
  tempDirs.push(dir)
  const observed: Observed = { exits: [], out: '' }
  savedNoColor = process.env.NO_COLOR
  if (noColor === undefined) delete process.env.NO_COLOR
  else process.env.NO_COLOR = noColor
  writeFileSync(join(dir, 'row.mjs'), 'export function apply(_ctx, config) { globalThis.__tuiStartupObserved.runnerConfig = config }\n')
  // Loader imports through Node's resolver, so this fixture delegates to the
  // source-plane plugin already imported by the test.
  writeFileSync(join(dir, 'startup.mjs'), `
export const name = 'tui-startup'
export const inject = ['cmdlineArgs']
export const apply = ctx => globalThis.__tuiStartupApply(ctx)
`)
  writeFileSync(join(dir, 'cordis.yml'), [
    '- id: tui-runner',
    `  name: ${pathToFileURL(join(dir, 'row.mjs')).href}`,
    `  inject: [${TUI_STARTUP_SERVICE}]`,
    '  config:',
    '    color: !!js ctx.tuiStartup.color',
    '    prompt: !!js ctx.tuiStartup.prompt ?? \'\'',
    '- id: tui-startup',
    `  name: ${pathToFileURL(join(dir, 'startup.mjs')).href}`,
    '',
  ].join('\n'))
  const observing = { write: (chunk: string) => { observed.out += chunk; return true } }
  internals.stdout = observing
  internals.stderr = observing
  const globals = globalThis as unknown as {
    __tuiStartupApply: typeof apply
    __tuiStartupObserved: Observed
  }
  globals.__tuiStartupApply = apply
  globals.__tuiStartupObserved = observed

  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  provideCmdline(ctx, { args, exit: code => void observed.exits.push(code) })
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  disposers.push(async () => { await ctx.fiber.dispose() })
  return {
    values: ctx.get(TUI_STARTUP_SERVICE) as TuiStartupValues | undefined,
    observed,
  }
}

describe('tui command-line provider', () => {
  it('enables styling by default with no seed prompt', async () => {
    const { values, observed } = await bootStartup([])
    expect(values).toEqual({ color: true })
    expect(observed.runnerConfig).toEqual({ color: true, prompt: '' })
    expect(observed.exits).toEqual([])
  })

  it('joins the seed-prompt positional into the runner config', async () => {
    const { values, observed } = await bootStartup(['summarize', 'README.md'])
    expect(values).toEqual({ color: true, prompt: 'summarize README.md' })
    expect(observed.runnerConfig).toEqual({ color: true, prompt: 'summarize README.md' })
  })

  it('disables styling on --no-color', async () => {
    const { values, observed } = await bootStartup(['--no-color'])
    expect(values).toEqual({ color: false })
    expect(observed.runnerConfig).toEqual({ color: false, prompt: '' })
  })

  it('disables styling when NO_COLOR is set', async () => {
    const { values } = await bootStartup([], '1')
    expect(values).toEqual({ color: false })
  })

  it('prints its own help and leaves the runner pending', async () => {
    const { values, observed } = await bootStartup(['--help'])
    expect(observed.out).toContain('dsh --profile tui')
    expect(observed.out).toContain('--no-color')
    expect(values).toBeUndefined()
    expect(observed.runnerConfig).toBeUndefined()
    expect(observed.exits).toEqual([0])
  })
})
