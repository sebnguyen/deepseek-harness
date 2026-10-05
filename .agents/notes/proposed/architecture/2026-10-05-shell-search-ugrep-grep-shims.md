# Agent Note: shell-search: vendor-npm ripgrep grep-family command shims for model shell calls

Status: proposed

## Problem

Agents running under this harness overwhelmingly search through the model-facing `bash` tool rather than the structured `grep`/`glob` tools, and no amount of prompt encouragement changes that: a single early successful `grep -rn` in a session sets an in-context precedent that out-weights system-prompt guidance for the rest of the session. GNU grep gives those agents its raw semantics — no ignore awareness in recursive mode, whole-line output that lets one minified hit flood the context, blindness to UTF-16 files, and a silent lie in multi-line patterns (an embedded newline in a pattern is treated as alternation, so `grep -c $'hello\nneedle'` counts 3 on a file where true adjacency occurs once). The failures are environmental, and instruction-level fixes rot; the fix must live in the environment the child shell inherits.

The sourcing constraint is absolute: the owner publishes no binary packages and compiles nothing, so the replacement binary must ship as an ordinary vendor-published npm dependency. Verified against the registry on 2026-10-05: ugrep publishes no npm package at all (bare `ugrep` and every scoped variant 404) and its GitHub release v7.8.5 ships only `ugrep-windows-x64.zip`, so ugrep fails the constraint and is a deal-breaker despite being the best functional match (measured: GNU exit-code and `-q`/`-x` parity, default ignore-awareness, true `\n` adjacency, UTF-16 visibility, ~10x faster warm). What the registry *does* offer vendor-published: `@vscode/ripgrep@1.18.0` declares twelve `@vscode/ripgrep-<plat>` optionalDependencies, and in this checkout `node_modules/.pnpm/@vscode+ripgrep-linux-x64@1.18.0/.../bin/rg` is a live 5.5 MB ripgrep 15.0.0 executable — the binary rides as payload files in the platform package, independent of the main package's postinstall (which pnpm blocks here, leaving only its `bin/` empty); and `@ast-grep/cli@0.45.3` ships the same optionalDependencies pattern with seven platform packages.

Measured ripgrep versus GNU on this host (vendored 15.0.0 platform binary vs GNU 3.11) bounds what the shim imports from each engine. For ripgrep: warm recursion over `packages/` took 0.055s against GNU's 0.357s; a naive root recursion emitted zero `.gitignore`d-tree hits where GNU walks them; `--max-columns` replaced a 600-byte matched line with `[Omitted long matching line]` where GNU prints it whole; exit codes 0/1/2 and the shared flags `-q -c -l -i -n -o -w -v -x -m -A/-B/-C -e` behaved identically, lowercase patterns case-sensitive by default as in GNU. Two measured divergences draw the translation boundary: the pattern `a\+b` matched line 1 (`ab`, GNU BRE one-or-more) versus line 2 (`a+b`, ripgrep literal plus), and the identical argv `-rn bar d` made ripgrep substitute text under its replace vocabulary instead of recursing. Hygiene, truncation, ordering, and speed are what the wrappers take from ripgrep; the dialect and the verbs stay GNU's, preserved by the fail-open table.

## Proposal

Add a new function plugin, `packages/shell/shell-search` (`@deepseek-ai/dsh-shell-search`), that at boot generates POSIX sh wrappers named `grep`, `egrep`, and `fgrep` under the Harness home (`<home>/shell-search/bin`), prepends that directory to the harness process `PATH`, and contributes `DSH_SEARCH_BIN` to the managed shell environment. Command lookup is left-to-right first-match over the colon-separated `PATH` list, so prepending one directory shadows exactly the three grep-family names and nothing else. The wrappers translate the GNU grep argv into ripgrep argv against a fixed fail-open table and exec the vendored platform-package binary; any argv the table does not fully cover execs the host's real GNU grep unchanged, so scripts keep byte-identical semantics. The backend resolves at generation time by precedence: an explicit `rg` config path, then the installed `@vscode/ripgrep-<plat>` platform package selected by `process.platform`/`process.arch`, then `rg` on `PATH`, then the host grep fallback — so every tier degrades to the previous one and no tier requires the owner to publish anything. The plugin injects `shell-env`, stays opt-in out of shipped profile defaults, and the ripgrep binary it depends on is already a dependency of `packages/fs/tool-fs-search` in `pnpm-lock.yaml` — the package adds at most the existing dependency, zero new published artifacts.

Application launch is untouched: the rule in [docs/architecture.md](../../../../docs/architecture.md#application-launch) forbids package bins, demos, and executables that become Node application launchers bypassing the `dsh` CLI; shell scripts generated at runtime into the Harness home and reached through normal command lookup are plugin runtime behavior, not launch paths, and the package gains no `bin` field.

## Implementation

### Plugin module

A function plugin with named exports only (a default export would make the Loader discard the namespace). The entire mechanism is one `ctx.effect`, so disposing the plugin unregisters the environment fact, restores the prior `PATH` exactly, and removes the generated directory:

```ts
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { renderShims, resolveBackend, SHIM_NAMES } from './shims.ts'

export const name = 'shell-search'
export const inject: string[] = ['shell-env']

export interface Config {
  dshHome?: string  // home owning shell-search/, default: $DSH_HOME then ~/.dsh
  rg?: string       // explicit absolute ripgrep binary; fail loud when not executable
}

export function apply(ctx: Context, config: Config = {}): void {
  const dir = join(resolveDshHome(config.dshHome), 'shell-search')
  const binDir = join(dir, 'bin')
  ctx.effect(function* prepareShims(this: Context) {
    const backend = resolveBackend(config.rg, binDir)
    mkdirSync(binDir, { recursive: true })
    const shims = renderShims(backend)
    for (const shimName of SHIM_NAMES) {
      const shimPath = join(binDir, shimName)
      writeFileSync(shimPath, shims[shimName])
      chmodSync(shimPath, 0o755)
    }
    const previousPath = process.env.PATH
    if (process.platform !== 'win32') {
      process.env.PATH = previousPath === undefined ? binDir : `${binDir}:${previousPath}`
    }
    const disposeContribution = ctx.shellEnv.register({
      name,
      variables: { DSH_SEARCH_BIN: { description: 'Directory of the shell-search grep-family command shims.' } },
      resolve: () => ({ DSH_SEARCH_BIN: binDir }),
    })
    yield () => {
      disposeContribution()
      process.env.PATH = previousPath
      rmSync(dir, { recursive: true, force: true })
    }
  }.bind(ctx), 'shell-search.prepare()')
}
```

`PATH` reachable by the child matters more than the `DSH_SEARCH_BIN` fact: `packages/subprocess/subprocess-local/src/spawn.ts` builds every child environment from a scrubbed copy of the harness `process.env` (PATH survives the scrub; only credential-shaped and `DSH_*` names are dropped), and `packages/shell/bash-local/src/index.ts` layers `{ ...ENV_OVERRIDES, ...spec.env, ...spec.dshEnv }` on top, so mutating `process.env.PATH` at boot reaches every shell child — persistent sessions included — with no seam change. The `dshEnv` channel cannot carry the prepend itself: the registry keys are typed `DshEnvironmentKey` (`` `${'DSH_'}${string}` ``) and `PATH` is rejected at registration, which is exactly why the prepend lives in the effect while the directory location rides the registry as an enumerable, logged fact per [docs/subsystems/shell.md](../../../../docs/subsystems/shell.md).

Backend resolution maps `process.platform`/`process.arch` to the optionalDependency name (`linux/x64` → `@vscode/ripgrep-linux-x64`, `darwin/arm64` → `@vscode/ripgrep-darwin-arm64`, `win32/x64` → `@vscode/ripgrep-win32-x64`, the twelve names documented by the package's own metadata), resolves `.../bin/rg` inside that installed package, validates it executable, and throws only when a *configured* path is bad; a missing platform package falls through to `findExecutable('rg')` then `findExecutable('grep', binDir)` (skipping the shim directory so re-boots never resolve their own wrapper).

### Shim generators

Pure functions in `src/shims.ts`, unit-testable without a filesystem effect. Each wrapper is a POSIX sh argv loop (no string rewriting, runs unchanged under dash and bash) that consumes GNU tokens through the fail-open table and re-emits ripgrep argv; any token outside the table flips the wrapper to `exec '<host grep>' "$@"` verbatim. The ripgrep form carries fixed defaults that delete the measured flood classes: `--hidden --sort=path --max-columns=500` — hidden files searched (GNU's default silently misses `.agents/` and `.github/` here; `.git` is still skipped), deterministic order, and minified lines truncated at 500 bytes. The wrapper embeds absolute binary paths at generation time, so it performs no discovery and makes the logged command equal to the executed command (`type grep` shows the shim; `/usr/bin/grep` and `command -p grep` remain the documented escape hatches).

Fail-open translation table (GNU token → ripgrep argv; every other token passes through or fails open):

| GNU form | ripgrep form | note |
|---|---|---|
| `--include=G` | `--glob=G` | repeatable, accumulates |
| `--exclude=G` | `--glob=!G` | repeatable, accumulates |
| `--exclude-dir=D` | `--glob=!D/**` | GNU's dir-exclude shape |
| `-r`, `-R`, `-d recurse` | (dropped) | ripgrep is recursive by default |
| `-E`, `-F`, `-i`, `-n`, `-l`, `-c`, `-o`, `-w`, `-q`, `-v`, `-x`, `-s` | identical | ripgrep implements them |
| `-m N`, `-A N`, `-B N`, `-C N`, `-e PAT` | identical | value-bearing forms pass as one token |

The discard rows exist because passing the stay verb behaved as measured above — verbatim pass-through would silently activate the replace vocabulary.

Policy needs no generated file: ripgrep reads `.gitignore`, `.ignore`, and `.rgignore` natively, and this repo's `.rgignore` already freezes the agent-notes archive — the durable-glob layer from the earlier turns is the data file the backend already honors. GNU's `egrep`/`fgrep` shims add `-E`/`-F` respectively before the translated tokens; the plain `grep` shim runs ripgrep's Rust-regex dialect, whose divergence from GNU BRE (treatment of unescaped `+`, `(`, `{`) is documented as a risk below.

### Sourcing verdict

Everything the agent consumes is vendor-published: the ripgrep payload packages behind `@vscode/ripgrep` (already in `pnpm-lock.yaml` via `dsh-tool-fs-search`, MIT/Unlicense, already listed in `THIRD_PARTY_NOTICES.md`), and optionally `@ast-grep/cli` for the semantic tier, whose platform packages follow the identical optionalDependencies shape and whose patterns are code the model writes well (official agent-skill marketplace exists upstream). No package is published by this repo, no binary is compiled by this repo, and nothing is downloaded at install or boot time — the binary is a payload file resolved from the installed platform package, the one mechanism this checkout proves works under pnpm's blocked build scripts.

## Alternatives considered

**ugrep as the backend.** Best functionally: measured GNU exit-code and `-qx` parity, config-file globs, UTF-16, true `\n` adjacency, ~10x warm speed. Lost to the sourcing constraint: no npm package exists under any name and upstream ships no prebuilt Unix binaries, so shipping it would force owner-published platform packages or operator installs, both refused.

**Owner-published ugrep platform packages.** Re-running the esbuild pattern ourselves: CI static builds per pinned SHA plus a BSD-3 license allowlist row. Rejected by the owner's deal-breaker — the repo publishes no binary artifacts.

**Postinstall-download packaging** (the old `@vscode/ripgrep` mechanism): disproved locally — this checkout's main package `bin/` is empty because pnpm blocks scripts, which is exactly the silent broken-search failure mode a shell-provided binary must never have. The platform-package payload form supersedes it.

**Structured `grep`/`glob` harness tools with better globs.** Tried and removed by the owner: agents do not use them regardless of encouragement. The problem was adoption, not capability.

**Instruction-level enforcement** (prompt rules, README notes, `--glob '!vendor/**'` idioms): attention-dependent and measured to rot within a session once bash grep succeeds once. Lost to the environment layer.

**A system-wide `/usr/local/bin/grep` replacement**: leaks to every human and script on the host and cannot carry per-repo policy; the generated per-deployment directory scopes the shadow to harness children only.

**ast-grep as the grep replacement rather than a complement.** Its npm sourcing is vendor-clean, but it is structural, not line-oriented: the agent's `grep -rn token .` habit wants a line engine, so ast-grep ships beside the ripgrep shim as the "where is X used" tier instead of replacing it.

## Acceptance criteria

- Wrappers execute under `sh` (dash) and `bash`; on a fixture tree the translated GNU forms (`-rn`, `-l`, `-c`, `-i`, `-E`, `-F`, `-m`, `-A/-B/-C`, `--include`, `--exclude-dir`, `-q` pipelines with exit codes 0/1/2) match GNU outcomes through ripgrep, while a naive `-r` at this repo root emits zero `node_modules`/`lib` hits thanks to native ignore reading.
- Any argv containing an out-of-table token execs the host GNU grep with the identical argv (fail-open), pinned by a property test over the repo's own scripts' grep usages (`grep -qx` in `scripts/` forms included).
- Backend resolution precedence holds on linux-x64 with the vendored platform package present, degrades to `PATH` `rg`, then to host grep when the platform package is absent; a configured non-executable `rg` path fails boot loud.
- Booting the plugin prepends the shim directory, `collect()` exposes `DSH_SEARCH_BIN`, and fiber disposal restores the exact prior `PATH`, unregisters the fact, and removes `<home>/shell-search`; `win32` skips the prepend and documents the limitation.
- Zero new published package names: the package adds only an existing registry dependency (`@vscode/ripgrep`) and passes the new-package gates (100% src coverage, tsconfig.host.json reference, group README row, resolver-manifest dependency, license gate with no new license species).

## Risks

- Regex dialect divergence is intrinsic and measured, not theoretical: on `ab\na+b\n`, GNU `grep 'a\+b'` yields line 1 (BRE one-or-more) and ripgrep line 2 (literal plus) — disjoint result sets no argv table reconciles. The table covers flags, not dialect; the divergence is confined to the shadowed `grep` name in harness children, GNU dialect stays reachable through the documented escape hatch, and the agent's predominant exact-token searches are unaffected.
- The shadow reaches any in-process consumer inheriting the mutated `PATH`, including harness scripts whose recursive grep must see ignored paths; the absolute-path escape hatch documents the contract but does not enforce it.
- ripgrep does not match ugrep's multi-line truthfulness (embedded-newline patterns differ) nor its UTF-16 reading; the shim improves hygiene, truncation, ordering, and ignore behavior, not GNU's full semantics set — acceptable because those were the measured rot sources.
