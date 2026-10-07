/**
 * Workspace snapshot timeline capture: a `tools/execute` bracket rescans the
 * pruned workspace after every dispatch, persists changed content into a
 * per-session content-addressed store, and appends `checkpoint/scan` rows
 * attributed to the call. The service also exposes the remote read/restore
 * surface the Web timeline consumes.
 * @module @deepseek-ai/dsh-checkpoint
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Session } from '@deepseek-ai/dsh-session'
// Type-only: resolve the `ctx.fs` and `ctx.sandboxPolicy` declarations.
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDispatchExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { CheckpointStore } from './store.ts'
import { SimpleIgnoreMatcher, diffStates, walkWorkspace, type ScanState } from './scan.ts'
import type { CheckpointRow, SnapshotDigest } from './types.ts'

export type * from './types.ts'
export { CheckpointStore, digestOf } from './store.ts'
export { SimpleIgnoreMatcher, diffStates, walkWorkspace } from './scan.ts'
export type { ScanState, ScannedStat } from './scan.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    checkpoint: CheckpointService
  }
}

/** Deployment choices for workspace timeline capture. */
export interface Config {
  /** Persist per-call snapshot rows and keep the restore surface mounted. */
  enabled: boolean
  /** Optional `DSH_HOME` override for the per-session object store root. */
  dshHome?: string
  /** Extra directory names pruned from every walk, beside `.git` and `node_modules`. */
  pruneExtra?: string[]
}

/** Schemastery config for the checkpoint consumer. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().required(),
  dshHome: z.string(),
  pruneExtra: z.array(z.string()),
})

/** Per-session rescan continuity state. */
interface SessionState {
  stat: ScanState
  after: Map<string, SnapshotDigest>
}

/**
 * Checkpoint capture service: brackets every dispatch with a pruned rescan,
 * retains post-state blobs per session, and serves the remote surface the
 * Web timeline renders and restores through.
 */
export class CheckpointService extends TypertRemoteService {
  static inject = ['tools', 'fs', 'sandboxPolicy', 'sessions']

  static Config: z<Config> = z.object({
    enabled: z.boolean().required(),
    dshHome: z.string(),
    pruneExtra: z.array(z.string()),
  })

  private readonly states = new WeakMap<Session, Promise<SessionState>>()
  private readonly stores = new Map<string, CheckpointStore>()
  private readonly extra: ReadonlySet<string>
  private readonly home: string

  constructor(ctx: Context, config: Config = { enabled: true }) {
    super(ctx, 'checkpoint')
    this.extra = new Set(config.pruneExtra ?? [])
    this.home = resolveDshHome(config.dshHome)
    if (!config.enabled) return
    this.mountCapture(ctx)
  }

  /**
   * The per-session object store, created on first capture.
   * @param sessionId - the owning session whose objects this store addresses.
   * @returns the store shared by every capture, read, and restore of that session.
   */
  private storeFor(sessionId: string): CheckpointStore {
    let store = this.stores.get(sessionId)
    if (store === undefined) {
      store = new CheckpointStore(join(this.home, 'checkpoints', 'v1', sessionId))
      this.stores.set(sessionId, store)
    }
    return store
  }

  /**
   * One session's continuity state, rehydrated from the store's frontier file
   * so a resumed process still derives truthful `before` digests.
   * @param session - the owning session.
   * @returns the continuity state, shared by every scan of this session.
   */
  private stateFor(session: Session): Promise<SessionState> {
    let pending = this.states.get(session)
    if (pending === undefined) {
      pending = this.storeFor(session.id).loadFrontier().then(after => ({ stat: new Map(), after }))
      this.states.set(session, pending)
    }
    return pending
  }

  /** Bracket every dispatch with a rescan and register the restore tool. */
  private mountCapture(ctx: Context): void {
    ctx.on('tools/execute', async (exec: ToolDispatchExecution, next: () => Promise<ToolExecutionResult>) => {
      const result = await next()
      await this.rescan(ctx, exec)
      return result
    })
    ctx.tools.register(defineTool({
      name: 'checkpoint_restore',
      description: 'Restore one workspace file to a recorded snapshot stop: the exact bytes captured for the given digest are written back through the fs capability.',
      parameters: {
        path: { type: 'string', required: true },
        digest: { type: 'string', required: true },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: `Restored ${String(value)}` }],
      },
      execute: async (args, exec) => {
        const query = args as { path: string; digest: string }
        if (exec.agent === undefined) throw new Error('checkpoint_restore requires an owning agent session')
        return await this.restoreBlob(exec.agent.session, query.path, query.digest, exec.signal)
      },
    }))
  }

  /**
   * Stat-walk the pruned workspace, digest and retain only changed paths,
   * and append one `checkpoint/scan` event when the call changed something.
   * Contained: a store or walk failure degrades to no event, never a failed
   * tool result — capture is observation, not policy.
   */
  private async rescan(ctx: Context, exec: ToolDispatchExecution): Promise<void> {
    if (exec.agent === undefined) return
    const session = exec.agent.session
    try {
      const policy = ctx.sandboxPolicy.resolve({ session })
      const root = policy.workspaceRoot
      const store = this.storeFor(session.id)
      const state = await this.stateFor(session)
      const gitignore = await readFile(join(root, '.gitignore'), 'utf8').catch(() => '')
      const fresh = await walkWorkspace(root, SimpleIgnoreMatcher.parse(gitignore), this.extra)
      const { added, changed, removed } = diffStates(state.stat, fresh)
      const rows: CheckpointRow[] = []
      for (const path of [...added, ...changed]) {
        let text: string
        try {
          text = await readFile(join(root, path), 'utf8')
        } catch {
          continue
        }
        const after = await store.put(text)
        const before = state.after.get(path) ?? undefined
        rows.push({
          path, callId: exec.callId, toolName: exec.name,
          ...exec.purpose !== undefined ? { purpose: exec.purpose } : {},
          ...before !== undefined ? { before } : {},
          after,
        })
        state.after.set(path, after)
      }
      for (const path of removed) {
        const before = state.after.get(path)
        rows.push({
          path, callId: exec.callId, toolName: exec.name,
          ...exec.purpose !== undefined ? { purpose: exec.purpose } : {},
          ...before === undefined ? {} : { before },
        })
        state.after.delete(path)
      }
      state.stat = fresh
      await store.saveFrontier(state.after)
      if (rows.length > 0) session.append('checkpoint/scan', { rows })
    } catch {
      // capture is observation-only; a failed sweep never fails the call
    }
  }

  /**
   * Write one retained blob back through the fs capability, the one restore
   * path shared by the model-facing tool and the timeline's remote surface.
   * @param session - the owning session whose store retains the blob.
   * @param path - workspace-relative file path to restore.
   * @param digest - digest recorded on the row being restored.
   * @param signal - caller cancellation, when one exists.
   * @returns the restored path.
   */
  private async restoreBlob(session: Session, path: string, digest: string, signal?: AbortSignal): Promise<string> {
    const text = await this.storeFor(session.id).read(digest as SnapshotDigest)
    if (text === null) throw new Error(`snapshot blob ${digest} is not retained for this session`)
    const target = await this.ctx.fs.resolve(path)
    await this.ctx.fs.writeText(target, text, undefined, signal)
    return path
  }

  /**
   * Restore one file to the exact bytes captured for a digest.
   * @param session - the owning session whose store retains the blob.
   * @param path - workspace-relative file path to restore.
   * @param digest - digest recorded on the row being restored.
   * @returns the restored path.
   */
  @Remote('restore')
  async restore(session: Session, path: string, digest: string): Promise<string> {
    return await this.restoreBlob(session, path, digest)
  }

  /**
   * One stop's retained text for the timeline's frozen diff view.
   * @param session - the owning session whose store retains the blob.
   * @param digest - digest recorded on the row.
   * @returns the stored text, or null when the object is absent.
   */
  @Remote('blob')
  async blob(session: Session, digest: string): Promise<string | null> {
    return await this.storeFor(session.id).read(digest as SnapshotDigest)
  }
}

export default CheckpointService
