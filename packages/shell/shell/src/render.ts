/**
 * Model-facing marker and frame rendering shared by every shell tool family
 * (`dsh-tool-bash`, `dsh-tool-bash-frames`, and their persistent twins), plus the
 * exit-status parse; kept package-public so provider families render identical
 * markers and multi-command frames section identically.
 *
 * @module @deepseek-ai/dsh-shell/render
 */

import type { CollectedOutput, ShellProcessRead, ShellSandboxInfo } from './types.ts'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import { escalationHintMarker, sandboxDenialMarker } from '@deepseek-ai/dsh-sandbox'

/** Append the truncation notice (with the full-output spill path) to a stream's text. */
function streamText(output: CollectedOutput): string {
  if (!output.truncated) return output.text
  return `${output.text}\n[output truncated; full output: ${output.spillPath ?? '(unavailable)'}]`
}

/** The settled outcome facts one rendered shell run needs. */
export interface ShellRenderOutcome {
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  aborted: boolean
  timeoutMs: number
  stdout: CollectedOutput
  stderr: CollectedOutput
  sandbox?: ShellSandboxInfo
}

/**
 * Shape one finished run into the text the model sees: stdout, then a marked
 * stderr section, then exit-status markers. Non-zero exits are reported, not
 * errored — the model decides how to react; only infrastructure failures
 * (spawn errors, aborts) surface as isError results.
 * @param outcome - the completed run's settled facts (executor result or canonical tool value).
 * @param escalationModes - escalation targets this composition advertises;
 *   non-empty adds the same-turn escalation hint after a denial marker
 *   (default `[]`: no hint).
 * @returns the model-facing text: output body (or `(no output)`), then any timeout/signal/exit markers, each on its own line.
 */
export function renderResult(
  outcome: ShellRenderOutcome,
  escalationModes: readonly SandboxMode[] = [],
): string {
  const out = streamText(outcome.stdout)
  const err = streamText(outcome.stderr)

  let body = out
  if (err.length > 0) {
    // Single newline between sections (stdout usually ends with one already).
    if (body.length > 0 && !body.endsWith('\n')) body += '\n'
    body += `[stderr]\n${err}`
  }
  if (body.length === 0) body = '(no output)'

  const markers: string[] = []
  // Keep the exit marker last because parseExitStatus anchors there.
  if (outcome.sandbox?.denied) {
    markers.push(sandboxDenialMarker(outcome.sandbox.mode))
    // Hint only when the composition exposes escalation, before the final exit marker.
    if (escalationModes.length > 0) {
      markers.push(escalationHintMarker('command'))
    }
  }
  // A command may trap SIGTERM and exit 0 after timeout; still report interruption.
  if (outcome.timedOut) markers.push(`[timed out after ${outcome.timeoutMs}ms]`)
  if (outcome.signal !== null) {
    markers.push(`[killed by signal: ${outcome.signal}]`)
  } else if (outcome.exitCode !== 0) {
    markers.push(`[exit code: ${outcome.exitCode}]`)
  }
  if (markers.length === 0) return body

  if (!body.endsWith('\n')) body += '\n'
  return body + markers.join('\n')
}

/**
 * Shape one background-process read into the `job_output` delta the model
 * sees: the incremental delta, plus the lossy-read notice (with full-stream
 * spill paths) when in-memory truncation dropped unread bytes. Empty-delta
 * rendering (`(no new output)`) is the generic job controller's job.
 * @param read - one incremental read from the process handle.
 * @param sandbox - settled sandbox facts, when this was a confined process.
 * @param escalationModes - escalation targets advertised by this composition.
 * @returns the delta text with any loss or sandbox notice appended.
 */
export function renderProcessRead(
  read: ShellProcessRead,
  sandbox?: ShellSandboxInfo,
  escalationModes: readonly SandboxMode[] = [],
): string {
  const notices: string[] = []
  if (read.lossy) {
    const paths = [read.stdoutSpillPath, read.stderrSpillPath].filter((path): path is string => path !== undefined)
    notices.push(`[some output was dropped from memory; full output: ${paths.length > 0 ? paths.join(', ') : '(unavailable)'}]`)
  }
  if (sandbox?.runnerFailed) {
    notices.push(`[sandbox: the sandbox runner itself failed under ${sandbox.mode} mode — the command did not run; this is a sandbox problem, not a command failure]`)
  } else if (sandbox?.denied) {
    notices.push(sandboxDenialMarker(sandbox.mode))
    if (escalationModes.length > 0) {
      notices.push(escalationHintMarker('command'))
    }
  }
  if (notices.length === 0) return read.delta
  return `${read.delta}${read.delta.length > 0 && !read.delta.endsWith('\n') ? '\n' : ''}${notices.join('\n')}`
}

/** The exit-status facts a trailing marker line carries: exactly one status member. */
export type ParsedExitStatus =
  | { body: string; exitCode: number }
  | { body: string; signal: string }

/**
 * Split a rendered shell result at its trailing exit-status marker line so a
 * terminal card can surface the status as a pill beside the output body.
 * Results without a trailing marker return their body untouched.
 * @param text - rendered model-facing text, exit marker last when present.
 * @returns the body plus whichever status marker anchored the parse.
 */
export function parseExitStatus(text: string): ParsedExitStatus {
  const signal = /\n\[killed by signal: ([^\]\n]+)\]$/.exec(text)
  if (signal?.[1] !== undefined) return { body: text.slice(0, signal.index), signal: signal[1] }
  const exit = /\n\[exit code: (\d+)\]$/.exec(text)
  if (exit?.[1] !== undefined) return { body: text.slice(0, exit.index), exitCode: Number(exit[1]) }
  return { body: text, exitCode: 0 }
}

/** One settled outcome slot of a multi-command shell invocation. */
export type ShellFrameOutcome =
  | ({ kind: 'foreground' } & ShellRenderOutcome)
  | { kind: 'job'; jobId: string }
  | { kind: 'not-run'; reason: string }

/** One labeled outcome slot of a multi-command shell invocation. */
export interface ShellFrameRecord {
  index: number
  command: string
  outcome: ShellFrameOutcome
}

/**
 * Render a multi-command invocation as one labeled section per element in
 * submission order, reusing the singular markers verbatim so each section
 * parses with the same anchor contract as a one-command result.
 * @param frames - the settled element outcomes, in submission order.
 * @param escalationModes - escalation targets advertised by this composition;
 *   non-empty adds the same-turn escalation hint after denial markers.
 * @returns the model-facing sectioned text.
 */
export function renderFrames(
  frames: readonly ShellFrameRecord[],
  escalationModes: readonly SandboxMode[] = [],
): string {
  return frames.map((frame) => {
    const header = `[${frame.index + 1}/${frames.length}] $ ${frame.command}`
    const outcome = frame.outcome
    if (outcome.kind === 'foreground') return `${header}\n${renderResult(outcome, escalationModes)}`
    if (outcome.kind === 'job') return `${header}\nstarted background job ${outcome.jobId}`
    return `${header}\n[not run: ${outcome.reason}]`
  }).join('\n')
}
