/** Registrant-private callbacks the orchestration mode receives from its inject face. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Callbacks the mode component receives from the plugin's Cordis services. */
export interface OrchestrationModeInjected {
  /** Make a Session current without changing the layout panel. */
  openSession: (id: SessionId) => void
  /** Create a distinct blank Session and make it current. */
  createSession: () => Promise<SessionId>
  /** Retain a Session binding while a pane displays it; release on unmount. */
  retainSession: (id: SessionId) => () => void
  /** Refresh the direct-subagent catalog used by the handoff rail. */
  refreshSubagents: (parent: SessionId) => void
}
