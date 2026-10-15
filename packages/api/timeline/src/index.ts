/**
 * Timeline: the session-checkpoint `timeline` Remote namespace.
 *
 * Rows arrive host-side through {@link Timeline.publish} — the projection
 * owner that watches checkpoints feeds one ordered list per session — and
 * readers on any engine pull them back through the `timeline.history` and
 * `timeline.slice` remotes. The vscode web client's timeline plane consumes
 * the same rows over its `dsh/frame/checkpoint/timeline` downlink frames;
 * this namespace is the pull-side sibling both engines can read. Keeping
 * the store in one Service keeps the remote face honest: no reader ever
 * observes a row the publisher never wrote.
 * @module @deepseek-ai/dsh-api-timeline
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  TimelineHistory,
  TimelineHistoryRequest,
  TimelineRow,
  TimelineSlice,
  TimelineSliceRequest,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `timeline` Remote namespace. */
    timeline: Timeline
  }
}

/**
 * The host-side checkpoint row registry. The remote face is read-only;
 * publishers use {@link publish} and {@link clear} on this service directly.
 */
export class Timeline extends TypertRemoteService {
  static readonly inject: readonly string[] = []

  private readonly timelines = new Map<string, TimelineRow[]>()

  constructor(ctx: Context) {
    super(ctx, 'timeline')
  }

  /**
   * Replace one session's checkpoint rows (host-side publication).
   * @param sessionId - the session the rows belong to.
   * @param rows - the complete ordered row list for the session.
   */
  publish(sessionId: string, rows: readonly TimelineRow[]): void {
    this.timelines.set(sessionId, rows.map(row => ({ ...row })))
  }

  /** Drop one session's rows (session teardown). */
  clear(sessionId: string): void {
    this.timelines.delete(sessionId)
  }

  private rowsOf(sessionId: string): readonly TimelineRow[] {
    return this.timelines.get(sessionId) ?? []
  }

  /** Read one session's complete ordered checkpoint rows. */
  @Remote
  history(request: TimelineHistoryRequest, signal: AbortSignal): TimelineHistory {
    void signal
    return { sessionId: request.sessionId, rows: [...this.rowsOf(request.sessionId)] }
  }

  /** Read the rows at indexes `from` inclusive through `to` exclusive. */
  @Remote
  slice(request: TimelineSliceRequest, signal: AbortSignal): TimelineSlice {
    void signal
    if (
      !Number.isSafeInteger(request.from)
      || !Number.isSafeInteger(request.to)
      || request.from < 0
      || request.to < request.from
    ) {
      throw new RemoteError('gateway/bad-request', 'slice bounds must be safe integers with 0 <= from <= to', {})
    }
    return { rows: [...this.rowsOf(request.sessionId).slice(request.from, request.to)] }
  }
}

export default Timeline
