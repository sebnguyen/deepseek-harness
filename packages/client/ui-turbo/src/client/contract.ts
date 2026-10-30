/** Cross-package service and inject faces for the Turbo layout mode. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

/** Where a Turbo-created Session inherits its location from. */
export interface TurboSessionTarget {
  /** Explicit Workspace target from a browser group action. */
  workspaceId?: WorkspaceId
  /** Source Session whose owning Workspace is reused when it has one. */
  sourceSessionId?: SessionId
  /** Directory to use when no owning Workspace is known. */
  cwd?: string
}

/** Resolved create options for a Turbo-created Session. */
export interface TurboCreateTarget {
  /** Owning Workspace: the host creates the Session at its path and attaches it. */
  workspaceId?: WorkspaceId
  /** Directory to use when no owning Workspace is known. */
  cwd?: string
}

/** The Workspace row fields Turbo creation policy reads. */
export interface WorkspaceOwner {
  /** Owning Workspace identity. */
  readonly workspaceId: WorkspaceId
  /** Sessions accounted to the Workspace. */
  readonly sessionIds: readonly SessionId[]
}

/**
 * Resolve where a Turbo-created Session goes: the Workspace that accounts for
 * the source Session, otherwise the inherited directory, otherwise the
 * Workspace the sidebar New Session would inherit.
 * @param workspaces - live Workspace rows.
 * @param target - inherited source Session and directory.
 * @param defaultWorkspaceId - Workspace a New Session inherits when the target names none.
 * @returns create options, or undefined to let the host use its default.
 */
export function createTarget(
  workspaces: readonly WorkspaceOwner[],
  target: TurboSessionTarget | undefined,
  defaultWorkspaceId?: WorkspaceId,
): TurboCreateTarget | undefined {
  if (target?.workspaceId !== undefined) return { workspaceId: target.workspaceId }
  const source = target?.sourceSessionId
  if (source !== undefined) {
    const owner = workspaces.find(item => item.sessionIds.includes(source))
    if (owner !== undefined) return { workspaceId: owner.workspaceId }
  }
  if (target?.cwd !== undefined) return { cwd: target.cwd }
  return defaultWorkspaceId === undefined ? undefined : { workspaceId: defaultWorkspaceId }
}

/** Registrant-private callbacks the mode component receives from its inject face. */
export interface TurboModeInjected {
  /** Create a distinct Session, inheriting the target Workspace or directory. */
  createSession: (target?: TurboSessionTarget) => Promise<SessionId>
  /** Make a Session current without changing the layout panel. */
  openSession: (id: SessionId) => void
  /** Clear the current Session selection so a closed provisional cell stays closed. */
  clearSession: () => void
  /** Retain a Session binding while a cell displays it; release on reassign/unmount. */
  retainSession: (id: SessionId) => () => void
}
