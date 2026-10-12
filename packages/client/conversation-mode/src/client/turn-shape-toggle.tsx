/**
 * Turn-shape selector, browser half: one `Menu` on the composer input row
 * over Narrate, Quiet, and Tools only. The pill reads the current session's
 * `turnShape` projection, and a pick appends `turn-shape/mode` through the
 * `session.setTurnShape` Remote, so the arming is one session's logged state
 * — never a cross-session setting. The host half snapshots the shape per
 * turn, so a pick made while a turn streams applies from the next turn — and
 * the pill says so, instead of pretending the mid-turn change took effect.
 * Transcript semantics live in the ui-chat render contract; this control
 * only records the selection.
 */

import { useState, type ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the generated Remote session namespace typing.
import type { } from '@deepseek-ai/dsh-api-session-controller/remote'
import type { } from '@deepseek-ai/dsh-client-locale/client'
import type { } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { } from '@deepseek-ai/dsh-client-ui-session/client'
import {
  IconThinkOutline16, Menu, type MenuItem,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import css from './TurnShapeToggle.module.css'
import { DEFAULT_SHAPE, TURN_SHAPES, type TurnShape } from '../types.ts'
import { en, zh, type TurnShapeKey } from './locales.ts'

export { en, zh, type TurnShapeKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The turn-shape selector's copy (composer pill and menu). */
    'turn-shape': TurnShapeKey
  }
}

/** The shape's pill/menu label, localized. */
function shapeLabel(t: TranslateNS<'turn-shape'>, shape: TurnShape): string {
  switch (shape) {
    case 'narrate': return t('label.narrate')
    case 'quiet': return t('label.quiet')
    case 'tools': return t('label.tools')
  }
}

/** The shape's tooltip, localized. */
function shapeTitle(t: TranslateNS<'turn-shape'>, shape: TurnShape): string {
  switch (shape) {
    case 'narrate': return t('title.narrate')
    case 'quiet': return t('title.quiet')
    case 'tools': return t('title.tools')
  }
}

/** Bound Remote face owned by the plugin apply. */
export interface TurnShapeToggleFace {
  /** Append one `turn-shape/mode` selection to the session (fire-and-forget). */
  setShape(sessionId: SessionId, shape: TurnShape): void
}

/** Props the shape selector receives from the composer row slot. */
export type TurnShapeToggleProps = PropsRuntime<'conversation.input.right'>
  & PropsLocale<'turn-shape'>
  & {
    /** The bound Remote face owned by the plugin apply. */
    turnShape: TurnShapeToggleFace
  }

/** The Narrate/Quiet/Tools only selector riding the composer input row. */
export function TurnShapeToggle(props: TurnShapeToggleProps): ReactNode {
  const [open, setOpen] = useState(false)
  const projection = props.useProjection('turnShape')
  const shape = projection?.shape ?? DEFAULT_SHAPE
  const items: MenuItem[] = TURN_SHAPES.map(candidate => ({
    id: candidate,
    label: shapeLabel(props.t, candidate),
  }))
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={items}
      selectedId={shape}
      // The selector rides the composer row at the viewport bottom: the
      // list opens above the trigger and portals to fixed positioning,
      // clamped to the screen and re-positioned on scroll/resize.
      side="top"
      portal
      onSelect={(id) => {
        setOpen(false)
        // The menu ids ARE the shape strings; admit only them so nothing
        // outside the taxonomy reaches the session log.
        const next = TURN_SHAPES.find(turnShape => turnShape === id)
        if (next !== undefined) props.turnShape.setShape(props.sessionId, next)
      }}
      anchor={
        <button
          type="button"
          className={shape === 'narrate' ? css.toggle : `${css.toggle} ${css.on}`}
          aria-haspopup="menu"
          aria-expanded={open}
          title={shapeTitle(props.t, shape)}
          onClick={() => { setOpen(!open) }}
        >
          <IconThinkOutline16 />
          {shapeLabel(props.t, shape)}
        </button>
      }
    />
  )
}

/** Client plugin body. @param ctx - client root context. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('turn-shape', { zh, en }), 'conversation-mode: dictionaries')
  const sessionRemote = ctx.remote.session
  const turnShape: TurnShapeToggleFace = {
    setShape: (sessionId, shape) => {
      void sessionRemote.setTurnShape({ sessionId, shape }).then((result) => {
        if (!result.ok) {
          console.error(`session.setTurnShape failed: [${result.error.code}] ${result.error.message}`)
        }
      })
    },
  }
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register(
    { name: 'conversation.input.right', id: 'turn-shape-toggle', order: 5, locale: 'turn-shape' },
    (props: PropsRuntime<'conversation.input.right'> & PropsLocale<'turn-shape'>) =>
      TurnShapeToggle({ ...props, turnShape }),
  ))
}

export const inject = ['slots', 'locale', 'remote', 'remote.session']
