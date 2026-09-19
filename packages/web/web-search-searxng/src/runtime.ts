/**
 * `SearxngRuntime`: owns exactly one ephemeral, Docker-managed SearXNG instance for the lifetime
 * of the owning fiber. Registered as `ctx.searxngRuntime` — a Cordis `Service`, so the framework
 * itself guarantees one instance per context — every `SearxngSearchProvider` search shares it
 * instead of racing to start a container each. The container starts lazily on the first `ready()`
 * call, concurrent callers single-flight that startup through one memoized promise, and the
 * container stops when the owning fiber disposes.
 * @module @deepseek-ai/dsh-web-search-searxng/runtime
 */

import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { WebError } from '@deepseek-ai/dsh-web'
import { buildSettingsYaml, parseDockerPort, runDocker } from './docker.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    searxngRuntime: SearxngRuntime
  }
}

/** Default Docker image for the managed container. Pin an explicit tag in production — `latest` moves. */
export const SEARXNG_DEFAULT_IMAGE = 'searxng/searxng:latest'

/** Default upper bound (ms) to wait for the container to answer a search before startup fails. */
export const SEARXNG_DEFAULT_READY_TIMEOUT_MS = 60_000

/** Poll interval (ms) while waiting for the container to become ready. */
const READY_POLL_INTERVAL_MS = 500

/** Resolved runtime options (the plugin's `apply` supplies constant defaults). */
export interface SearxngRuntimeOptions {
  /** Docker image reference for the managed container. */
  image: string
  /** Upper bound (ms) to wait for the container to become ready. */
  readyTimeoutMs: number
}

/** The container-management surface `SearxngSearchProvider` depends on. */
export interface SearxngInstanceSource {
  /**
   * Resolve the running instance's base URL, starting the managed container on
   * the first call.
   * @param signal - optional cancellation forwarded to startup's docker
   *   commands and readiness poll; has no effect once already running.
   * @returns the container's `http://127.0.0.1:<port>` base URL.
   */
  ready(signal?: AbortSignal): Promise<string>
}

/**
 * The web seam's managed SearXNG container service. Registered as `ctx.searxngRuntime`
 * (one instance per context, the Cordis `Service` guarantee); `SearxngSearchProvider`
 * is its sole consumer.
 */
export class SearxngRuntime extends Service implements SearxngInstanceSource {
  /**
   * `subprocess` backs every docker invocation; declared so `this.ctx.subprocess`
   * is topology-safe regardless of the mounting composition.
   */
  static inject = ['subprocess']

  private starting: Promise<string> | undefined
  private containerName: string | undefined
  private settingsDir: string | undefined

  constructor(ctx: Context, private readonly options: SearxngRuntimeOptions) {
    super(ctx, 'searxngRuntime')
  }

  /** Registers the container-stop disposer once Cordis is collecting this fiber's effects. */
  [Service.init](): void {
    this.ctx.effect(() => () => this.stop(), 'searxngRuntime.container')
  }

  /**
   * Resolve the running instance's base URL, starting the managed container on
   * the first call. Concurrent callers share one in-flight startup.
   * @param signal - optional cancellation forwarded to startup's docker
   *   commands and readiness poll; has no effect once already running.
   * @returns the container's `http://127.0.0.1:<port>` base URL.
   */
  async ready(signal?: AbortSignal): Promise<string> {
    if (this.starting === undefined) {
      this.starting = this.start(signal).catch((error: unknown) => {
        this.starting = undefined
        throw error
      })
    }
    return this.starting
  }

  private async start(signal?: AbortSignal): Promise<string> {
    const name = `dsh-searxng-${randomUUID()}`
    this.settingsDir = await mkdtemp(join(tmpdir(), 'dsh-searxng-'))
    const settingsPath = join(this.settingsDir, 'settings.yml')
    await writeFile(settingsPath, buildSettingsYaml(randomBytes(32).toString('hex')))

    try {
      const run = await runDocker(this.ctx, [
        'run', '-d', '--rm', '--name', name,
        '-p', '127.0.0.1::8080',
        '-v', `${settingsPath}:/etc/searxng/settings.yml:ro`,
        this.options.image,
      ], signal)
      if (run.exitCode !== 0) {
        throw new WebError(
          `SearXNG container failed to start: ${run.stderr.length > 0 ? run.stderr : run.stdout || `docker run exited ${String(run.exitCode)}`}`,
          'WEB_PROVIDER_ERROR',
        )
      }
      this.containerName = name

      const port = await this.resolvePort(name, signal)
      const instanceUrl = `http://127.0.0.1:${String(port)}`
      await this.waitUntilReady(instanceUrl, signal)
      return instanceUrl
    } catch (error) {
      await this.stop()
      throw error
    }
  }

  private async resolvePort(name: string, signal?: AbortSignal): Promise<number> {
    const result = await runDocker(this.ctx, ['port', name, '8080/tcp'], signal)
    const port = result.exitCode === 0 ? parseDockerPort(result.stdout) : undefined
    if (port === undefined) {
      throw new WebError(
        `could not resolve the published port for SearXNG container ${name}: ${result.stderr.length > 0 ? result.stderr : result.stdout}`,
        'WEB_PROVIDER_ERROR',
      )
    }
    return port
  }

  private async waitUntilReady(instanceUrl: string, signal?: AbortSignal): Promise<void> {
    const deadline = Date.now() + this.options.readyTimeoutMs
    let lastError: unknown
    while (Date.now() < deadline) {
      if (signal?.aborted === true) throw new WebError('SearXNG container startup aborted', 'WEB_ABORTED')
      try {
        const response = await fetch(`${instanceUrl}/search?q=ready&format=json`, {
          headers: { accept: 'application/json' },
          ...signal !== undefined ? { signal } : {},
        })
        if (response.ok) return
        lastError = new Error(`HTTP ${String(response.status)}`)
      } catch (error: unknown) {
        lastError = error
      }
      await sleep(READY_POLL_INTERVAL_MS)
    }
    throw new WebError(
      `SearXNG container did not become ready within ${String(this.options.readyTimeoutMs)}ms: ${String(lastError)}`,
      'WEB_PROVIDER_ERROR',
      { cause: lastError },
    )
  }

  private async stop(): Promise<void> {
    const name = this.containerName
    const settingsDir = this.settingsDir
    this.containerName = undefined
    this.settingsDir = undefined
    this.starting = undefined
    if (name !== undefined) {
      // Best-effort: teardown must not throw for a container that crashed or
      // was already removed out of band.
      await runDocker(this.ctx, ['stop', name]).catch(() => undefined)
    }
    if (settingsDir !== undefined) {
      await rm(settingsDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
