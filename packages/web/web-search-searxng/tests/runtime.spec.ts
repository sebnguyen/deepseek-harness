import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { rm as fsRm } from 'node:fs/promises'
import { SearxngRuntime } from '../src/runtime.ts'
import { FakeSubprocess, successfulHandler } from './fake-subprocess.ts'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rm: vi.fn(actual.rm) }
})

/**
 * Awaits one rejection and returns it typed as an error-shaped value, for
 * asserting `code` and `message` without `expect.stringContaining` inside
 * `objectContaining` (untyped `any`, per lint).
 */
async function rejectionOf(promise: Promise<unknown>): Promise<{ code?: unknown; message: string }> {
  try {
    await promise
  } catch (error) {
    return error as { code?: unknown; message: string }
  }
  throw new Error('expected the promise to reject')
}

async function setup(handler?: FakeSubprocess['handler']) {
  const ctx = new Context()
  const subprocessFiber = await ctx.plugin(FakeSubprocess)
  const fake = ctx.subprocess as FakeSubprocess
  if (handler !== undefined) fake.handler = handler
  const fiber = await ctx.plugin(SearxngRuntime, { image: 'searxng/searxng:test', readyTimeoutMs: 2_000 })
  return { ctx, fake, fiber, subprocessFiber }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SearxngRuntime.ready', () => {
  it('starts the container and resolves its base URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    const { ctx, fake, fiber } = await setup(successfulHandler())
    await expect(ctx.searxngRuntime.ready()).resolves.toBe('http://127.0.0.1:34567')
    expect(fake.calls.map(spec => spec.argv[1])).toEqual(['run', 'port'])
    await fiber.dispose()
  })

  it('single-flights concurrent callers into one container start', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    const { ctx, fake, fiber } = await setup(successfulHandler())
    const [a, b] = await Promise.all([ctx.searxngRuntime.ready(), ctx.searxngRuntime.ready()])
    expect(a).toBe(b)
    expect(fake.calls.filter(spec => spec.argv[1] === 'run')).toHaveLength(1)
    expect(fake.calls.filter(spec => spec.argv[1] === 'port')).toHaveLength(1)
    await fiber.dispose()
  })

  it('forwards a live (non-aborted) signal into the readiness poll', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { ctx, fiber } = await setup(successfulHandler())
    const controller = new AbortController()

    await ctx.searxngRuntime.ready(controller.signal)

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.signal).toBe(controller.signal)
    await fiber.dispose()
  })

  it('forwards a pre-aborted signal as WEB_ABORTED', async () => {
    const { ctx, fake, fiber } = await setup(successfulHandler())
    const controller = new AbortController()
    controller.abort()
    // The fake `run`/`port` calls succeed instantly regardless of the signal
    // (this fake does not model docker-level cancellation); the readiness
    // loop's own `signal.aborted` check is what must fire on its first pass,
    // before any fetch attempt.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    await expect(ctx.searxngRuntime.ready(controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
    expect(fake.calls.map(spec => spec.argv[1])).toEqual(['run', 'port', 'stop'])
    await fiber.dispose()
  })
})

describe('SearxngRuntime startup failures', () => {
  it('surfaces a `docker run` stderr failure and never calls `docker stop`', async () => {
    const { ctx, fake, fiber } = await setup(() => ({ stdout: '', stderr: 'permission denied', exitCode: 1 }))
    const error = await rejectionOf(ctx.searxngRuntime.ready())
    expect(error.code).toBe('WEB_PROVIDER_ERROR')
    expect(error.message).toMatch(/permission denied/)
    expect(fake.calls.map(spec => spec.argv[1])).toEqual(['run'])
    await fiber.dispose()
  })

  it('falls back to stdout when a failed `docker run` has no stderr', async () => {
    const { ctx, fiber } = await setup(() => ({ stdout: 'no such image', stderr: '', exitCode: 1 }))
    const error = await rejectionOf(ctx.searxngRuntime.ready())
    expect(error.message).toMatch(/no such image/)
    await fiber.dispose()
  })

  it('falls back to the exit code when `docker run` reports neither stream', async () => {
    const { ctx, fiber } = await setup(() => ({ stdout: '', stderr: '', exitCode: 1 }))
    const error = await rejectionOf(ctx.searxngRuntime.ready())
    expect(error.message).toMatch(/docker run exited 1/)
    await fiber.dispose()
  })

  it('wraps a spawn-level docker failure (missing binary)', async () => {
    const { ctx, fake, fiber } = await setup()
    fake.spawn = () => { throw new Error('spawn docker ENOENT') }
    await expect(ctx.searxngRuntime.ready())
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
    await fiber.dispose()
  })

  it('stops the container and surfaces the failure when `docker port` cannot resolve a port', async () => {
    const { ctx, fake, fiber } = await setup((subcommand) => {
      if (subcommand === 'run') return { stdout: 'id', stderr: '', exitCode: 0 }
      if (subcommand === 'port') return { stdout: 'garbage', stderr: '', exitCode: 0 }
      return { stdout: '', stderr: '', exitCode: 0 }
    })
    const error = await rejectionOf(ctx.searxngRuntime.ready())
    expect(error.code).toBe('WEB_PROVIDER_ERROR')
    expect(error.message).toMatch(/could not resolve the published port/)
    expect(fake.calls.map(spec => spec.argv[1])).toEqual(['run', 'port', 'stop'])
    await fiber.dispose()
  })

  it('stops the container and surfaces the failure when `docker port` itself fails', async () => {
    const { ctx, fake, fiber } = await setup((subcommand) => {
      if (subcommand === 'run') return { stdout: 'id', stderr: '', exitCode: 0 }
      if (subcommand === 'port') return { stdout: '', stderr: 'no such container', exitCode: 1 }
      return { stdout: '', stderr: '', exitCode: 0 }
    })
    const error = await rejectionOf(ctx.searxngRuntime.ready())
    expect(error.message).toMatch(/no such container/)
    expect(fake.calls.map(spec => spec.argv[1])).toEqual(['run', 'port', 'stop'])
    await fiber.dispose()
  })

  it('times out waiting for the container to answer a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
    const { ctx, fiber } = await setup(successfulHandler())
    const error = await rejectionOf(ctx.searxngRuntime.ready())
    expect(error.code).toBe('WEB_PROVIDER_ERROR')
    expect(error.message).toMatch(/did not become ready/)
    await fiber.dispose()
  }, 10_000)

  it('times out waiting through repeated network failures', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('connection refused'))))
    const { ctx, fiber } = await setup(successfulHandler())
    const error = await rejectionOf(ctx.searxngRuntime.ready())
    expect(error.message).toMatch(/did not become ready/)
    await fiber.dispose()
  }, 10_000)

  it('allows a retry after a failed startup', async () => {
    const { ctx, fake, fiber } = await setup()
    let attempt = 0
    fake.handler = (subcommand) => {
      if (subcommand === 'run') {
        attempt += 1
        return attempt === 1 ? { stdout: '', stderr: 'first attempt fails', exitCode: 1 } : { stdout: 'id', stderr: '', exitCode: 0 }
      }
      if (subcommand === 'port') return { stdout: '0.0.0.0:34567', stderr: '', exitCode: 0 }
      return { stdout: '', stderr: '', exitCode: 0 }
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    await expect(ctx.searxngRuntime.ready()).rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
    await expect(ctx.searxngRuntime.ready()).resolves.toBe('http://127.0.0.1:34567')
    await fiber.dispose()
  })
})

describe('SearxngRuntime disposal', () => {
  it('stops the running container when the fiber disposes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    const name: { current?: string } = {}
    const { ctx, fake, fiber } = await setup(successfulHandler(name))
    await ctx.searxngRuntime.ready()

    await fiber.dispose()

    const stopCall = fake.calls.find(spec => spec.argv[1] === 'stop')
    expect(stopCall?.argv[2]).toBe(name.current)
  })

  it('disposes cleanly when the container was never started', async () => {
    const { fake, fiber } = await setup()
    await fiber.dispose()
    expect(fake.calls).toHaveLength(0)
  })

  it('tolerates `docker stop` failing during disposal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    const { ctx, fake, fiber } = await setup((subcommand) => {
      if (subcommand === 'run') return { stdout: 'id', stderr: '', exitCode: 0 }
      if (subcommand === 'port') return { stdout: '0.0.0.0:34567', stderr: '', exitCode: 0 }
      return { reject: new Error('daemon unreachable') }
    })
    await ctx.searxngRuntime.ready()
    await expect(fiber.dispose()).resolves.toBeUndefined()
    expect(fake.calls.map(spec => spec.argv[1])).toEqual(['run', 'port', 'stop'])
  })

  it('tolerates the settings directory failing to remove during disposal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    const { ctx, fiber } = await setup(successfulHandler())
    await ctx.searxngRuntime.ready()
    vi.mocked(fsRm).mockRejectedValueOnce(new Error('EACCES'))

    await expect(fiber.dispose()).resolves.toBeUndefined()
  })
})
