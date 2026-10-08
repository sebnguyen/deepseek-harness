/**
 * Host data-ready gate for the browser boot kernel: keeps the boot page up
 * until the Connection is established and the Workspace and Session list
 * baselines have arrived, so the mounted UI paints with data instead of an
 * empty shell.
 * @module @deepseek-ai/dsh-client-web/src/data-ready
 */
import type { Context } from '@deepseek-ai/cordis'

/** Bare observable source slice the gate samples; structural, so the kernel adds no package edge. */
export interface BootListSource {
  /** Read the current snapshot. */
  getSnapshot(): unknown
  /** Subscribe to snapshot changes; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void
}

/** Fallback release horizon when the Host never delivers the baselines. */
export const HOST_DATA_READY_TIMEOUT_MS = 15_000

function connectionReady(source: BootListSource | undefined): boolean {
  return source === undefined || source.getSnapshot() === 'connected'
}

function listReady(source: BootListSource | undefined): boolean {
  if (source === undefined) return true
  const snapshot = source.getSnapshot() as { phase?: unknown } | undefined
  return snapshot?.phase === 'ready'
}

/**
 * Resolve once the Host connection is established and the Workspace and
 * Session list baselines have arrived. Services absent from the boot graph
 * are skipped; a Host that never delivers releases the gate after the
 * timeout and the shell's own empty and error states take over. Baseline
 * pulls start at plugin activation, so awaiting them before mount cannot
 * deadlock the pulls.
 * @param ctx - Client root context after every graph entry activated.
 * @param timeoutMs - Fallback release horizon for a stuck Host.
 * @returns Resolves when every present source reports ready.
 */
export async function awaitDataReady(ctx: Context, timeoutMs = HOST_DATA_READY_TIMEOUT_MS): Promise<void> {
  const connection = ctx.get('connection') as { state?: BootListSource } | undefined
  const workspaces = ctx.get('workspaces') as { list?: BootListSource } | undefined
  const sessions = ctx.get('sessions') as { list?: BootListSource } | undefined
  const sources = [connection?.state, workspaces?.list, sessions?.list]
  const ready = (): boolean =>
    connectionReady(sources[0]) && listReady(sources[1]) && listReady(sources[2])
  if (ready()) return
  await new Promise<void>((resolve) => {
    const unsubscribes = sources
      .filter((source): source is BootListSource => source !== undefined)
      .map(source => source.subscribe(check))
    const timer = setTimeout(() => { finish() }, timeoutMs)
    function finish(): void {
      clearTimeout(timer)
      for (const unsubscribe of unsubscribes) unsubscribe()
      resolve()
    }
    function check(): void {
      if (ready()) finish()
    }
  })
}
