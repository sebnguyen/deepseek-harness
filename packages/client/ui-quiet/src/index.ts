/**
 * Quiet mode, node half: grammar-enforced tool-only working steps, armed
 * live by the shared `ui-quiet` settings namespace in one of three modes.
 * `normal` passes every request through untouched; `quiet` forces
 * tool-only steps and closes the turn with a tool-free answer one-shot
 * after the stop; `silence` is quiet without the one-shot — the stop
 * concludes the turn on the spot. The browser selector binds the same
 * namespace through the settings scope, so picking a mode arms or
 * disarms this half in real time; without a settings provider the
 * composition entry arms `quiet`, the historical default.
 *
 * Working steps (`quiet` and `silence`): the `agent/request` waterfall
 * (dispatched at `core/agent-loop/src/agent.ts:530`) attaches
 * `toolChoice: 'required'` and the empty-object `structuredOutput` leak
 * shield, so the model goes straight from thinking into tool-call
 * arguments and any leaked answer text is bound to `{}`.
 * `quiet_finish` is the honest stop branch `required` needs, registered
 * only while a mode arms the grammar. Under `quiet` its execution flips
 * the finish flag (no `concludesTurn` — the turn continues on purpose) and
 * the next request runs as the one-shot: `toolChoice: 'none'`, no schema,
 * so only thinking and the closing answer are generated; the loop
 * settles the turn on that tool-free message (`agent.ts:487`). Under
 * `silence` the same call instead runs `exec.concludeTurn()`: the loop
 * commits the stop batch and ends the turn there — no one-shot. Empty
 * answer rows render nothing through the stock AssistantNodeView guard.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-settings'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { EMPTY_OBJECT_SCHEMA, QUIET_FINISH_TOOL } from './quiet.ts'
import {
  DEFAULT_MODE, QUIET_MODE_FIELD, QUIET_SETTINGS_NAMESPACE, QuietSettingsSchema,
  normalizeQuietMode, type QuietMode, type QuietSettings,
} from './quiet-settings.ts'

/** Host plugin body: the stop tool, plus the request waterfall. */
export function apply(ctx: Context): void {
  /** The live grammar mode from the namespace. */
  let mode: QuietMode = DEFAULT_MODE
  /** While set, the next request is the closing one-shot (quiet only). */
  let pendingFinish = false
  /** The tools registry's register, once injected; undefined disarms tool changes. */
  let registerTool: ((tool: ToolDefinition) => () => void) | undefined
  /** Disposer of the live `quiet_finish` registration, while armed. */
  let disposeTool: (() => void) | undefined
  /** Current configuration source: the settings scope while attached, the entry otherwise. */
  let source: () => QuietSettings = () => ({ mode: DEFAULT_MODE })

  const armed = (): boolean => mode !== 'normal'

  const quietFinish: ToolDefinition = {
    name: QUIET_FINISH_TOOL,
    description:
      'End the turn now. The next request is the finish step: thinking plus your closing answer only, no more tool calls.',
    parameters: { type: 'object', properties: {} },
    output: {
      schema: { type: 'object' },
      render: () => [],
    },
    execute: async (_args: unknown, exec) => {
      if (mode === 'silence') {
        // Silence ends the turn on the stop batch itself; there is no
        // one-shot to wait for, so the flag stays unset.
        exec.concludeTurn()
      } else {
        pendingFinish = true
      }
      return { stopped: true }
    },
  }

  /** Register or unregister `quiet_finish` to match the armed mode. */
  const syncTool = (): void => {
    if (armed()) {
      if (disposeTool === undefined && registerTool !== undefined) disposeTool = registerTool(quietFinish)
    } else {
      // A stop call never survives disarming: an un-armed turn is stock grammar.
      pendingFinish = false
      disposeTool?.()
      disposeTool = undefined
    }
  }

  ctx.inject(['tools'], (toolsCtx) => {
    registerTool = (tool: ToolDefinition) => toolsCtx.tools.register(tool)
    syncTool()
  })

  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, QUIET_SETTINGS_NAMESPACE, QuietSettingsSchema, { mode: DEFAULT_MODE }, {
      setSource: (current) => {
        source = current
      },
      onChange: () => {
        const next = normalizeQuietMode(source()[QUIET_MODE_FIELD])
        if (next === mode) return
        mode = next
        // Only quiet ever consumes the flag: leaving it (to silence or to
        // stock) drops a stop call that no one-shot will answer.
        if (next !== 'quiet') pendingFinish = false
        syncTool()
      },
    })
  })

  ctx.effect(() => () => {
    disposeTool?.()
    disposeTool = undefined
  }, 'ui-quiet: quiet_finish tool teardown')

  // The watermark stays subscribed for the plugin's lifetime and reads the
  // mode per step: a mode change takes effect from the next request without
  // any re-subscription, and a normal step passes the seed through unchanged.
  ctx.on('agent/request', (async (
    _payload: unknown,
    next: () => Promise<Record<string, unknown>>,
  ) => {
    const seed = await next()
    if (!armed()) return seed
    if (pendingFinish) {
      pendingFinish = false
      return { ...seed, toolChoice: 'none' }
    }
    return { ...seed, toolChoice: 'required', structuredOutput: EMPTY_OBJECT_SCHEMA }
    // oxlint-disable-next-line typescript/no-explicit-any -- cordis event map is registry-owned
  }) as any)
}
