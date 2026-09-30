/**
 * Tool-owned default mutation decider. It records every authoritative
 * `fs/observed` presence/absence observation in a session-keyed weak map and
 * supplies the waterfall DEFAULT for `fs/write-intent`: a loaded
 * `fs-observation-policy` listener keeps deciding first and these defaults never
 * run. Without the policy — observed present replaces at the observed version;
 * observed absent creates (or reports `FS_NOT_FOUND` for a program, which has no
 * content to patch); unobserved targets stat once — missing creates, an existing
 * program patches at a fresh basis (match-and-preserve, no flag needed), and an
 * existing content write needs the explicit `overwrite` flag or rejects
 * `FS_OVERWRITE_DENIED` at a fresh basis.
 * @module @deepseek-ai/dsh-tool-fs/src/gate
 */

import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsObservation, FsTarget, FsWriteIntent } from '@deepseek-ai/dsh-fs'

/**
 * Minimal structural view of a tool execution actor: the gate keys observed
 * state by `agent.session` identity, the same owner the policy plugin uses.
 */
interface ObservedActor {
  /** The agent on whose behalf the call runs, when there is one. */
  agent?: {
    /** The session that owns observed-file state, used as an opaque key. */
    session?: object
  }
}

/**
 * Observed-file state plus the default write-intent decision over it. One
 * instance per `apply()` so disposal can drop all state for HMR.
 */
export class ToolOwnedGate {
  /**
   * Observed-file state, keyed first by the owner object (weakly held, so a
   * collected session frees its state), then by {@link FsTarget.targetKey}.
   */
  private observed = new WeakMap<object, Map<string, FsObservation>>()

  constructor(private readonly ctx: Context) {}

  /**
   * Record authoritative observations; the listener contract requires this to
   * stay synchronous and non-throwing because successful mutations have already
   * committed when `fs/observed` fires.
   */
  registerObservedListener(): void {
    this.ctx.on('fs/observed', (target, observation, actor) => {
      const owner = this.owner(actor)
      if (owner === undefined) return
      let byTarget = this.observed.get(owner)
      if (byTarget === undefined) {
        byTarget = new Map()
        this.observed.set(owner, byTarget)
      }
      byTarget.set(target.targetKey, observation)
    })
  }

  /** Drop all recorded state (HMR safety / disposal). */
  clear(): void {
    this.observed = new WeakMap()
  }

  /**
   * Derive the observed-state owner from the opaque event actor — normally the
   * active agent session. `undefined` when no owner can be derived; such calls
   * fall through to the stat arms and can still pass with `overwrite`.
   */
  private owner(actor: object | undefined): object | undefined {
    // tsgolint treats object as assignable to weak ObservedActor, while tsc still requires the structural cast for property access.
    // See the analyzer-divergence consequence in .agents/notes/archived/process/2026-07-29-oxlint-linter.md.
    // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- The analyzers disagree on this weak type.
    return (actor as ObservedActor | undefined)?.agent?.session
  }

  /**
   * Default `fs/write-intent` decision over observed state and one stat for the
   * unobserved arm.
   * @param target - the write target resolved by the tool.
   * @param mode - `content` for whole-file writes, `program` for edits-only sed runs.
   * @param actor - the opaque execution actor the waterfall carries.
   * @param overwrite - the call's explicit clobber flag for unread content writes.
   * @param signal - abort signal for the unobserved-path stat.
   * @returns the provider write intent for the resolved arm.
   */
  async writeIntent(
    target: FsTarget,
    mode: 'content' | 'program',
    actor: object | undefined,
    overwrite: boolean,
    signal: AbortSignal,
  ): Promise<FsWriteIntent> {
    const owner = this.owner(actor)
    const prior = owner === undefined ? undefined : this.observed.get(owner)?.get(target.targetKey)
    if (prior?.kind === 'present') return { kind: 'replaceIfVersion', version: prior.version }
    if (prior?.kind === 'absent') {
      if (mode === 'program') {
        throw new FsError(`cannot edit "${target.displayPath}": not found`, 'FS_NOT_FOUND')
      }
      return { kind: 'createIfAbsent' }
    }
    const info = await this.ctx.fs.stat(target, signal)
    if (info === undefined) return { kind: 'createIfAbsent' }
    if (info.type !== 'file') {
      throw new FsError(`cannot write "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
    }
    if (mode === 'program') return { kind: 'replaceIfVersion', version: info.version }
    if (!overwrite) {
      throw new FsError(
        `cannot overwrite "${target.displayPath}": this session has not read it`,
        'FS_OVERWRITE_DENIED',
      )
    }
    return { kind: 'replaceIfVersion', version: info.version }
  }
}
