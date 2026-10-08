/**
 * Workspace snapshot timeline capture: each committed `write` hands this
 * service the file's before and after text. Those bytes are stored by digest
 * and appended as one `checkpoint/scan` row for that file. Beside the rows the
 * service owns the slot register — one append-only, undeletable store row
 * family per session keyed by file, which producers (the worktree capture and
 * client plugins) write through `putSlot` and clients read through `slots`.
 * The service also exposes the remote read/restore surface the Web timeline
 * consumes.
 * @module @deepseek-ai/dsh-checkpoint
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { join } from 'node:path'
import type { Session } from '@deepseek-ai/dsh-session'
// Type-only: resolve the `ctx.fs` and `ctx.sandboxPolicy` declarations.
import type { } from '@deepseek-ai/dsh-fs'
import type { } from '@deepseek-ai/dsh-sandbox-policy'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { relativizeToCwd } from '@deepseek-ai/dsh-util-workspace-path'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { CheckpointStore } from './store.ts'
import type { CheckpointSlot, CheckpointSlotId, CheckpointSlotPut, CheckpointSlotPutWire, CheckpointSlotTimeline, CheckpointStop, CheckpointTimeline, SnapshotDigest } from './types.ts'

export type * from './types.ts'
export { CheckpointStore, digestOf } from './store.ts'
export type { FrontierRecord, FrontierSnapshot } from './store.ts'
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
  /** Byte bound of one register slot's label. */
  maxLabelBytes: number
  /** Byte bound of one register slot's retained text. */
  maxRetainedBytes: number
}

/** Schemastery config for the checkpoint consumer. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().required(),
  dshHome: z.string(),
  maxLabelBytes: z.number().step(1).min(1).required(),
  maxRetainedBytes: z.number().step(1).min(1).required(),
})

/** One committed write's bytes and the call it belongs to. Not part of the remote surface. */
interface CapturedWrite {
  readonly path: string
  readonly before: string | null
  readonly after: string
}

/** The call a captured write is attributed to. */
interface CapturedWriteCall {
  readonly agent?: { readonly session: Session }
  readonly callId: string
  readonly name: string
  readonly purpose?: string
}

/**
 * Checkpoint capture service: retains the before/after text of each committed
 * write and serves the remote surface the Web timeline renders and restores
 * through.
 */
export class CheckpointService extends TypertRemoteService {
  static inject = ['tools', 'fs', 'sandboxPolicy', 'sessions']

  static Config = Config

  private readonly enabled: boolean
  private readonly stores = new Map<string, CheckpointStore>()
  private readonly home: string
  private readonly maxLabelBytes: number
  private readonly maxRetainedBytes: number

  constructor(ctx: Context, config: Config) {
    super(ctx, 'checkpoint')
    this.enabled = config.enabled
    this.home = resolveDshHome(config.dshHome)
    this.maxLabelBytes = config.maxLabelBytes
    this.maxRetainedBytes = config.maxRetainedBytes
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

  /** Register the restore tool. Capture itself is {@link captureWrite}. */
  private mountCapture(ctx: Context): void {
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
   * Retain one committed write's before and after text and append one
   * `checkpoint/scan` row attributed to the call. A missing agent or a
   * disabled service records nothing. A store failure records nothing and
   * does not reject: the file write has already committed.
   * @param call - the write call this file belongs to.
   * @param file - the path and the before/after text the write already holds.
   */
  async captureWrite(
    call: { readonly agent?: { readonly session: Session }; readonly callId: string; readonly name: string; readonly purpose?: string },
    file: { readonly path: string; readonly before: string | null; readonly after: string },
  ): Promise<void> {
    if (!this.enabled || call.agent === undefined) return
    try {
      await this.retainWrite(call.agent.session, call, file)
    } catch {
      // retainWrite throws only when the object store cannot create or write a blob.
    }
  }

  /**
   * Store one write's texts and append its row.
   * @param session - the owning session.
   * @param call - the write call this file belongs to.
   * @param file - the path and the before/after text.
   */
  private async retainWrite(session: Session, call: CapturedWriteCall, file: CapturedWrite): Promise<void> {
    const store = this.storeFor(session.id)
    const before = file.before === null ? undefined : await store.put(file.before)
    const after = await store.put(file.after)
    session.append('checkpoint/scan', {
      rows: [{
        path: relativizeToCwd(file.path, session.header.cwd),
        callId: call.callId as ToolCallId,
        toolName: call.name,
        ...call.purpose !== undefined ? { purpose: call.purpose } : {},
        ...before !== undefined ? { before } : {},
        after,
      }],
    })
    // The worktree producer: the same capture rows into the register, its
    // slotId reusing the call id so the shipped `@path#turn#call-id` grammar
    // resolves by filtering the register. `checkpoint/scan` keeps emitting
    // until the last stops consumer retires.
    await this.putSlot(session, {
      slotId: call.callId,
      kind: 'worktree',
      path: file.path,
      label: call.purpose ?? call.name,
      callId: call.callId,
      ...before !== undefined ? { before } : {},
      after,
      detail: { toolName: call.name },
    })
  }

  /**
   * Append one slot to the session's register and return the persisted row.
   * Throws when a label or retained text exceeds its configured byte bound,
   * when the minted id already has a row, or when the retained text cannot be
   * stored; `retained`, when present, is hashed into the blob store and wins
   * over an explicit `after`. The register is append-only; release is the one
   * hide mechanism and it appends too. Not a Remote method: a failing put must
   * reject its caller, the opposite of `captureWrite`'s observation posture.
   * @param session - the owning session whose register the slot joins.
   * @param slot - the producer-minted id, kind, path, label, optional scopes,
   * digests, retained text, and per-kind detail.
   * @returns the persisted slot, path relativized to the session cwd.
   */
  async putSlot(session: Session, slot: CheckpointSlotPut): Promise<CheckpointSlot> {
    if (!this.enabled) throw new Error('checkpoint slots are disabled')
    if (Buffer.byteLength(slot.label, 'utf8') > this.maxLabelBytes) {
      throw new Error(`slot label exceeds the configured ${this.maxLabelBytes}-byte bound`)
    }
    const store = this.storeFor(session.id)
    const rows = await store.loadSlotRows()
    if (rows.some(row => row.slotId === slot.slotId)) {
      throw new Error(`slot ${slot.slotId} already exists in this session's register`)
    }
    let after = slot.after
    if (slot.retained !== undefined) {
      if (Buffer.byteLength(slot.retained, 'utf8') > this.maxRetainedBytes) {
        throw new Error(`slot retained text exceeds the configured ${this.maxRetainedBytes}-byte bound`)
      }
      after = await store.put(slot.retained)
    }
    const record: CheckpointSlot = {
      slotId: slot.slotId as CheckpointSlotId,
      kind: slot.kind,
      path: relativizeToCwd(slot.path, session.header.cwd),
      label: slot.label,
      ...slot.turn !== undefined ? { turn: slot.turn } : {},
      ...slot.callId !== undefined ? { callId: slot.callId } : {},
      ...slot.line !== undefined ? { line: slot.line } : {},
      ...slot.before !== undefined ? { before: slot.before } : {},
      ...after !== undefined ? { after } : {},
      createdAt: Date.now(),
      detail: slot.detail,
    }
    await store.appendSlotRow(record)
    return record
  }

  /**
   * Append the release tombstone for one slot: views fold the slot absent and
   * the row stays, so mentions that already serialized keep resolving.
   * Releasing an absent slot or a released one appends a redundant tombstone;
   * the fold treats both the same. A disabled service appends nothing.
   * @param session - the owning session whose register the tombstone joins.
   * @param slotId - the slot the producer is releasing.
   */
  async releaseSlot(session: Session, slotId: string): Promise<void> {
    if (!this.enabled) return
    await this.storeFor(session.id).appendSlotRow({ slotId: slotId as CheckpointSlotId, released: true })
  }

  /**
   * The register as a file-to-live-slot map, oldest first, paths in path order:
   * `slots.jsonl` rows folded over tombstones, with each slot's turn joined
   * from its `tool/call` event when the producer stamped none. Register state
   * is store-only: the fold reads no slot event, and a session whose log never
   * mentions slots still lists them after a restart.
   * @param session - the owning session whose register is folded.
   * @param path - when set, only this session-relative path is returned.
   * @returns every file that holds live slots.
   */
  @Remote('slots')
  async slots(session: Session, path?: string): Promise<CheckpointSlotTimeline[]> {
    const cwd = session.header.cwd
    const turns = new Map<string, number>()
    for (const event of session.ownEvents()) {
      if (event.type === 'tool/call') turns.set(event.data.callId, event.data.turn)
    }
    const live = new Map<string, CheckpointSlot>()
    const released = new Set<string>()
    for (const record of await this.storeFor(session.id).loadSlotRows()) {
      if (record.released === true) released.add(record.slotId)
      else if (!live.has(record.slotId)) live.set(record.slotId, record)
    }
    const timelines = new Map<string, CheckpointSlot[]>()
    for (const slot of live.values()) {
      if (released.has(slot.slotId)) continue
      const slotPath = relativizeToCwd(slot.path, cwd)
      if (path !== undefined && slotPath !== path) continue
      const turn = slot.turn ?? (slot.callId !== undefined ? turns.get(slot.callId) : undefined)
      const folded = turn === undefined ? slot : { ...slot, turn }
      const list = timelines.get(slotPath)
      if (list === undefined) timelines.set(slotPath, [folded])
      else list.push(folded)
    }
    return [...timelines]
      .map(([timelinePath, slots]) => ({ path: timelinePath, slots: slots as readonly CheckpointSlot[] }))
      .sort((left, right) => left.path.localeCompare(right.path))
  }

  /**
   * The Web producer path over the register: the same append as the host idiom
   * with its byte bounds enforced at `putSlot`.
   * @param session - the owning session whose register the slot joins.
   * @param slot - the producer-minted slot, as `putSlot` takes it.
   * @returns the persisted slot.
   */
  @Remote('slotPut')
  async putSlotRemote(session: Session, slot: CheckpointSlotPutWire): Promise<CheckpointSlot> {
    const { after, detail, ...rest } = slot
    return await this.putSlot(session, {
      ...rest,
      detail,
      ...after !== undefined ? { after: after as SnapshotDigest } : {},
    })
  }

  /**
   * The Web release path over the register: appends the tombstone row.
   * @param session - the owning session whose register the tombstone joins.
   * @param slotId - the slot the producer is releasing.
   */
  @Remote('slotRelease')
  async releaseSlotRemote(session: Session, slotId: string): Promise<void> {
    await this.releaseSlot(session, slotId)
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
   * One file's retained stops for the frozen Changes display and the `@`
   * picker: `checkpoint/scan` rows joined to the `tool/call` that stated
   * their turn and step, oldest first, paths in path order. Row paths rooted
   * at the session working directory fold relative, like the client fold.
   * @param session - the owning session whose log is folded.
   * @param path - when set, only this session-relative path is returned.
   * @returns every timeline the session captured, folded like the client fold.
   */
  @Remote('stops')
  async stops(session: Session, path?: string): Promise<CheckpointTimeline[]> {
    const cwd = session.header.cwd
    const calls = new Map<string, { turn: number; step: number; purpose?: string }>()
    const timelines = new Map<string, CheckpointStop[]>()
    for (const event of session.ownEvents()) {
      if (event.type === 'tool/call') {
        calls.set(event.data.callId, {
          turn: event.data.turn,
          step: event.data.step,
          ...event.data.purpose === undefined ? {} : { purpose: event.data.purpose },
        })
        continue
      }
      if (event.type !== 'checkpoint/scan') continue
      for (const row of event.data.rows) {
        const rowPath = relativizeToCwd(row.path, cwd)
        if (path !== undefined && rowPath !== path) continue
        const facts = calls.get(row.callId)
        const purpose = row.purpose ?? facts?.purpose
        const stop: CheckpointStop = {
          seq: event.seq,
          time: event.time,
          callId: row.callId,
          toolName: row.toolName,
          ...purpose === undefined ? {} : { purpose },
          ...facts === undefined ? {} : { turn: facts.turn, step: facts.step },
          ...row.before === undefined ? {} : { before: row.before },
          ...row.after === undefined ? {} : { after: row.after },
        }
        const list = timelines.get(rowPath)
        if (list === undefined) timelines.set(rowPath, [stop])
        else list.push(stop)
      }
    }
    return [...timelines]
      .map(([timelinePath, stops]) => ({ path: timelinePath, stops: stops as readonly CheckpointStop[] }))
      .sort((left, right) => left.path.localeCompare(right.path))
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
