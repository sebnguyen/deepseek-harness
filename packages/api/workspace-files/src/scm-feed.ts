/**
 * The scm push feed: observed writes inside a root a client has asked about
 * schedule one debounced re-walk, and its result crosses as
 * `workspaceFiles/scm-updated` so badges refresh without a Client round trip.
 * The walk itself runs off the Host loop in the provider; this feed only
 * decides *when* to ask.
 *
 * @module @deepseek-ai/dsh-api-workspace-files/scm-feed.ts
 */
import type { Context } from '@deepseek-ai/cordis'
import type { FsTarget } from '@deepseek-ai/dsh-fs'

/** True for the git seam's not-a-repository refusal. */
export function isNotRepository(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'GIT_NOT_REPOSITORY'
}

/**
 * Debounces `fs/observed` inside known roots into pushed scm refreshes.
 */
export class ScmFeed {
  private readonly roots = new Map<string, FsTarget>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  /**
   * @param ctx - Host context carrying the composed filesystem the observations name.
   * @param debounceMs - quiet window after the last observed write before the re-walk fires.
   */
  constructor(private readonly ctx: Context, private readonly debounceMs: number) {
    ctx.on('fs/observed', (target) => {
      for (const [root, resolved] of this.roots) {
        if (this.ctx.fs.contains(resolved, target)) this.schedule(root)
      }
    })
    ctx.effect(() => () => {
      for (const timer of this.timers.values()) clearTimeout(timer)
      this.timers.clear()
    }, 'workspace-files.scm-feed')
  }

  /**
   * Mark one root badge-relevant: observations inside it start scheduling
   * re-walks from then on.
   * @param workspaceRoot - session scope root a client queried.
   */
  remember(workspaceRoot: string): void {
    if (this.roots.has(workspaceRoot)) return
    void this.ctx.fs.resolve(workspaceRoot).then((resolved) => {
      this.roots.set(workspaceRoot, resolved)
    }).catch(() => {
      // A root the backend cannot resolve names nothing observable.
    })
  }

  private schedule(root: string): void {
    const held = this.timers.get(root)
    if (held !== undefined) clearTimeout(held)
    this.timers.set(root, setTimeout(() => {
      this.timers.delete(root)
      void this.refresh(root)
    }, this.debounceMs))
  }

  private async refresh(root: string): Promise<void> {
    const git = this.ctx.get('git')
    if (git === undefined) return
    try {
      const result = await git.status({ workspaceRoot: root })
      this.ctx.emit('workspaceFiles/scm-updated', root, {
        present: true, notRepository: false, head: result.head, entries: result.entries, truncated: result.truncated,
      })
    }
    catch (error: unknown) {
      // The root lost its repository since the client asked; anything else
      // (a mid-walk backend fault) leaves the client's last state untouched.
      if (isNotRepository(error)) {
        this.ctx.emit('workspaceFiles/scm-updated', root, {
          present: true, notRepository: true, head: null, entries: [], truncated: false,
        })
      }
    }
  }
}
