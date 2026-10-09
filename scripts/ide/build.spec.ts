/** The lane contract: plan order, artifact paths, and engine verification. */
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { artifactPaths, lanePlan, LaneError, lanePlatformKey, runLane, seatNodeVersion, seatPath } from './build.ts'

describe('lanePlatformKey', () => {
  it('mirrors the host manifest naming', () => {
    expect(lanePlatformKey('linux', 'x64')).toBe('linux-x64')
    expect(lanePlatformKey('win32', 'x64')).toBe('win32-x64')
  })
})

describe('seatNodeVersion', () => {
  it('accepts the pinned seat engine and refuses garbage by code', () => {
    expect(seatNodeVersion('24.18.0\n')).toBe('24.18.0')
    expect(() => seatNodeVersion('lts/*')).toThrow(LaneError)
    const refusal = (() => {
      try {
        seatNodeVersion('lts/*')
        return undefined
      }
      catch (error) {
        return error as LaneError
      }
    })()
    expect(refusal?.code).toBe('ide/seat-node-invalid')
  })
})

describe('lanePlan', () => {
  it('drives the pinned gulp tasks in order over the overlay-applied seat', () => {
    expect(lanePlan('/seat', 'abc', 'linux-x64', '/repo/scripts/ide')).toEqual([
      'git init --quiet /seat',
      'git -C /seat fetch --depth 1 https://github.com/microsoft/vscode.git abc',
      'git -C /seat checkout --detach abc',
      'git -C /seat apply /repo/scripts/ide/overlay/workbench.patch',
      'npm --prefix /seat ci',
      'npm --prefix /seat run gulp -- vscode-reh-linux-x64-min',
      'npm --prefix /seat run gulp -- vscode-web-min',
    ])
  })
})

describe('artifactPaths', () => {
  it('points at the pinned gulp destinations', () => {
    expect(artifactPaths('/seat', 'linux-x64')).toEqual({
      serverEntry: '/seat/.build/vscode-reh-linux-x64/bin/server.js',
      clientWorkbench: '/seat/.build/vscode-web/workbench/index.html',
    })
  })
})

describe('runLane', () => {
  it('prints the plan on dry run without launching anything', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ide-lane-'))
    await writeFile(join(home, 'manifest.json'), JSON.stringify({ upstreamSha: 'abc', upstreamUrl: 'u', twins: {} }))
    const launch = vi.fn()
    const plan = await runLane({ cacheDir: home, scriptsDir: home, hostNode: '24.18.0', platformKey: 'linux-x64', launch, manifestPath: join(home, 'manifest.json') }, true)
    expect(launch).not.toHaveBeenCalled()
    expect(plan).toHaveLength(7)
  })

  it('records twin digests from the seat artifacts and verifies the engine', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ide-lane-'))
    const seat = seatPath(home, 'abc')
    const artifacts = artifactPaths(seat, 'linux-x64')
    await mkdirP(artifacts)
    await writeFile(join(seat, '.nvmrc'), '24.18.0\n')
    await writeFile(join(home, 'manifest.json'), JSON.stringify({ upstreamSha: 'abc', upstreamUrl: 'u', twins: {} }))
    const launches: string[] = []
    await runLane({
      cacheDir: home,
      scriptsDir: home,
      hostNode: '24.18.0',
      platformKey: 'linux-x64',
      launch: (command, args) => {
        launches.push(`${command} ${args.join(' ')}`)
      },
      manifestPath: join(home, 'manifest.json'),
    }, false)
    expect(launches.at(-1)).toContain('vscode-web-min')
    const row = JSON.parse(await readFile(join(home, 'manifest.json'), 'utf8')) as { twins: Record<string, { serverSha256: string }> }
    expect(row.twins['linux-x64']!.serverSha256).toMatch(/^[0-9a-f]{64}$/)
    await expect(runLane({
      cacheDir: home,
      scriptsDir: home,
      hostNode: '24.14.1',
      platformKey: 'linux-x64',
      launch: () => {},
      manifestPath: join(home, 'manifest.json'),
    }, false)).rejects.toMatchObject({ code: 'ide/seat-node-mismatch' })
  })
})

async function mkdirP(artifacts: { serverEntry: string; clientWorkbench: string }): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises')
  const { dirname } = await import('node:path')
  await mkdir(dirname(artifacts.serverEntry), { recursive: true })
  await mkdir(dirname(artifacts.clientWorkbench), { recursive: true })
  await writeFile(artifacts.serverEntry, 'server')
  await writeFile(artifacts.clientWorkbench, 'html')
}
