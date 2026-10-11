/**
 * Turn-shape selector, browser half: one `Menu` on the composer input row
 * over Narrate, Quiet, and Tools only. The selector binds the shared
 * `ui-quiet` settings namespace through the settings scope and writes the
 * `turnShape` field; the host half snapshots the shape per turn, so a pick
 * made while a turn streams applies from the next turn — and the pill says
 * so, instead of pretending the mid-turn change took effect. Transcript
 * semantics live in the ui-chat render contract; this control only records
 * the preference.
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
import css from './TurnShapeToggle.module.css'
import {
  DEFAULT_SHAPE, TURN_SHAPES, TURN_SHAPE_FIELD, TURN_SHAPE_SETTINGS_NAMESPACE,
  normalizeTurnShape, type TurnShape, type TurnShapeSettings,
} from '../turn-shape-settings.ts'

/** Selector rows, one per turn shape. */
const SHAPE_ITEMS: MenuItem[] = [
  { id: 'narrate', label: 'Narrate' },
  { id: 'quiet', label: 'Quiet' },
  { id: 'tools', label: 'Tools only' },
]

/** Tooltip copy per shape, stated in transcript terms. */
const SHAPE_TITLES: Record<TurnShape, string> = {
  narrate: 'Narrate: thoughts, tools, and closing answers as usual',
  quiet: 'Quiet: thoughts and tool rows; closes with one plain answer. Applies to the next turn.',
  tools: 'Tools only: thoughts and tool rows; the turn ends without a summary. Applies to the next turn.',
}

/** Short labels for the composer pill. */
const SHAPE_LABELS: Record<TurnShape, string> = {
  narrate: 'Narrate',
  quiet: 'Quiet',
  tools: 'Tools only',
}

/**
 * The scope's surface as plain bound functions, built once at apply: the
 * scope's members are class methods, and handing them to
 * `useSyncExternalStore` detached would throw their `this` away at call
 * time — the selector would crash on first render.
 */
export interface TurnShapeScopeFace {
  /** Current sync snapshot (stable reference until the next change). */
  getSnapshot(): SettingsScopeSnapshot<TurnShapeSettings>
  /** Observe snapshot replacements. */
  subscribe(listener: () => void): () => void
  /** Write the turn shape to the shared namespace. */
  setShape(shape: TurnShape): void
}

/** Props the shape selector receives from the composer row slot. */
export interface TurnShapeToggleProps extends PropsRuntime<'conversation.input.right'> {
  /** The bound scope face owned by the plugin apply. */
  turnShape: TurnShapeScopeFace
}

/** The Narrate/Quiet/Tools only selector riding the composer input row. */
export function TurnShapeToggle(props: TurnShapeToggleProps): ReactNode {
  const [open, setOpen] = useState(false)
  const snapshot = useSyncExternalStore(props.turnShape.subscribe, props.turnShape.getSnapshot)
  const shape = normalizeTurnShape(snapshot.value ?? { turnShape: DEFAULT_SHAPE })
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={SHAPE_ITEMS}
      selectedId={shape}
      // The selector rides the composer row at the viewport bottom: the
      // list opens above the trigger and portals to fixed positioning,
      // clamped to the screen and re-positioned on scroll/resize.
      side="top"
      portal
      onSelect={(id) => {
        setOpen(false)
        // The menu ids ARE the shape strings; admit only them so nothing
        // outside the taxonomy reaches the shared namespace.
        const next = TURN_SHAPES.find(turnShape => turnShape === id)
        if (next !== undefined) props.turnShape.setShape(next)
      }}
      anchor={
        <button
          type="button"
          className={shape === 'narrate' ? css.toggle : `${css.toggle} ${css.on}`}
          aria-haspopup="menu"
          aria-expanded={open}
          title={SHAPE_TITLES[shape]}
          onClick={() => { setOpen(!open) }}
        >
          <IconThinkOutline16 />
          {SHAPE_LABELS[shape]}
        </button>
      }
    />
  )
}

/** Client plugin body. @param ctx - client root context. */
export function apply(ctx: ClientContext): void {
  const scope = ctx.settingsScope.bind<TurnShapeSettings>({ namespace: TURN_SHAPE_SETTINGS_NAMESPACE })
  const turnShape: TurnShapeScopeFace = {
    getSnapshot: () => scope.getSnapshot(),
    subscribe: listener => scope.subscribe(listener),
    setShape: (next) => { void scope.set(TURN_SHAPE_FIELD, next) },
  }
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register(
    { name: 'conversation.input.right', id: 'turn-shape-toggle', order: 5 },
    (props: PropsRuntime<'conversation.input.right'>) => TurnShapeToggle({ ...props, turnShape }),
  ))
}

export const inject = ['slots', 'settingsScope']
