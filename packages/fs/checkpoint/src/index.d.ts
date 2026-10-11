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
import type { Session } from '@deepseek-ai/dsh-session'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { CheckpointSlot, CheckpointSlotPut, CheckpointSlotPutWire, CheckpointSlotTimeline, CheckpointTimeline } from './types.ts'
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
export declare const Config: z<Config>
/**
 * Checkpoint capture service: retains the before/after text of each committed
 * write and serves the remote surface the Web timeline renders and restores
 * through.
 */
export declare class CheckpointService extends TypertRemoteService {
  static inject: string[]
  static Config: z<Config>
  private readonly enabled
  private readonly stores
  private readonly home
  private readonly maxLabelBytes
  private readonly maxRetainedBytes
  constructor(ctx: Context, config: Config)
  /**
     * The per-session object store, created on first capture.
     * @param sessionId - the owning session whose objects this store addresses.
     * @returns the store shared by every capture, read, and restore of that session.
     */
  private storeFor
  /** Register the restore tool. Capture itself is {@link captureWrite}. */
  private mountCapture
  /**
     * Retain one committed write's before and after text and append one
     * `checkpoint/scan` row attributed to the call. A missing agent or a
     * disabled service records nothing. A store failure records nothing and
     * does not reject: the file write has already committed.
     * @param call - the write call this file belongs to.
     * @param file - the path and the before/after text the write already holds.
     */
  captureWrite(call: {
    readonly agent?: {
      readonly session: Session
    }
    readonly callId: string
    readonly name: string
    readonly purpose?: string
  }, file: {
      readonly path: string
      readonly before: string | null
      readonly after: string
    }): Promise<void>
  /**
     * Store one write's texts and append its row.
     * @param session - the owning session.
     * @param call - the write call this file belongs to.
     * @param file - the path and the before/after text.
     */
  private retainWrite
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
  putSlot(session: Session, slot: CheckpointSlotPut): Promise<CheckpointSlot>
  /**
     * Append the release tombstone for one slot: views fold the slot absent and
     * the row stays, so mentions that already serialized keep resolving.
     * Releasing an absent slot or a released one appends a redundant tombstone;
     * the fold treats both the same. A disabled service appends nothing.
     * @param session - the owning session whose register the tombstone joins.
     * @param slotId - the slot the producer is releasing.
     */
  releaseSlot(session: Session, slotId: string): Promise<void>
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
  slots(session: Session, path?: string): Promise<CheckpointSlotTimeline[]>
  /**
     * The Web producer path over the register: the same append as the host idiom
     * with its byte bounds enforced at `putSlot`.
     * @param session - the owning session whose register the slot joins.
     * @param slot - the producer-minted slot, as `putSlot` takes it.
     * @returns the persisted slot.
     */
  putSlotRemote(session: Session, slot: CheckpointSlotPutWire): Promise<CheckpointSlot>
  /**
     * The Web release path over the register: appends the tombstone row.
     * @param session - the owning session whose register the tombstone joins.
     * @param slotId - the slot the producer is releasing.
     */
  releaseSlotRemote(session: Session, slotId: string): Promise<void>
  /**
     * Write one retained blob back through the fs capability, the one restore
     * path shared by the model-facing tool and the timeline's remote surface.
     * @param session - the owning session whose store retains the blob.
     * @param path - workspace-relative file path to restore.
     * @param digest - digest recorded on the row being restored.
     * @param signal - caller cancellation, when one exists.
     * @returns the restored path.
     */
  private restoreBlob
  /**
     * Restore one file to the exact bytes captured for a digest.
     * @param session - the owning session whose store retains the blob.
     * @param path - workspace-relative file path to restore.
     * @param digest - digest recorded on the row being restored.
     * @returns the restored path.
     */
  restore(session: Session, path: string, digest: string): Promise<string>
  /**
     * One file's retained stops for the frozen Changes display and the `@`
     * picker: `checkpoint/scan` rows joined to the `tool/call` that stated
     * their turn and step, oldest first, paths in path order. Row paths rooted
     * at the session working directory fold relative, like the client fold.
     * @param session - the owning session whose log is folded.
     * @param path - when set, only this session-relative path is returned.
     * @returns every timeline the session captured, folded like the client fold.
     */
  stops(session: Session, path?: string): Promise<CheckpointTimeline[]>
  /**
     * One stop's retained text for the timeline's frozen diff view.
     * @param session - the owning session whose store retains the blob.
     * @param digest - digest recorded on the row.
     * @returns the stored text, or null when the object is absent.
     */
  blob(session: Session, digest: string): Promise<string | null>
}
export default CheckpointService
//# sourceMappingURL=index.d.ts.map
