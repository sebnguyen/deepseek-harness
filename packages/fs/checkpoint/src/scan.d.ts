/**
 * Pruned workspace walk and stat-diff for checkpoint rescans. The walk is
 * O(files) over stat only; digests are computed by the caller for the
 * changed paths alone. Pruning always drops `.git` and `node_modules`;
 * `.gitignore` entries in the simple forms (dir name, `/rooted`, `*.ext`
 * suffix, bare basename) are honored as policy — the sweep remains the
 * trust floor.
 * @module dsh-checkpoint/scan
 */
/** One walk entry the rescan attributes changes to. */
export interface ScannedStat {
  readonly mtimeMs: number
  readonly size: number
}
/** Walk result: one stat per kept session-relative path. */
export type ScanState = ReadonlyMap<string, ScannedStat>
/**
 * The simple `.gitignore` forms this sweeper honors: bare dir or file
 * names, `/`-rooted paths, and `*.ext` suffixes. Negation, mid-path globs,
 * and anchored deep patterns are not honored; full ignore parity is a
 * documented limitation of the local provider.
 */
export declare class SimpleIgnoreMatcher {
  private readonly dirs
  private readonly roots
  private readonly suffixes
  private readonly names
  /** Parse one `.gitignore` body into the supported forms. */
  static parse(body: string): SimpleIgnoreMatcher
  /** Whether one session-relative path matches any honored rule. */
  matches(path: string): boolean
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
export declare function walkWorkspace(root: string, ignore: SimpleIgnoreMatcher, extra?: ReadonlySet<string>): Promise<ScanState>
/**
 * Stat-level diff between two walks: cheap change candidates for the rescan,
 * which recomputes digests only for these paths.
 * @param before - the previous walk state.
 * @param after - the fresh walk state.
 * @returns added, changed (stat differs), and removed relative paths.
 */
export declare function diffStates(before: ScanState, after: ScanState): {
  added: string[]
  changed: string[]
  removed: string[]
}
//# sourceMappingURL=scan.d.ts.map
