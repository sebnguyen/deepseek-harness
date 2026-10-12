/**
 * The terminal application's command-line provider: it parses `--no-color`,
 * an optional seed prompt positional, and the app's `--help`, then publishes
 * {@link TUI_STARTUP_SERVICE}. The runner is an ordinary consumer whose lazy
 * config waits for that service.
 * @module @deepseek-ai/dsh-tui-app/startup
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'tui-startup'

/** Services required before the invocation can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided by this plugin and injected by the terminal runner. */
export const TUI_STARTUP_SERVICE = 'tuiStartup'

/** What the runner row reads from {@link TUI_STARTUP_SERVICE}. */
export interface TuiStartupValues {
  /** Whether ANSI styling is enabled (`--no-color` or `NO_COLOR` disables it). */
  color: boolean
  /** The optional seed prompt this invocation asked to submit on boot. */
  prompt?: string
}

/**
 * This app's command: the seed-prompt positional, its styling option, and its
 * help text.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
function tuiCommand(): Command {
  return new Command()
    .name('dsh --profile tui')
    .description('Chat with dsh in your terminal: streaming answers, tool activity, and interactive approvals.')
    .helpOption('-h, --help', 'show this help')
    .option('--no-color', 'disable ANSI styling (NO_COLOR is honored too)')
    .argument('[prompt...]', 'a seed prompt; multiple words are joined by spaces (the session stays interactive)')
    .addHelpText('after', `
Examples:
  dsh --profile tui                        start an interactive terminal session
  dsh --profile tui "summarize README.md"   seed the first prompt, stay interactive
  NO_COLOR=1 dsh --profile tui             run without ANSI styling
`)
}

/**
 * Parse and provide the invocation as an ordinary Cordis service. The
 * command's action publishes the values; on `--help` (or a parse error)
 * nothing is provided, so the runner never mounts.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = tuiCommand()
  program.action(() => {
    const options = program.opts<{ color: boolean }>()
    const prompt = program.args.join(' ')
    ctx.provide(TUI_STARTUP_SERVICE, {
      color: options.color && process.env.NO_COLOR === undefined,
      ...prompt.trim() === '' ? {} : { prompt },
    } satisfies TuiStartupValues)
  })
  parseCmdline(ctx, program)
}
