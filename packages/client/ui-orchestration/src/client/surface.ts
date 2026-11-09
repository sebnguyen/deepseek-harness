/** Pure selection policy for the orchestration mode's two Session panes. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'

/** A pair of Sessions to project side by side. */
export interface PeerPair {
  /** The session shown in the first pane. */
  readonly first: SessionId | undefined
  /** The session shown in the second pane. */
  readonly second: SessionId | undefined
  /** True when the pair is a direct parent/child relation. */
  readonly linked: boolean
}

/** Durable direct-child Session ids for a parent, in catalog order. */
export function childIds(state: SessionListState, parent: SessionId): readonly SessionId[] {
  const entries = state.subagentsByParent[parent]?.entries ?? []
  return entries.flatMap(entry => entry.kind === 'child' ? [entry.id] : [])
}

/**
 * Pick the two Sessions the mode should show. A current child projects its
 * parent beside itself; a current root projects its first direct child; a root
 * without children falls back to the next listed Session.
 * @param state - current browser Session list snapshot.
 * @returns the pair and whether it is a direct parent/child link.
 */
export function selectPeers(state: SessionListState): PeerPair {
  const current = state.current
  if (current === undefined) return { first: undefined, second: undefined, linked: false }

  const parent = state.byId[current]?.parentId
  if (parent !== undefined) return { first: parent, second: current, linked: true }

  const children = childIds(state, current)
  if (children[0] !== undefined) return { first: current, second: children[0], linked: true }

  return {
    first: current,
    second: state.ids.find(id => id !== current),
    linked: false,
  }
}
