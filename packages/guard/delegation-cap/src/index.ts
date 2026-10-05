/**
 * Per-turn delegation-spawn guard. Registers one monotonic
 * `ctx.tools.guard()` that denies delegation-tool calls whose logged
 * `tool/call` count for the current turn would exceed the configured cap,
 * so a spree collapses into an errored result the model can convert into
 * todo items instead of spawning unbounded readers. The tool stays
 * model-visible; only the (cap+1)-th start is denied, mirroring `maxDepth`'s
 * per-call pattern.
 * @module @deepseek-ai/dsh-delegation-cap
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

export const name = 'delegation-cap'
export const inject = ['tools']

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** Global tool names the cap counts (e.g. `['subagent', 'explore']`). */
  tools: string[]
  /**
   * Maximum counted starts per turn. The (cap+1)-th start in the same turn is
   * denied with an actionable reason; cap 0 forbids delegation entirely.
   */
  maxDelegationsPerTurn: number
  /**
   * Array parameter whose entries also count as starts (default `tasks`):
   * one batched call counts as `1 + entries.length` delegation starts, so a
   * batch cannot route around the cap that counts separate calls.
   */
  batchParameter?: string
}

export const Config: z<Config> = z.object({
  tools: z.array(z.string()).min(1),
  maxDelegationsPerTurn: z.natural().max(Number.MAX_SAFE_INTEGER),
  batchParameter: z.string().min(1).default('tasks'),
})

/**
 * Install the guard.
 * @param ctx - Context that owns the registration.
 * @param config - counted tools and the per-turn cap.
 */
export function apply(ctx: Context, config: Config): void {
  if (config.tools.length === 0) {
    throw new Error('delegation-cap: `tools` must name at least one delegation tool (an empty cap counts nothing)')
  }
  const counted = new Set(config.tools)
  const batchParameter = config.batchParameter ?? 'tasks'
  const batchCount = (args: unknown): number => {
    // Session `tool/call` events keep arguments as raw JSON strings.
    let parsed: unknown = args
    if (typeof args === 'string') {
      try {
        parsed = JSON.parse(args)
      }
      catch {
        return 0
      }
    }
    if (parsed === null || typeof parsed !== 'object') return 0
    const batch = (parsed as Record<string, unknown>)[batchParameter]
    return Array.isArray(batch) ? batch.length : 0
  }
  ctx.tools.guard((exec: ToolExecution) => {
    if (!counted.has(exec.name) || exec.agent === undefined) return undefined
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const events = exec.agent.session.snapshotEvents()
    let currentTurn: number | undefined
    let count = 0
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (event === undefined) break
      if (event.type === 'turn/start') {
        currentTurn = event.data.turn
        break
      }
      if (event.type === 'tool/call' && counted.has(event.data.name)) {
        // A batched call counts as one start per child its batch spawns.
        count += 1 + batchCount(event.data.arguments)
      }
    }
    // The proposed call's own tool/call is logged before guards run, so the
    // count includes it and its batch entries.
    if (currentTurn === undefined || count <= config.maxDelegationsPerTurn) return undefined
    return `delegation cap reached (${config.maxDelegationsPerTurn} per turn) — convert the last handoff into todo items before spawning another reader`
  })
}
