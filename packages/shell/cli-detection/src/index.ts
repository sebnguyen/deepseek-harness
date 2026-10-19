/**
 * CLI capability detection for model shell calls: probes a configured list of
 * host command-line tools at plugin load through the deployment's subprocess
 * runtime, exposes each surviving command as a managed `DSH_CLI_*`
 * shell-environment fact, and renders the available set — with per-tool usage
 * guidance — as one dynamic system-prompt section. Commands that fail
 * resolution stay invisible everywhere, so the prompt contributes nothing on
 * hosts where none is installed and prompt bytes stay stable per machine.
 *
 * @module @deepseek-ai/dsh-cli-detection
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-shell-env'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { DSH_ENV_PREFIX } from '@deepseek-ai/dsh-shell'
import type { DshEnvironmentKey } from '@deepseek-ai/dsh-shell'
import z from '@deepseek-ai/schemastery'

/** Name of the prompt section this plugin contributes. */
export const SECTION_NAME = 'cli-detection:available-tools'

export const name = 'cli-detection'
export const inject = ['subprocess', 'shellEnv']

/** One CLI to probe at plugin load and advertise when present. */
export interface CliToolSpec {
  /** Command resolved through the subprocess runtime: a bare PATH name or absolute path. */
  command: string
  /** Optional one-sentence usage guidance rendered next to the tool. */
  guidance?: string
}

/** A probed tool that resolved to an executable on this host. */
export interface ProbedCliTool extends CliToolSpec {
  /** The executable path reported by the subprocess runtime. */
  resolved: string
}

/** Plugin config: the tool list is deployment-authored (a shipped default is below). */
export interface Config {
  /** CLIs to probe; an empty list disables the plugin silently. */
  tools?: CliToolSpec[]
}

/** Shipped default: the Playwright CLI (`@playwright/cli`) browser daemon for agents. */
export const DEFAULT_TOOLS = [
  {
    command: 'playwright-cli',
    guidance: 'Playwright CLI browser daemon: run via bash — `playwright-cli open <url>`, then stateful commands such as `snapshot`, `click`, `type`, `screenshot` (page snapshots land in `./.playwright-cli/`); `playwright-cli --help` lists all commands.',
  },
] satisfies CliToolSpec[]

/** Runtime configuration schema for the cli-detection plugin. */
export const Config: z<Config> = z.object({
  tools: z.array(z.object({
    command: z.string(),
    guidance: z.string().default(''),
  })).default([...DEFAULT_TOOLS]),
})

const ENV_KEY_SUFFIX = /^[A-Z][A-Z0-9_]*$/

/**
 * Derive the managed `DSH_CLI_*` shell-env key for one command name:
 * `playwright-cli` becomes `DSH_CLI_PLAYWRIGHT_CLI`. Non-alphanumerics fold
 * into underscores; a name that yields no key-safe suffix is a configuration
 * error and fails loudly.
 * @param command - the configured command name.
 * @returns the managed environment variable name.
 */
export function envKeyFor(command: string): DshEnvironmentKey {
  const suffix = command.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!ENV_KEY_SUFFIX.test(suffix)) {
    throw new Error(`cli-detection: cannot derive a DSH_CLI_* key from command ${JSON.stringify(command)}`)
  }
  return `${DSH_ENV_PREFIX}CLI_${suffix}` as DshEnvironmentKey
}

/**
 * Render the prompt section that lists every probed tool. Empty when nothing
 * resolved, so assemblies on hosts without the tools stay byte-identical.
 * @param tools - the commands that resolved successfully at plugin load.
 * @returns the section text, or `''` when it should not appear at all.
 */
export function renderCliSection(tools: readonly ProbedCliTool[]): string {
  if (tools.length === 0) return ''
  const lines = tools.map((tool) => {
    const guidance = (tool.guidance ?? '').trim()
    return `- \`${tool.command}\`${guidance === '' ? '' : ` — ${guidance}`}`
  })
  return [
    'Installed host CLIs, probed at session start; each resolved path is exposed to shell commands as a managed `$DSH_CLI_*` variable:',
    ...lines,
  ].join('\n')
}

/**
 * Load the cli-detection plugin: probe every configured command in parallel,
 * then register the survivors' `DSH_CLI_*` shell-env facts and — when
 * `ctx.systemPrompt` is mounted — the prompt section advertising them.
 * @param ctx - the plugin context carrying the subprocess runtime and shell-env registry.
 * @param config - the deployment's config after schema defaulting.
 */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const tools = config.tools ?? [...DEFAULT_TOOLS]

  // Duplicate env keys are a config bug (e.g. "pw-sh" and "pw_sh"); fail at load.
  const keys = tools.map(tool => envKeyFor(tool.command))
  for (const [index, key] of keys.entries()) {
    const first = keys.indexOf(key)
    if (first !== index) {
      throw new Error(`cli-detection: commands ${JSON.stringify(tools[first]?.command)} and ${JSON.stringify(tools[index]?.command)} derive the same env key "${key}"`)
    }
  }

  const setupAbort = new AbortController()
  const stopSetupCancellation = ctx.on('internal/plugin', (fiber) => {
    // An async plugin callback must observe its own disposal before Cordis can
    // run effect cleanup, because unload otherwise waits for this callback.
    if (fiber === ctx.fiber && fiber.uid === null) {
      setupAbort.abort(new Error('cli-detection setup disposed'))
    }
  })

  let available: ProbedCliTool[]
  try {
    const probed = await Promise.all(tools.map(async (tool): Promise<ProbedCliTool | undefined> => {
      try {
        const resolved = await ctx.subprocess.resolveExecutable(tool.command, undefined, setupAbort.signal)
        return { ...tool, resolved }
      } catch (error) {
        // A missing command is the intended outcome; only disposal is an error.
        if (setupAbort.signal.aborted) throw setupAbort.signal.reason ?? error
        return undefined
      }
    }))
    available = probed.filter((tool): tool is ProbedCliTool => tool !== undefined)
  } finally {
    stopSetupCancellation()
  }
  if (available.length === 0) return

  ctx.effect(() => {
    const disposeContribution = ctx.shellEnv.register({
      name,
      variables: Object.fromEntries(available.map(tool => [
        envKeyFor(tool.command),
        { description: `Resolved path of the \`${tool.command}\` executable.` },
      ])) as Record<DshEnvironmentKey, { description: string }>,
      resolve: () => Object.fromEntries(available.map(tool => [envKeyFor(tool.command), tool.resolved])),
    })
    return () => disposeContribution()
  }, 'cli-detection.shellEnv')

  // Prompt guidance rides `systemPrompt` where mounted; compositions without
  // it still keep the shell-env facts.
  ctx.inject(['systemPrompt'], (scope: Context) => {
    scope.systemPrompt.section({
      name: SECTION_NAME,
      order: scope.systemPrompt.getSectionOrder('CLI_DETECTION'),
      text: () => renderCliSection(available),
    })
  })
}
