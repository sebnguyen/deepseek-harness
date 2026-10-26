/**
 * The sidebar toggle in the conversation header's corner seat.
 *
 * It is the one close control in normal presentation: the panel's own chrome
 * rides with the column, and while a surface (the VS Code workbench) owns the
 * column that surface's window sits over the panel's controls. The button stays
 * in the header in both states, so the way in and the way out are the same
 * corner. The panel draws its own collapse control only in fullscreen, where it
 * covers the conversation and this button is out of reach.
 *
 * The glyph is the left sidebar's collapse icon mirrored: the same affordance,
 * on the other edge. It shares the panel's per-session store, which the slot
 * runtime allows because both seats are session-scoped.
 */
import type { ReactNode } from 'react'
import { IconPanelLeftOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { createSidebarRightStore } from '../stores.ts'
import css from './SidebarToggle.module.css'

/** The toggle's props: the header corner seat, the shared store, and copy. */
export type SidebarToggleProps =
  & PropsRuntime<'conversation.session.header.corner'>
  & PropsStore<ReturnType<typeof createSidebarRightStore>>
  & PropsLocale<'sidebarRight'>

/** The header control that opens and closes the panel. */
export function SidebarToggle({ sessionId, useStore, actions, t }: SidebarToggleProps): ReactNode {
  // A session with no surface yet is collapsed: the panel seat materializes the
  // surface on its own mount, and until then there is nothing expanded.
  const expanded = useStore(state => state.bySession[sessionId]?.layout.expanded ?? false)
  return (
    <Tooltip label={t(expanded ? 'chrome.collapse' : 'chrome.expand')} side="bottom" delayMs={500}>
      <button
        type="button"
        className={css.button}
        aria-label={t(expanded ? 'chrome.collapseAria' : 'chrome.expandAria')}
        data-sidebar-right-header-toggle
        onClick={() => { actions.setExpanded(sessionId, !expanded) }}
      >
        <IconPanelLeftOutline16 className={css.icon} />
      </button>
    </Tooltip>
  )
}
