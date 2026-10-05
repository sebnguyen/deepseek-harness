# Agent Note: shell-search: route `grep` to GNU grep and stop injecting ripgrep-incompatible mode flags

Status: proposed

## Problem

The shipped shell-search translators inject a per-name GNU mode token ahead of every ripgrep invocation — `MODE_FLAG = { grep: '-G', egrep: '-E', fgrep: '-F' }` — treating GNU grep's regex-dialect switches as if ripgrep shared them. It does not, verified against the vendored `@vscode/ripgrep` 15.0.0 payload binary and a linuxbrew ripgrep 15.0.0: `-G` is not a ripgrep flag (`rg: unrecognized flag -G`, exit 2), and ripgrep's `-E` is `--encoding`, so `egrep pat files` consumed the pattern as an encoding name and died with exit 2. Every `grep` and `egrep` call through the shipped shims therefore failed with ripgrep usage errors and no output, and the fail-open exec of the host GNU grep never engaged: it triggers only on a spawn ENOENT, and ripgrep exiting 2 with its stderr inherited passed the usage error and exit code straight through to the caller. Meanwhile `fgrep` worked by accident, `-F` being ripgrep's only real token of the three.

This failure category is older than the mode table. The original decision recorded two measured dialect divergences (GNU BRE `a\+b` matching `ab` where ripgrep reads a literal plus, and ripgrep's replace-verb substitution) but shipped a comment-only acknowledgment for them while flatly routing all three names to ripgrep. ripgrep has no POSIX BRE dialect at all: `\( \{` and friends are literals in its engine with no flag restoring BRE, backreferences require `--pcre2` (a different dialect, still not BRE), and GNU `-E` extensions like `(a)\1` parse under GNU but are regex-parse errors under rust regex. Beyond the dialect, translated invocations also diverged in traversal: the shim's defaults carried `--hidden` but not `--no-ignore`, so `.gitignore`- and `.ignore`-listed files vanished from shim results that GNU grep walks, and ripgrep recurse-by-default answered a non-recursive `grep pat dir` operand with results where GNU grep errors `Is a directory`.

## Proposal

Per-name routing on the ripgrep tier, replacing [shell-search-ugrep-grep-shims](../../implemented/architecture/2026-10-05-shell-search-ugrep-grep-shims.md)'s flat translation of all three names:

- The `grep` wrapper execs the host GNU grep verbatim in all configurations. GNU BRE escapes have no ripgrep spelling and silent dialect drift would return disjoint result sets, so `grep` receives ripgrep acceleration never, and `MODE_FLAG.grep` is `undefined`.
- `egrep` translates to the ripgrep default engine with no mode flag — POSIX ERE and rust regex agree closely enough that residual gaps (GNU's backreference-in-ERE extension) fail open server-side. `fgrep` translates with `-F`, fixed strings.
- Translated invocations carry `--no-ignore` alongside `--hidden --sort=path --max-columns=500`, walking exactly the trees GNU grep walks; only line truncation and output ordering remain ripgrep-own.
- The translator re-runs the original argv under the host GNU grep with the shim's dialect flag (`-E` for the `egrep` shim, `-F` for `fgrep`) in three cases: a token outside the fail-open table or a value flag missing its value (previously a verbatim GNU exec; the flag list `EFilncowqvxs` and the table rows are unchanged), a bare directory operand without `-r`/`-R`/`--directories=recurse`/`-d recurse`, and ripgrep exiting 2 — usage or regex-parse errors whose stderr is suppressed on that one path only, so the caller sees exactly GNU's verdict.

## Alternatives considered

**Mapping GNU BRE onto ripgrep with a pattern rewriter.** `\( \{` metacharacters and literal parens interleave per context; a correct BRE-to-rust-regex translator is a parser, and one mistake yields the silent disjoint-result failure this note exists to remove. Lost to the fail-open rerun's simplicity.

**`--pcre2` for the `egrep` shim.** GNU PCRE2-compatible `-E`/`-P` support on this host's GNU build is unverified, and `--pcre2` changes unicode and error semantics versus rust regex; regular `egrep` patterns already match under the default engine. Kept as the simd/jit path.

**A ugrep backend.** Still `grep`-dialect complete and measured ~10x faster warm, still disqualified by the absolute sourcing constraint: no vendor-published npm package, from the original decision.

**Keeping `grep` on ripgrep with `-G`/`-E` injections fixed to valid tokens.** No combination of ripgrep tokens reads POSIX BRE; any fixed table would ship the silent-dialect bug the measured `a\+b` divergence already demonstrated.

## Acceptance criteria

- A generated `grep` wrapper contains no translator reference and execs the resolved host grep; a backend-less generation renders verbatim wrappers for all three names.
- `translate.mjs` against the vendored ripgrep: `rg: unrecognized flag`, `unknown encoding`, and `regex parse error` never surface on any `grep`, `egrep`, or `fgrep` invocation; `egrep '(a)\1' file-with-match` exits 0 via the GNU `-E` rerun; `egrep needle dir` exits 2 with `Is a directory` like GNU; non-recursive directory operands only, recursive search still hits `.gitignore`d and hidden files (traversal parity).
- Spawn tests assert the per-name renderings, the dir-fail-open behavior, the exit-2 rerun, and reruns under GNU of previously gnawed inside-table use flags.

## Risks

- The `-E` rerun suppresses ripgrep stderr only on exit 2; a genuine GNU usage error on the rerun prints GNU's stderr as before, and commands that mix an unusable flag with valid output (e.g. an fgrep pattern only translatable as a GNU -F string) behave exactly as the unshadowed family would.
- `egrep`'s residual rust-vs-ERE gaps (gnu `-E` backrefs, some bracket leftovers) pay a `--pcre2`-less rerun hop; measurement showed the host GNU accepts `(a)\1` where ripgrep errors, so the rerun is the designed result, not a defect: under the unshadowed family those patterns already meant GNU's verdict.
- `grep` loses ripgrep's speed entirely; the exact-token searches models habitually run through `grep -rn` return to GNU traversal times. Accepted: correctness before speed, with `egrep`/`fgrep` keeping the vendored acceleration.
