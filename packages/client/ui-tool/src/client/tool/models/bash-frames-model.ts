/** Pure per-frame card derivation from a batched `bash` call and its rendered sections. @module */
import type { ToolCallBlock } from './tool-call-model.ts'
import { parsedToolCall, singleResultText } from './raw-tool-call.ts'

/** One pending batch element as the call authored it. */
export interface FramesCommand {
  command: string
  /** Element workdir override, as authored. */
  workdir?: string
}

/** A settled element whose section renders as its own terminal block. */
export interface FramesForegroundCard {
  kind: 'foreground'
  command: string
  workdir: string | undefined
  /** Section body without the `[i/N] $ command` header and trailing status marker. */
  output: string
  /** Settled non-zero exit code parsed off the section's trailing marker; absent on a clean exit. */
  exitCode?: number
  /** Settled terminating signal parsed off the section's trailing marker. */
  signal?: string
  /** Element wall time persisted by the tool's presentationMeta; absent on replay of older results. */
  durationMs?: number
}

/** A settled element whose frame is a wire acknowledgement line, not process output. */
export interface FramesDetachedCard {
  kind: 'job' | 'not-run'
  command: string
  /** Background job id parsed off the acknowledgement line; absent for `not-run`. */
  jobId: string | undefined
  /** Skip reason parsed off the `[not run: …]` line; absent for `job`. */
  reason: string | undefined
}

/** One element's card material. */
export type FramesCard = FramesForegroundCard | FramesDetachedCard

/** Frames-row material: the pending command list or the settled per-element cards. */
export type BashFramesModel =
  | { kind: 'pending'; commands: readonly FramesCommand[] }
  | { kind: 'settled'; frames: readonly FramesCard[]; failed: boolean }

function batchCommands(args: Record<string, unknown>): FramesCommand[] | null {
  const { commands } = args
  if (!Array.isArray(commands) || commands.length === 0) return null
  const list: FramesCommand[] = []
  for (const element of commands) {
    if (typeof element !== 'object' || element === null || Array.isArray(element)) return null
    const record = element as Record<string, unknown>
    if (typeof record.command !== 'string' || record.command.trim() === '') return null
    if (record.workdir !== undefined && typeof record.workdir !== 'string') return null
    list.push(record.workdir === undefined
      ? { command: record.command }
      : { command: record.command, workdir: record.workdir })
  }
  return list
}

function metaDurations(block: ToolCallBlock): readonly (number | undefined)[] | undefined {
  if (!('kind' in block)) return undefined
  if (typeof block.meta !== 'object' || block.meta === null || Array.isArray(block.meta)) return undefined
  const frames = (block.meta as Record<string, unknown>).frames
  if (!Array.isArray(frames)) return undefined
  return frames.map((frame): number | undefined => {
    if (typeof frame !== 'object' || frame === null || Array.isArray(frame)) return undefined
    const durationMs = (frame as Record<string, unknown>).durationMs
    return typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : undefined
  })
}

const SIGNAL_MARKER = /\n\[killed by signal: ([^\]\n]+)\]$/
const EXIT_MARKER = /\n\[exit code: (\d+)\]$/
const JOB_LINE = /^started background job (\S+)$/
const NOT_RUN_LINE = /^\[not run: ([^\]]*)\]$/

/**
 * Derive the per-element cards of a batched `bash` call. The single result text
 * is split at the `[i/N] $ command` headers rebuilt from the call arguments —
 * the anchor grammar the frames renderer emits and the terminal card's marker
 * parse already reads locally — so each element keeps its own output, exit
 * status, and persisted duration. Non-frames calls, failures, and any text the
 * grammar does not line up with return null so the render site keeps the
 * single-exit bash row.
 * @param block - running or settled Tool block.
 * @returns frames-row material, or null for the fallback row.
 */
export function bashFramesModel(block: ToolCallBlock): BashFramesModel | null {
  if (block.parentCallId !== undefined) return null
  const parsed = parsedToolCall(block)
  if (parsed === null || parsed.name !== 'bash') return null
  const commands = batchCommands(parsed.args)
  if (commands === null) return null
  if (!('kind' in block)) return { kind: 'pending', commands }
  if (block.isError) return null
  const content = singleResultText(block)
  if (content === undefined) return null
  const durations = metaDurations(block)
  const headers = commands.map((element, index) => `[${index + 1}/${commands.length}] $ ${element.command}`)
  const starts: number[] = []
  let from = 0
  for (const header of headers) {
    const at = content.indexOf(header, from)
    if (at === -1) return null
    starts.push(at)
    from = at + 1
  }
  const frames: FramesCard[] = []
  let failed = false
  for (const [index, element] of commands.entries()) {
    const start = starts[index]
    const header = headers[index]
    if (start === undefined || header === undefined) return null
    const bodyStart = start + header.length + 1
    const next = starts[index + 1]
    const body = content.slice(bodyStart, next === undefined ? content.length : next - 1)
    const durationMs = durations?.[index]
    const job = JOB_LINE.exec(body)
    if (job?.[1] !== undefined) {
      frames.push({ kind: 'job', command: element.command, jobId: job[1], reason: undefined })
      continue
    }
    const skipped = NOT_RUN_LINE.exec(body)
    if (skipped?.[1] !== undefined) {
      frames.push({ kind: 'not-run', command: element.command, jobId: undefined, reason: skipped[1] })
      continue
    }
    const signal = SIGNAL_MARKER.exec(body)
    if (signal?.[1] !== undefined) {
      failed = true
      frames.push({
        kind: 'foreground', command: element.command, workdir: element.workdir,
        output: body.slice(0, signal.index), signal: signal[1], ...durationMs !== undefined ? { durationMs } : {},
      })
      continue
    }
    const exit = EXIT_MARKER.exec(body)
    if (exit?.[1] !== undefined) {
      const exitCode = Number(exit[1])
      if (exitCode !== 0) failed = true
      frames.push({
        kind: 'foreground', command: element.command, workdir: element.workdir,
        output: body.slice(0, exit.index), exitCode, ...durationMs !== undefined ? { durationMs } : {},
      })
      continue
    }
    frames.push({
      kind: 'foreground', command: element.command, workdir: element.workdir,
      output: body, ...durationMs !== undefined ? { durationMs } : {},
    })
  }
  return { kind: 'settled', frames, failed }
}
