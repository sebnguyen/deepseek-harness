/** Cross-package service and owner contracts for the layout-mode host. */
import type { ReactNode } from 'react'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { LayoutModeInfo } from '@deepseek-ai/dsh-client-ui-layout/client'

/** Global shell-mode control exposed as `ctx.layoutMode`. */
export interface LayoutModeService {
  /** Current phase/mode snapshot. */
  readonly info: HostObservable<LayoutModeInfo>
  /** Pin the window's mode; ignored once a choice is active. */
  select(mode: string): void
}

/** Registrant-private callbacks supplied to the host entry. */
export interface LayoutModeHostInjected {
  /** Pin a mode id; `default` returns the normal shell. */
  choose: (mode: string) => void
}

/** A registered mode receives the frame's one conversation renderer. */
export interface LayoutModeEntryOwnerProps {
  /** Render the keyed `main` conversation entry; the mode owns the placement. */
  renderConversation: () => ReactNode
  /** Render the shell's single sidebar, when the mode wants it beside its surface. */
  renderSidebar: () => ReactNode
}

/** Owner share of one choice card in the launch chooser. */
export interface LayoutModeOptionOwnerProps {
  /** Pin this card's mode id. */
  choose: (mode: string) => void
}
