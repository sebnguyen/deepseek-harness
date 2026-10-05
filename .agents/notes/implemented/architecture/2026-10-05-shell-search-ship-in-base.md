# Agent Note: Ship the ripgrep grep-family shims as a dsh-base default

Status: implemented

## Problem

[The shim mechanism note](2026-10-05-shell-search-ugrep-grep-shims.md) shipped `dsh-shell-search` opt-in: no shipped profile mounts it, so every base-backed profile — `web`, `headless`, `acp`, `sdk` — still runs model shell `grep` with raw GNU semantics, the exact default experience the mechanism measured as broken (no ignore awareness in recursive mode, whole-line output that floods context, silence where the corpus hides in ignored trees). Each deployment must discover the package and hand-edit its profile patch to get the fix, which is the instruction-level-rot failure mode the mechanism diagnoses, one level up: the environment fix exists but does not ship in the default environment. A live `dsh web` on post-merge master confirmed it: `type -a grep` resolved only to `/usr/bin/grep` although the package had landed.

The cautious placement no longer carries weight. Every safety property verified before merge is independent of which composition mounts the row: argv outside the translation table fails open to byte-identical host GNU grep, the shadow reaches only harness children, activation and disposal restore the exact prior `PATH`, and the plugin contributes no tool schema and no prompt section, so model-visible surfaces are unchanged.

## Decision

Mount `@deepseek-ai/dsh-shell-search` in `dsh-base` — row id `shell-search`, immediately after `shell-env` — making the ripgrep-shadowed grep family a default of every base-backed profile. Opt-out follows the bundle's override model: a profile patch disables the row. The row stays in the host plane on the same criterion the web-app patch records for `shell-env`: the effect mutates the harness process `PATH` before any session exists, and the thing a preset realm never reaches is exactly the thing that must mutate. On win32 the row mounts (wrappers, `DSH_SEARCH_BIN` fact) but skips the prepend, so the Windows default is unchanged.

The base does not mount `dsh-tool-fs-search` with it: the recorded decision that shipped compositions leave text search to the shell stands; the shell just resolves its grep family through the ripgrep shim now.

## Implementation

- `packages/bundle/base/cordis.patch.yml` inserts the `shell-search` row after `shell-env`; the base manifest declares the dependency, as `verify-cordis-config` requires for every Raw row.
- `packages/bundle/base/tests/base.spec.ts` pins the row name and the manifest dependency.
- `packages/bundle/web-app/cordis.patch.yml` extends the host-plane comment to name the shared criterion.
- Package READMEs state the shipped default in place: `packages/shell/shell-search`, the `packages/shell` group page, and `packages/fs/tool-fs-search`. The mechanism note keeps the translation table, measurements, and alternatives; its "stays out of shipped profile defaults" sentence is replaced by this note.

## Testing

The base bundle spec continues to hold (the patch parses; the row joins the insert list above fifty rows) and its new assertions pin `shell-search` and the manifest key. `verify-cordis-config` enforces the resolver-manifest dependency. `apps/cli/composition.md` regenerates with the row in every base-backed profile. The keyless `test:snapshot` replays shipped profiles with the shim active and passes: the plugin adds no model-visible surface, so recorded prompts and tool schemas are untouched.

## Alternatives considered

**Keep opt-in, document the mount step.** Preserves deployment choice at the cost of keeping the measured default harm as the default experience, and ships the fix behind a mount instruction — the rot-prone instruction-level form the mechanism note rejects.

**Mount behind an agent preset.** Puts the `PATH` mutation behind a per-session realm that the host plane never reads: the Web surface disables host shell rows and lets sessions mount presets, so a preset-scoped `shell-search` would mutate one process-wide `PATH` from inside a realm while compositions that never mount that preset — and the TUI, which composes its agent process-wide — stay on GNU grep. The same placement error the web-app comment records for the job registry.

**Gate the row on ripgrep resolvability.** Fail-open already covers unresolvable ripgrep at wrapper generation (wrappers exec the host grep), so a `disabled:` gate would add a second source of truth for the same degradation without removing it.

## Consequences

- Model shell `grep`, `egrep`, and `fgrep` resolve to vendored ripgrep in every base-backed profile by default, fail-open to GNU for untranslated argv; user scripts, harness scripts, and agent commands share the shadow, with `/usr/bin/grep` and `command -p grep` as the unchanged escape hatches.
- BRE dialect divergence now rides in the default path rather than behind an opt-in; the escape hatch stays the GNU-dialect route, and the agent's predominant exact-token searches are unaffected as measured.
- Boot writes three sh shims plus one Node translator under the Harness home and prepends one `PATH` entry; no token or KV-cache delta, and disposal restores `PATH`, the fact, and the directory exactly as before.
- Deployments that want the unshimmed shell disable one row; the override model means that patch, like every base row override, replaces only that row.
