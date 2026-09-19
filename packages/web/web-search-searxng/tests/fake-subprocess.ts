import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessCollectedOutputs,
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessOutputRead,
  SubprocessOutputReader,
  SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'

/** Shared subprocess fakes for `SearxngRuntime` tests: not a `*.spec.ts` file, so vitest never runs it directly. */
export type ScriptedRun = { stdout: string; stderr: string; exitCode: number | null } | { reject: Error }

export class FakeReader implements SubprocessOutputReader {
  constructor(private readonly text: string) {}
  readFrom(_fromByte: number): SubprocessOutputRead {
    return { text: this.text, nextOffset: this.text.length, lossy: false }
  }
}

export class FakeHandle implements SubprocessHandle {
  readonly stdin = undefined
  readonly stdout = undefined
  readonly stderr = undefined
  readonly collected: SubprocessCollectedOutputs
  readonly done: Promise<SubprocessOutcome>

  constructor(script: () => ScriptedRun) {
    const scripted = script()
    if ('reject' in scripted) {
      this.collected = {}
      this.done = Promise.reject(scripted.reject)
    } else {
      this.collected = { stdout: new FakeReader(scripted.stdout), stderr: new FakeReader(scripted.stderr) }
      this.done = Promise.resolve({ exitCode: scripted.exitCode, signal: null })
    }
  }

  terminate(): void {}
  waitForExit(): Promise<boolean> { return Promise.resolve(true) }
}

/** Scriptable fake `ctx.subprocess`: `handler` decides each `docker <subcommand>` outcome by argv. */
export class FakeSubprocess extends SubprocessRuntime {
  calls: SubprocessSpawnSpec[] = []
  handler: (subcommand: string, spec: SubprocessSpawnSpec) => ScriptedRun = () => ({ stdout: '', stderr: '', exitCode: 0 })

  override async resolveExecutable(command: string): Promise<string> { return command }
  override spawnTerminal(): Promise<never> { throw new Error('not used by SearxngRuntime') }

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.calls.push(spec)
    const subcommand = spec.argv[1] ?? ''
    return new FakeHandle(() => this.handler(subcommand, spec))
  }
}

/** Scripts a full successful lifecycle: `run` succeeds, `port` resolves, `stop` succeeds. */
export function successfulHandler(name?: { current?: string | undefined }): FakeSubprocess['handler'] {
  return (subcommand, spec) => {
    if (subcommand === 'run') {
      if (name !== undefined) {
        const index = spec.argv.indexOf('--name')
        name.current = index >= 0 ? spec.argv[index + 1] : undefined
      }
      return { stdout: 'container-id', stderr: '', exitCode: 0 }
    }
    if (subcommand === 'port') return { stdout: '0.0.0.0:34567', stderr: '', exitCode: 0 }
    return { stdout: '', stderr: '', exitCode: 0 }
  }
}
