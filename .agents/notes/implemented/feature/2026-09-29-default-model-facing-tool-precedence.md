# Agent Note: Default model-facing tool precedence

Status: implemented

## Problem

The tool-schema array is the one place the model reads an ordering, and `dsh-system-prompt` ordered it lexicographically by name. That put `bash` third and `write` last, behind `workflow`, so the only ordering signal in the request argued for the shell over the tools that change the workspace.

A deployment could already set `toolOrder`, but no shipped bundle or preset did, and a bundle-level list cannot be valid across the shipped scopes. `orderTools` rejects a listed name the assembling scope does not know, and the shipped scopes include agents with no file tools at all: the `minimal` agent preset composes only the persistent shell, and `mode: 'ptc'` contributes only `run_code` to a scope ([PTC mode](2026-06-15-ptc.md)). A patch also replaces the targeted row's whole `config`, so a list added to `dsh-base` would not survive the mode bundles that restate the `system-prompt` row.

## Decision

With no `toolOrder` configured, `dsh-system-prompt` orders the model-facing schemas by one precedence: `write`, `edit`, `read`, then the shell family, then every other tool lexicographically.

`bash` and `pwsh` share one rank — the one-shot and persistent shell tools both use each name — so a composition needs no platform branch and the shell holds one position on every supported platform. A configured `toolOrder` replaces the rule wholesale, and its rest entry still inserts unlisted tools lexicographically.

The default sorts and never rejects. A scope that lacks a ranked tool has it absent, so the same order holds for a full host catalog, for the `minimal` preset, and under `mode: 'ptc'`, where the rule is inert because only `run_code` is contributed.

## Alternatives considered

**A `toolOrder` list in the shipped bundles and presets.** This was the first choice, because the order is a product stance and config would keep it out of code. It loses on scope coverage: the validation that catches a misspelled tool name is the same validation that makes one list impossible to ship. The `web` profile disables every host tool row and mounts tools per agent preset, the `minimal` preset composes no file tools, `DSH_TOOLS_MODE=ptc` leaves only `run_code` in the catalog, and each mode bundle restates the `system-prompt` row. A list naming `write` would reject every assembly in those scopes.

**Relaxing `orderTools` to treat a listed-but-absent name as a normal absence, then shipping the list in config.** This makes the configuration route work, and it was the second candidate. It loses the check that turns a mistyped tool name into an assembly-time failure, which is the reason `knownNames` is tracked separately from the visible set at all; the code default keeps a typo in `toolOrder` loud.

**Ranking `bash` and `pwsh` as separate positions.** It reads closer to the requested list. It loses because the unranked shell would fall back to lexicographic order beside unrelated tools, moving the shell's position depending on which tools a composition mounts, and a per-platform list would put a platform probe into a package that has none.

**Changing the order only where the shell is not mounted.** Narrower, but it would leave the web and headless profiles — the surfaces that produce the reported behavior — on the lexicographic default.

## Consequences

The model reads the workspace-mutating tools first and the shell directly after them, on every shipped profile and agent preset, without any deployment changing its composition.

The order stays deterministic and locale-independent: a ranked name compares by rank, and equal ranks compare by code unit, so two assemblies of one tool set produce identical text.

`toolOrder` remains the only override and is all-or-nothing. A deployment that wants a different order states the whole sequence rather than adjusting the precedence, which keeps one rule instead of a merge between a default and a partial list.

The precedence is a product stance in code, not a validated `Config` field. It is fixed for the same reason the lexicographic default was: nothing about a deployment varies it, and a tuned order has `toolOrder` to say so.

Ordering is one signal among several, and it does not by itself make a model call `write`. An agent that explores with the shell records no filesystem observation, so a `write` over an existing file is refused with `cannot modify "<path>": file has not been read — read the file, then retry`; the `write` description carries the same read-first rule.

## Testing

`packages/core/system-prompt/tests/tool-order.spec.ts` pins the default precedence, the shell family's shared rank, and that the rest entry of a configured `toolOrder` still inserts unlisted tools lexicographically. The recorded-session corpus pins the assembled sequence per profile in the `tool-schemas.expected.json` sidecars, which `pnpm run test:snapshot:refresh` regenerates without a key.
