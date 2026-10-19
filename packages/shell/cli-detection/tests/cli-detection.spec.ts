/**
 * Behavior tests for `@deepseek-ai/dsh-cli-detection`: env-key normalization,
 * duplicate-key detection, section rendering, boot-time probing through the
 * subprocess runtime, the `DSH_CLI_*` shell-env contribution, and the
 * conditional system-prompt section.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import * as ShellEnvPlugin from '@deepseek-ai/dsh-shell-env'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import * as CliDetectionPlugin from '@deepseek-ai/dsh-cli-detection'
import { DEFAULT_TOOLS, SECTION_NAME, envKeyFor, renderCliSection } from '@deepseek-ai/dsh-cli-detection'

const testSignal = new AbortController().signal

function execution(): ToolExecution {
  return {
    signal: testSignal,
    token: Symbol('cli-detection-test') as ToolExecution['token'],
    callId: ToolCallId('cli-detection-call'),
    rootCallId: ToolCallId('cli-detection-call'),
    name: 'bash',
    arguments: { command: 'true' },
  }
}

/** A subprocess runtime stub that resolves exactly the listed commands. */
function fakeSubprocess(available: readonly string[]): SubprocessRuntime {
  return {
    async resolveExecutable(command: string): Promise<string> {
      if (available.includes(command)) return `/usr/bin/${command}`
      throw new Error(`cli-detection-test: command not available: ${command}`)
    },
  } as Partial<SubprocessRuntime> as SubprocessRuntime
}

describe('envKeyFor', () => {
  it('derives managed env keys from command names', () => {
    expect(envKeyFor('playwright-cli')).toBe('DSH_CLI_PLAYWRIGHT_CLI')
    expect(envKeyFor('gh')).toBe('DSH_CLI_GH')
    expect(envKeyFor('  fire_fox  ')).toBe('DSH_CLI_FIRE_FOX')
  })

  it('rejects commands with no key-safe suffix', () => {
    expect(() => envKeyFor('---')).toThrow(/cannot derive/)
  })
})

describe('renderCliSection', () => {
  it('is empty when nothing resolved', () => {
    expect(renderCliSection([])).toBe('')
  })

  it('lists commands with their guidance and the env-variable hint', () => {
    const text = renderCliSection([
      { command: 'playwright-cli', guidance: 'Browser automation.', resolved: '/usr/bin/playwright-cli' },
      { command: 'gh', resolved: '/usr/bin/gh' },
    ])
    expect(text).toContain('`playwright-cli` — Browser automation.')
    expect(text).toContain('- `gh`\n')
    expect(text).toContain('$DSH_CLI_*')
  })
})

describe('cli-detection plugin', () => {
  it('exposes probed CLIs as DSH_CLI_* shell-env facts', async () => {
    const ctx = new Context()
    ctx.provide('subprocess', fakeSubprocess(['playwright-cli']))
    await ctx.plugin(ShellEnvPlugin, { dshHome: './test-dsh-home' })
    await ctx.plugin(CliDetectionPlugin, {
      tools: [
        { command: 'playwright-cli', guidance: 'Browser automation.' },
        { command: 'gh' },
      ],
    })

    expect(ctx.shellEnv.list()).toEqual([
      {
        contributor: 'cli-detection',
        description: 'Resolved path of the `playwright-cli` executable.',
        key: 'DSH_CLI_PLAYWRIGHT_CLI',
      },
    ])
    expect(ctx.shellEnv.collect(execution()).DSH_CLI_PLAYWRIGHT_CLI).toBe('/usr/bin/playwright-cli')
  })

  it('registers one prompt section naming the available tools', async () => {
    const ctx = new Context()
    ctx.provide('subprocess', fakeSubprocess(['playwright-cli']))
    await ctx.plugin(ShellEnvPlugin, { dshHome: './test-dsh-home' })
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(CliDetectionPlugin, {
      tools: [{ command: 'playwright-cli', guidance: 'Browser automation.' }],
    })

    const assembly = await ctx.systemPrompt.assemble({})
    const section = assembly.sections.find(item => item.name === SECTION_NAME)
    expect(section).toBeDefined()
    expect(section!.text).toContain('playwright-cli')
    expect(section!.text).toContain('Browser automation.')
    expect(renderPrompt(assembly)).toContain('Installed host CLIs')
  })

  it('stays invisible when every command is unavailable', async () => {
    const ctx = new Context()
    ctx.provide('subprocess', fakeSubprocess([]))
    await ctx.plugin(ShellEnvPlugin, { dshHome: './test-dsh-home' })
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(CliDetectionPlugin, { tools: [{ command: 'ghost-cli' }] })

    expect(ctx.shellEnv.list().filter(variable => variable.key.startsWith('DSH_CLI_'))).toEqual([])
    const assembly = await ctx.systemPrompt.assemble({})
    expect(assembly.sections.find(item => item.name === SECTION_NAME)).toBeUndefined()
  })

  it('rejects configs whose commands collide on one env key', async () => {
    const ctx = new Context()
    ctx.provide('subprocess', fakeSubprocess([]))
    await ctx.plugin(ShellEnvPlugin, { dshHome: './test-dsh-home' })
    await expect(ctx.plugin(CliDetectionPlugin, {
      tools: [{ command: 'pw-sh' }, { command: 'pw_sh' }],
    })).rejects.toThrow(/env key/)
  })

  it('ships playwright-cli as the default probe', () => {
    expect(DEFAULT_TOOLS.some((tool: { command: string }) => tool.command === 'playwright-cli')).toBe(true)
  })
})
