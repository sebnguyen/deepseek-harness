/**
 * The off-loop walk runner: one lazy worker thread per provider, in-flight
 * deduplication per repository root, and worker faults as rejections of the
 * pending call, never the Host. The plugin fiber owns the disposer.
 *
 * @module @deepseek-ai/dsh-git-isomorphic/runner.ts
 */
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import type { WalkRefusal, WalkReply } from './walk.ts'

/**
 * The worker source's extension says which world this module is in — dev-time
 * module runners boot the `.ts` closure, the built face boots `worker.cjs`.
 */
/* v8 ignore next -- the './worker.cjs' arm is the built-lib world, unreachable unbuilt by construction; the built smokes own it. */
const WORKER_PATH = fileURLToPath(new URL(new URL(import.meta.url).pathname.endsWith('.ts') ? './worker.ts' : './worker.cjs', import.meta.url))

/**
 * The flags a worker thread needs to read the `.ts` closure on this engine:
 * engines at or past 24 type-strip natively, the 22 line keeps the flag behind
 * `--experimental`; a built `worker.cjs` needs none.
 * @param workerPath - the resolved worker entry path.
 * @param version - the host's `process.version`.
 * @returns the worker's launch flags.
 */
export function workerExecArgv(workerPath: string, version: string): readonly string[] {
  if (!workerPath.endsWith('.ts')) return []
  const major = Number(version.slice(1).split('.')[0])
  return major >= 24 ? [] : ['--experimental-strip-types']
}

/** One answer the worker posts for one request id: a walk outcome or its fault. */
type WalkMessage =
  | { readonly id: number; readonly reply: WalkReply | WalkRefusal }
  | { readonly id: number; readonly error: string }

/** One queued reply waiting on its id. */
interface Pending {
  readonly resolve: (reply: WalkReply | WalkRefusal) => void
  readonly reject: (error: Error) => void
}

/**
 * Owns the worker thread and the pending replies.
 */
export class GitWalkRunner {
  private worker: Worker | undefined
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private readonly inflight = new Map<string, Promise<WalkReply | WalkRefusal>>()

  /**
   * Walk one repository off the Host loop; a concurrent walk of the same root
   * shares one worker round trip.
   * @param dir - repository root, host path.
   * @returns the walk's reply or refusal.
   */
  walk(dir: string): Promise<WalkReply | WalkRefusal> {
    const held = this.inflight.get(dir)
    if (held !== undefined) return held
    const promise = this.request(dir).finally(() => {
      this.inflight.delete(dir)
    })
    this.inflight.set(dir, promise)
    return promise
  }

  /** Terminate the worker and fail every queued reply; the fiber's exit. */
  dispose(): void {
    this.failAll(new Error('the git-walk worker was disposed'))
    void this.worker?.terminate()
    this.worker = undefined
  }

  private request(dir: string): Promise<WalkReply | WalkRefusal> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      this.pending.set(id, { resolve, reject })
      this.ensure().postMessage({ id, dir })
    })
  }

  private ensure(): Worker {
    if (this.worker !== undefined) return this.worker
    const worker = new Worker(WORKER_PATH, { execArgv: [...workerExecArgv(WORKER_PATH, process.version)] })
    worker.on('message', (message: WalkMessage) => {
      const slot = this.pending.get(message.id)
      if (slot === undefined) return
      this.pending.delete(message.id)
      if ('error' in message) slot.reject(new Error(message.error))
      else slot.resolve(message.reply)
    })
    worker.on('error', (error) => { this.failAll(error) })
    worker.on('exit', (code) => { this.failAll(new Error(`the git-walk worker exited (${code})`)) })
    this.worker = worker
    return worker
  }

  private failAll(error: Error): void {
    for (const slot of this.pending.values()) slot.reject(error)
    this.pending.clear()
    this.worker = undefined
  }
}
