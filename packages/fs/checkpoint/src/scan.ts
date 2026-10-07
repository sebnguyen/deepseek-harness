/**
 * Pruned workspace walk and stat-diff for checkpoint rescans. The walk is
 * O(files) over stat only; digests are computed by the caller for the
 * changed paths alone. Pruning always drops `.git` and `node_modules`;
 * `.gitignore` entries in the simple forms (dir name, `/rooted`, `*.ext`
 * suffix, bare basename) are honored as policy — the sweep remains the
 * trust floor.
 * @module dsh-checkpoint/scan
 */

import { readdir, stat as statOf } from 'node:fs/promises'
import { join, relative } from 'node:path'

/** One walk entry the rescan attributes changes to. */
export interface ScannedStat {
  readonly mtimeMs: number
  readonly size: number
}

/** Walk result: one stat per kept session-relative path. */
export type ScanState = ReadonlyMap<string, ScannedStat>

/** Directories always pruned from every walk. */
const PRUNED_DIRS = new Set(['.git', 'node_modules', '.dsh'])

/**
 * The simple `.gitignore` forms this sweeper honors: bare dir or file
 * names, `/`-rooted paths, and `*.ext` suffixes. Negation, mid-path globs,
 * and anchored deep patterns are not honored; full ignore parity is a
 * documented limitation of the local provider.
 */
export class SimpleIgnoreMatcher {
  private readonly dirs: string[] = []
  private readonly roots: string[] = []
  private readonly suffixes: string[] = []
  private readonly names: string[] = []

  /** Parse one `.gitignore` body into the supported forms. */
  static parse(body: string): SimpleIgnoreMatcher {
    const matcher = new SimpleIgnoreMatcher()
    for (const raw of body.split(/\r?\n/)) {
      const line = raw.trim()
      if (line === '' || line.startsWith('#') || line.startsWith('!')) continue
      if (line.startsWith('/')) matcher.roots.push(line.slice(1).replace(/\/$/, ''))
      else if (line.endsWith('/')) matcher.dirs.push(line.slice(0, -1))
      else if (line.startsWith('*.')) matcher.suffixes.push(line.slice(1))
      else if (!line.includes('/') && !line.includes('*')) matcher.names.push(line)
    }
    return matcher
  }

  /** Whether one session-relative path matches any honored rule. */
  matches(path: string): boolean {
    const base = path.slice(path.lastIndexOf('/') + 1)
    if (this.names.includes(base)) return true
    for (const suffix of this.suffixes) if (base.endsWith(suffix)) return true
    // Directory rules match the segment at any depth, gitignore-style.
    for (const dir of this.dirs) {
      if (path === dir || path.startsWith(`${dir}/`) || path.includes(`/${dir}/`) || path.endsWith(`/${dir}`)) return true
    }
    for (const root of this.roots) if (path === root || path.startsWith(`${root}/`)) return true
    return false
  }
}

/**
 * Walk one workspace root collecting one stat per kept file. Descends
 * directories recursively, pruning {@link PRUNED_DIRS} and ignore-matched
 * entries; unreadable children are dropped, never thrown (the sweep is the
 * trust floor and a vanished directory between stat and read is ordinary).
 * @param root - absolute workspace root from the resolved sandbox policy.
 * @param ignore - parsed `.gitignore` forms; pass {@link SimpleIgnoreMatcher} over '' for none.
 * @param extra - deployment-owned extra pruned directory names.
 * @returns kept paths (slash-separated, root-relative) with mtime and size.
 */
export async function walkWorkspace(root: string, ignore: SimpleIgnoreMatcher, extra: ReadonlySet<string> = new Set()): Promise<ScanState> {
  const state = new Map<string, ScannedStat>()
  const walk = async (dir: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name)
      const rel = relative(root, abs).split('\\').join('/')
      if (entry.isDirectory()) {
        if (PRUNED_DIRS.has(entry.name) || extra.has(entry.name) || ignore.matches(`${rel}/`) || ignore.matches(rel)) continue
        await walk(abs)
      } else if (entry.isFile() && !ignore.matches(rel)) {
        try {
          const entryStat = await statOf(abs)
          state.set(rel, { mtimeMs: entryStat.mtimeMs, size: entryStat.size })
        } catch {
          // vanished between readdir and stat: keep the prior row's continuity
        }
      }
    }
  }
  await walk(root)
  return state
}

/**
 * Stat-level diff between two walks: cheap change candidates for the rescan,
 * which recomputes digests only for these paths.
 * @param before - the previous walk state.
 * @param after - the fresh walk state.
 * @returns added, changed (stat differs), and removed relative paths.
 */
export function diffStates(before: ScanState, after: ScanState): { added: string[]; changed: string[]; removed: string[] } {
  const added: string[] = []
  const changed: string[] = []
  const removed: string[] = []
  for (const [path, stat] of [...after].sort(([a], [b]) => a.localeCompare(b))) {
    const prev = before.get(path)
    if (prev === undefined) added.push(path)
    else if (prev.mtimeMs !== stat.mtimeMs || prev.size !== stat.size) changed.push(path)
  }
  for (const path of [...before.keys()].sort()) {
    if (!after.has(path)) removed.push(path)
  }
  return { added, changed, removed }
}
