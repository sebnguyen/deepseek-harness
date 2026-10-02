/**
 * Policy-routed preread of extracted candidates through the `ctx.fs` seam.
 * Files become bounded content reads, directories ranked path-only listings;
 * every failure path drops the candidate silently and never bypasses policy.
 * @module @deepseek-ai/dsh-experimental-reasoning-prefetch/stage
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FsDirEntry, FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import type { ExtractedCandidate } from './extract.ts'

/** Resolved budgets and knobs one staging run consumes. */
export interface StageBudget {
  /** Maximum content reads per attempt. */
  readonly maxFiles: number
  /** Per-read byte ceiling; oversized files are skipped, not truncated. */
  readonly maxFileBytes: number
  /** Aggregate injected-byte ceiling per attempt. */
  readonly maxTotalBytes: number
  /** Directory-listing line ceiling. */
  readonly listLines: number
}

/** One staged prospect ready for injection. */
export interface PrefetchedEntry {
  /** Span as extracted (workspace display path or directory span). */
  readonly path: string
  /** What the staging produced for it. */
  readonly kind: 'file' | 'directory'
  /** File content or ranked listing lines. */
  readonly text: string
  /** Observed bytes counted against {@link StageBudget.maxTotalBytes}. */
  readonly bytes: number
}

/**
 * Ground and prefetch every read/glob candidate in one reasoning block's
 * prospect set. Grep prospects stage nothing in this prototype: no executor
 * seam is wired, by deliberate v1 scope. Candidates resolve against the
 * agent's session cwd exactly as the read tool does; a missing backend,
 * absent path, denied policy, or budget overrun drops the candidate.
 * @param context - plugin context; `fs` is read as optional so a providerless composition no-ops.
 * @param agent - owning agent whose session header cwd grounds resolution.
 * @param budget - the attempt's caps.
 * @param candidates - extracted prospects in stream order.
 * @param signal - attempt-level cancellation.
 * @returns staged entries in candidate order, within the budget.
 */
export async function stageCandidates(
  context: Context,
  agent: Agent,
  budget: StageBudget,
  candidates: readonly ExtractedCandidate[],
  signal: AbortSignal,
): Promise<PrefetchedEntry[]> {
  const fs = context.get('fs')
  if (fs === undefined) return []
  const cwd = agent.session.header.cwd
  const entries: PrefetchedEntry[] = []
  let files = 0
  let total = 0
  for (const candidate of candidates) {
    if (candidate.op === 'grep' || candidate.term) continue
    if (signal.aborted) break
    let staged: PrefetchedEntry | undefined
    try {
      staged = await stageOne(fs, cwd, candidate, signal, budget, files, total)
    } catch {
      // A provider failure on speculation is a silent drop, never an error surface.
      staged = undefined
    }
    if (staged === undefined || total + staged.bytes > budget.maxTotalBytes) continue
    if (staged.kind === 'file') files += 1
    total += staged.bytes
    entries.push(staged)
  }
  return entries
}

/** One candidate through resolve+stat, branched on type and shape. */
async function stageOne(
  fs: FileSystem,
  cwd: string | undefined,
  candidate: ExtractedCandidate,
  signal: AbortSignal,
  budget: StageBudget,
  files: number,
  total: number,
): Promise<PrefetchedEntry | undefined> {
  const target = await fs.resolve(candidate.span, {
    ...cwd !== undefined ? { cwd } : {},
    signal,
  })
  const info = await fs.stat(target, signal)
  if (info === undefined) return undefined
  if (info.type === 'directory') return stageDirectory(fs, target, candidate, signal, budget)
  if (info.type !== 'file') return undefined
  if ((info.size ?? budget.maxFileBytes) > budget.maxFileBytes) return undefined
  if (files >= budget.maxFiles) return undefined
  const text = await fs.readText(target, signal)
  const bytes = byteLength(text)
  if (total + bytes > budget.maxTotalBytes) return undefined
  return { path: target.displayPath, kind: 'file', text, bytes }
}

/** A directory yields only ranked path-only listing lines, capped per config. */
async function stageDirectory(
  fs: FileSystem,
  target: FsTarget,
  candidate: ExtractedCandidate,
  signal: AbortSignal,
  budget: StageBudget,
): Promise<PrefetchedEntry | undefined> {
  const children = await fs.listDir(target, signal)
  const lines = children.slice(0, budget.listLines)
    .map((entry: FsDirEntry) => `${candidate.span}${entry.name}${entry.type === 'directory' ? '/' : ''}`)
  const text = lines.join('\n')
  return { path: candidate.span, kind: 'directory', text, bytes: byteLength(text) }
}

/** UTF-8 byte length without importing buffer just for metrics. */
function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength
}
