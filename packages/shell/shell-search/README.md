---
description: "PATH-shimmed grep-family wrappers running the vendored ripgrep binary, for users and maintainers choosing whether model shell calls search through ripgrep."
kind: "package-reference"
---

# @deepseek-ai/dsh-shell-search

## Summary

`dsh-shell-search` makes every command a model shell call runs resolve `grep`, `egrep`, and `fgrep` to generated POSIX sh wrappers, prepended to `PATH` at boot under the Harness home. With a resolvable ripgrep — the vendored `@vscode/ripgrep` platform package first, then `rg` on `PATH` — the wrappers exec a generated Node translator that maps safe GNU flags onto ripgrep with ignore hygiene, hidden-file search, deterministic order, and line-length truncation; any unrecognized flag execs the host GNU grep verbatim. Without ripgrep the wrappers are GNU grep. Disposal removes the shims and restores `PATH`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Load this plugin beside `dsh-shell-env` in a composition whose agent searches through the shell; the `shellEnv` injection means the plugin stays PENDING until that registry exists, so the env plugin must mount first. The effect writes `<home>/shell-search/` (wrappers plus translator), prepends that `bin` directory to the harness `PATH` on POSIX, and contributes `DSH_SEARCH_BIN` naming it; disposing the plugin reverses all three. Windows skips the prepend and documents the limitation below.

| Field | Default | Meaning |
|---|---|---|
| `dshHome` | `$DSH_HOME`, then `~/.dsh` | Harness home hosting `shell-search/` |
| `rg` | the vendored platform package, then `PATH` | Absolute ripgrep binary; startup fails when the path is not executable |

### What the wrappers translate

The fail-open table covers `-r`/`-R` (dropped, ripgrep recurses by default), `--include=`/`--exclude=`/`--exclude-dir=` (ripgrep globs), the shared flags `-E -F -i -n -l -c -o -w -q -v -x -s`, the value flags `-m -A -B -C -e` in attached and spaced spelling, and `--`. Translated invocations always carry `--hidden --sort=path --max-columns=500`.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>How the shims are generated and owned — click to expand</summary>

`apply` is one `ctx.effect`: it resolves the backend (configured `rg`, failing loud when not executable; else `@vscode/ripgrep-<plat>` selected by `process.platform`/`process.arch` through the main package's own optionalDependencies; else `rg` on `PATH`), writes the wrappers and translator, mutates `process.env.PATH` (child shells inherit it because the subprocess base environment is a scrubbed copy of the harness environment, and `PATH` survives that scrub), registers `DSH_SEARCH_BIN`, and yields a disposer restoring the exact prior `PATH`, unregistering the fact, and removing `shell-search/`. Wrappers embed absolute binary paths, so they perform no discovery; `/usr/bin/grep` and `command -p grep` remain the escape hatches the tables document but cannot enforce.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [shell package map](../README.md) — the bash capability family and its roles.
- [Bash executor subsystem](../../../docs/subsystems/shell.md) — the `ctx.shell` seam and the managed `DSH_*` environment.
- [shell-env](../shell-env/README.md) — the registry the `DSH_SEARCH_BIN` fact is contributed to.
- [shell-search Agent Note](../../../.agents/notes/implemented/architecture/2026-10-05-shell-search-ugrep-grep-shims.md) — measurements, alternatives, and the sourcing verdict.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-shell-search) — every accepted config field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

### Grep-family shell commands

#### What the model sees

`grep`, `egrep`, and `fgrep` in shell calls resolve to the generated wrappers while the plugin is active; result text differs from GNU only where the translated defaults apply — hidden files included, `.gitignore`/`.ignore`-listed files excluded, lines over 500 bytes omitted, matched files in sorted order. Failed-open invocations return byte-identical GNU output. `DSH_SEARCH_BIN` names the shim directory among the managed environment facts.

#### Token effect

None. The plugin contributes no system-prompt section and no tool schema, so request size is unchanged; shell result size changes only through the truncation default described above.

#### KV Cache effect

Prefix-stable while the plugin stays mounted or unmounted across requests: activation and disposal change which binary answers grep calls, not the request prefix; provider cache reuse is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Windows skips the PATH prepend** — the wrappers are POSIX sh; win32 compositions generate them but never shadow the grep family.
- **Regex dialect divergence is shipped, not translated** — patterns relying on GNU BRE metacharacter semantics (`\+`, `\(`, `\{`) match differently under ripgrep; the divergence is confined to the shadowed names in harness children.
- **The shadow is PATH-wide** — every subprocess of the harness inherits it; scripts that must reach only ignored paths use the absolute-path escape hatch.
