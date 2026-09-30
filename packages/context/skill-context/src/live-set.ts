/**
 * Live skill read: which skill bodies the model's window currently holds.
 *
 * The window is read through `Session.deriveMessages()`, the sanctioned derived
 * read. The surface is the single source of derived history, so a compaction
 * `replace` deletes the shadowed nodes from the derivation and each surface
 * node is projected exactly once, which makes a call cost O(new nodes) rather
 * than a history scan. The synchronous arbitrary-position readers —
 * `Session.eventAt()`, `Session.snapshotEvents()`, and `Session.ownEvents()` —
 * are deprecated with new calls prohibited
 * ([session event reads](../../../../.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md)),
 * so this module reads derived messages instead of resolving event positions.
 *
 * @module @deepseek-ai/dsh-skill-context/live-set
 */

import type { Session } from '@deepseek-ai/dsh-session'

/**
 * Skill names whose bodies the model's current window holds.
 *
 * A skill already in this set must not be emitted again. Every producer of a
 * skill body — the `/name` gesture and any judgment-driven admission — commits
 * the same source kind, so a hand-loaded skill counts as live too.
 *
 * @param session - the calling agent's session.
 * @returns distinct skill names, in window order.
 */
export function liveSkillNames(session: Session): Set<string> {
  const live = new Set<string>()
  for (const message of session.deriveMessages()) {
    if (message.source.kind !== 'skill-invocation') continue
    live.add(message.source.name)
  }
  return live
}
