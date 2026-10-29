/**
 * Turbo shell mode: the shared sidebar beside a dynamic Mosaic tiling canvas.
 * Layout ownership is the Mosaic tree; Session ownership is the cell map in
 * TurboGrid. The mode itself owns no layout machinery.
 */
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TurboModeInjected } from './contract.ts'
import { TurboGrid } from './TurboGrid.tsx'
import css from './TurboMode.module.css'

type TurboModeProps =
  & PropsRuntime<'layout.mode.entry'>
  & PropsRenderSlots<never>
  & InjectFace<TurboModeInjected>
  & PropsLocale<'turbo'>

/** Render the Turbo mode. */
export function TurboMode({
  renderConversation, renderSidebar, useSessions, PinnedSessionProvider,
  createSession, openSession, retainSession, t,
}: TurboModeProps) {
  return (
    <div className={css.root}>
      <TurboGrid
        renderConversation={renderConversation}
        renderSidebar={renderSidebar}
        useSessions={useSessions}
        PinnedSessionProvider={PinnedSessionProvider}
        createSession={createSession}
        openSession={openSession}
        retainSession={retainSession}
        t={t}
      />
    </div>
  )
}
