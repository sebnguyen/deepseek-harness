/**
 * Docker CLI helpers for `SearxngRuntime`: a settings.yml that enables SearXNG's JSON search
 * format (disabled by default upstream), the `docker port` output parser, and one wrapper that
 * runs a `docker` subcommand through `ctx.subprocess` and normalizes spawn/provider failures into
 * `WebError`. A non-zero `docker` exit is a result the caller interprets, not a thrown error — the
 * same split `dsh-web-fetch-http` draws between transport failure and a non-2xx response.
 * @module @deepseek-ai/dsh-web-search-searxng/docker
 */

import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import { WebError } from '@deepseek-ai/dsh-web'

/** Exit facts and collected output of one completed `docker` invocation. */
export interface DockerRunOutcome {
  /** Exit code; `null` when the process died from a signal (for example, an aborted startup). */
  exitCode: number | null
  stdout: string
  stderr: string
}

/**
 * Build a settings.yml that layers onto the image's shipped defaults and enables the `json`
 * search format the runtime's readiness poll and provider requests depend on.
 *
 * @param secretKey - a fresh per-container secret; SearXNG requires a non-placeholder value.
 * @returns the complete settings.yml text.
 */
export function buildSettingsYaml(secretKey: string): string {
  return [
    'use_default_settings: true',
    'server:',
    `  secret_key: "${secretKey}"`,
    'search:',
    '  formats:',
    '    - html',
    '    - json',
    '',
  ].join('\n')
}

/**
 * Parse the published host port from `docker port <name> 8080/tcp` output. The command prints one
 * `host:port` line per bound address family (for example dual-stack `0.0.0.0`/`[::]`); every line
 * names the same published port, so the first parseable one wins.
 *
 * @param output - the command's raw stdout.
 * @returns the published host port, or `undefined` when no line parses.
 */
export function parseDockerPort(output: string): number | undefined {
  for (const line of output.split('\n')) {
    const match = /:(\d+)\s*$/.exec(line.trim())
    if (match?.[1] === undefined) continue
    const port = Number(match[1])
    if (Number.isInteger(port) && port > 0) return port
  }
  return undefined
}

/**
 * Run one `docker` subcommand through `ctx.subprocess` and collect its output.
 *
 * @param ctx - context whose `subprocess` service spawns the command.
 * @param argv - arguments after `docker` (never shell-interpreted).
 * @param signal - optional cancellation forwarded to the spawn.
 * @returns the command's exit facts and collected stdout/stderr.
 * @throws {@link WebError} `WEB_PROVIDER_ERROR` when `docker` cannot be spawned or the subprocess
 *   seam itself fails; a `docker` command that runs and exits non-zero is a normal return, not a throw.
 */
export async function runDocker(ctx: Context, argv: readonly string[], signal?: AbortSignal): Promise<DockerRunOutcome> {
  let handle: ReturnType<Context['subprocess']['spawn']>
  try {
    handle = ctx.subprocess.spawn({
      argv: ['docker', ...argv],
      cwd: tmpdir(),
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 65_536 },
        stderr: { maxBytes: 65_536 },
      },
      graceMs: 5_000,
      ...signal !== undefined ? { signal } : {},
    })
  } catch (error: unknown) {
    throw new WebError(`failed to spawn docker ${argv.join(' ')}: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
  let outcome: Awaited<typeof handle.done>
  try {
    outcome = await handle.done
  } catch (error: unknown) {
    throw new WebError(`docker ${argv.join(' ')} failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
  return {
    exitCode: outcome.exitCode,
    stdout: handle.collected.stdout?.readFrom(0).text ?? '',
    stderr: handle.collected.stderr?.readFrom(0).text ?? '',
  }
}
