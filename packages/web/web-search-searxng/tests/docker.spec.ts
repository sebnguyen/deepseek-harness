import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { buildSettingsYaml, parseDockerPort, runDocker } from '../src/docker.ts'

describe('buildSettingsYaml', () => {
  it('embeds the secret key and enables the json search format', () => {
    const yaml = buildSettingsYaml('deadbeef')
    expect(yaml).toContain('use_default_settings: true')
    expect(yaml).toContain('secret_key: "deadbeef"')
    expect(yaml).toContain('- html')
    expect(yaml).toContain('- json')
  })
})

describe('parseDockerPort', () => {
  it('parses the port from a single line', () => {
    expect(parseDockerPort('0.0.0.0:34567')).toBe(34567)
  })

  it('skips unparseable and non-positive lines before a valid one', () => {
    expect(parseDockerPort('not a port line\n0.0.0.0:0\n[::]:34567')).toBe(34567)
  })

  it('returns undefined when no line parses', () => {
    expect(parseDockerPort('nothing here')).toBeUndefined()
  })
})

/** A minimal `ctx.subprocess.spawn` fake, cast to `Context` for `runDocker`'s narrow use of it. */
function fakeContext(spawn: (spec: { argv: readonly string[] }) => unknown): Context {
  return { subprocess: { spawn } } as unknown as Context
}

describe('runDocker', () => {
  it('returns exit facts and collected output on success', async () => {
    const ctx = fakeContext(() => ({
      collected: {
        stdout: { readFrom: () => ({ text: 'out', nextOffset: 3, lossy: false }) },
        stderr: { readFrom: () => ({ text: 'err', nextOffset: 3, lossy: false }) },
      },
      done: Promise.resolve({ exitCode: 0, signal: null }),
    }))
    await expect(runDocker(ctx, ['version'])).resolves.toEqual({ exitCode: 0, stdout: 'out', stderr: 'err' })
  })

  it('falls back to empty strings when a stream was not collected', async () => {
    const ctx = fakeContext(() => ({
      collected: {},
      done: Promise.resolve({ exitCode: 1, signal: null }),
    }))
    await expect(runDocker(ctx, ['version'])).resolves.toEqual({ exitCode: 1, stdout: '', stderr: '' })
  })

  it('reports a non-zero exit as a normal result, not a throw', async () => {
    const ctx = fakeContext(() => ({
      collected: {},
      done: Promise.resolve({ exitCode: 127, signal: null }),
    }))
    await expect(runDocker(ctx, ['run'])).resolves.toMatchObject({ exitCode: 127 })
  })

  it('wraps a synchronous spawn failure as WEB_PROVIDER_ERROR', async () => {
    const ctx = fakeContext(() => { throw new Error('docker not found') })
    await expect(runDocker(ctx, ['version']))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('wraps a rejected done promise as WEB_PROVIDER_ERROR', async () => {
    const ctx = fakeContext(() => ({ collected: {}, done: Promise.reject(new Error('boom')) }))
    await expect(runDocker(ctx, ['version']))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })
})
