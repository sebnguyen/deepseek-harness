/**
 * Quiet mode, browser half: the mode selector on the composer input row,
 * left of model selection — one `Button` opening the primitives `Menu`
 * over Normal, Quiet, and Silence. The selector binds the shared
 * `ui-quiet` settings namespace through the settings scope and writes
 * the `mode` field; the node half arms its request waterfall and the
 * `quiet_finish` tool from that same namespace, so picking a mode
 * reaches the enforcement half live. Transcript semantics live
 * elsewhere: working steps are grammar-forced tool-only by the node
 * half, empty answer content renders no row (stock AssistantNodeView
 * guard), quiet's closing answer arrives from the tool-free finish
 * one-shot, and silence ends the turn on the stop call instead. Thoughts
 * keep the stock fold and tools keep the stock cards; no summary node
 * exists anywhere. Seam map: design/quiet-mode-plugin.md.
 */

import { useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {
  SettingsScopeSnapshot,
} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  IconThinkOutline16, Menu, type MenuItem,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './QuietToggle.module.css'
import {
  DEFAULT_MODE, QUIET_MODES, QUIET_MODE_FIELD, QUIET_SETTINGS_NAMESPACE,
  normalizeQuietMode, type QuietMode, type QuietSettings,
} from '../quiet-settings.ts'

/** Selector rows, one per grammar mode. */
const MODE_ITEMS: MenuItem[] = [
  { id: 'normal', label: 'Normal' },
  { id: 'quiet', label: 'Quiet' },
  { id: 'silence', label: 'Silence' },
]

/** Tooltip copy per mode, carried by the selector button. */
const MODE_TITLES: Record<QuietMode, string> = {
  normal: 'Normal mode: stock transcript grammar',
  quiet: 'Quiet mode: tool-only working steps, closing answer at turn end',
  silence: 'Silence mode: tool-only working steps, no closing-answer call',
}

/**
 * The scope's surface as plain bound functions, built once at apply: the
 * scope's members are class methods, and handing them to
 * `useSyncExternalStore` detached would throw their `this` away at call
 * time — the selector would crash on first render.
 */
export interface QuietScopeFace {
  /** Current sync snapshot (stable reference until the next change). */
  getSnapshot(): SettingsScopeSnapshot<QuietSettings>
  /** Observe snapshot replacements. */
  subscribe(listener: () => void): () => void
  /** Write the grammar mode to the shared namespace. */
  setMode(mode: QuietMode): void
}

/** Props the mode selector receives from the composer row slot. */
export interface QuietToggleProps extends PropsRuntime<'conversation.input.right'> {
  /** The bound scope face owned by the plugin apply. */
  quiet: QuietScopeFace
}

/** The Normal/Quiet/Silence selector riding the composer input row. */
export function QuietToggle(props: QuietToggleProps): ReactNode {
  const [open, setOpen] = useState(false)
  const snapshot = useSyncExternalStore(props.quiet.subscribe, props.quiet.getSnapshot)
  const mode = normalizeQuietMode(snapshot.value?.mode ?? DEFAULT_MODE)
  const label = QUIET_MODES.find(id => id === mode) ?? DEFAULT_MODE
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={MODE_ITEMS}
      selectedId={mode}
      // The selector rides the composer row at the viewport bottom: the
      // list opens above the trigger and portals to fixed positioning,
      // clamped to the screen and re-positioned on scroll/resize.
      side="top"
      portal
      onSelect={(id) => {
        setOpen(false)
        // The menu ids ARE the mode strings; admit only them so nothing
        // outside the taxonomy reaches the shared namespace.
        const next = QUIET_MODES.find(mode => mode === id)
        if (next !== undefined) props.quiet.setMode(next)
      }}
      anchor={
        <button
          type="button"
          className={mode === 'normal' ? css.toggle : `${css.toggle} ${css.on}`}
          aria-haspopup="menu"
          aria-expanded={open}
          title={MODE_TITLES[mode]}
          onClick={() => { setOpen(!open) }}
        >
          <IconThinkOutline16 />
          {label.charAt(0).toUpperCase()}{label.slice(1)}
        </button>
      }
    />
  )
}

/** Client plugin body. @param ctx - client root context. */
export function apply(ctx: ClientContext): void {
  const scope = ctx.settingsScope.bind<QuietSettings>({ namespace: QUIET_SETTINGS_NAMESPACE })
  const quiet: QuietScopeFace = {
    getSnapshot: () => scope.getSnapshot(),
    subscribe: listener => scope.subscribe(listener),
    setMode: (next) => { void scope.set(QUIET_MODE_FIELD, next) },
  }
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register(
    { name: 'conversation.input.right', id: 'quiet-toggle', order: 5 },
    (props: PropsRuntime<'conversation.input.right'>) => QuietToggle({ ...props, quiet }),
  ))
}

export const inject = ['slots', 'settingsScope']
