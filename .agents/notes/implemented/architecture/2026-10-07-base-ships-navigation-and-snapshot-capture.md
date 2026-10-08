# Agent Note: Base ships LSP navigation and snapshot capture

Status: implemented

## Problem

Two capabilities shipped as deployments rather than products. `dsh-base` mounted no LSP seam, so `lsp` and `symbols` existed only for a profile whose owner wrote an overlay: the shipped `do-standard` example inserted the four rows by hand, and [the discovery-flow decision](2026-09-21-standard-code-discovery-flow.md) rejected mounting them in base because a deployment with no configured language server would then carry two tools that fail at call time. Workspace snapshot capture lived in `dsh-web-app` alone, so the headless, SDK, and ACP surfaces recorded nothing about what a call changed even though the capture listener is surface-independent.

Both gaps had the same consequence: a base-backed profile could not answer "navigate this symbol" or "what did this call change" unless its owner had already composed the feature, and the rows that would answer them were one layer away from every profile.

## Decision

`dsh-base` inserts five rows: `lsp` (`@deepseek-ai/dsh-lsp`), `lsp-stdio` (`@deepseek-ai/dsh-lsp-stdio`), `tool-lsp`, `tool-lsp-map`, and `checkpoint` (`@deepseek-ai/dsh-checkpoint`, `config: { enabled: true }`). Every base-backed profile — `web`, `headless`, `sdk`, `acp` — therefore mounts the seam and the capture service, and the agent plane decides which sessions see the tools.

**The provider row ships disabled.** `lsp-stdio` resolves every configured command at load and throws when one is missing, so an enabled row hard-fails the whole plugin tree on a host without the binary: with `gopls` off `PATH`, `dsh --profile headless` refuses to boot. The row therefore carries the working `gopls` map for `.go` and `disabled: true`; a deployment with the binaries re-enables it and restates `servers` (a config override replaces the block wholesale). `apps/cli/config/examples/do-standard/cordis.yml` is the worked overlay: `disabled: false` plus a `go`/`rust` map. `lsp` and `symbols` are mounted everywhere and answer `LSP_UNAVAILABLE` until a provider is enabled, which is the failure the tools already document for an unmapped extension.

**The tool rows follow the agent-plane rule.** `dsh-web-app` disables `tool-lsp` and `tool-lsp-map` exactly as it disables `tool-bash`, `tool-fs`, and the rest, so a Web session's catalog comes from its preset. Each shipped preset that advertises navigation mounts the pair; `minimal` deliberately does not, keeping the fixed tool set its training configuration names. The `checkpoint` row stays host-plane in `base` — it owns the per-session store the write tool fills — and `dsh-web-app` keeps only its `ui-file-history` client row.

**The Python runtime closure and the checkpoint manifest carry the new edges.** `python/sdk-runtime/package.json` declares the four LSP packages so a wheel-installed `dsh` can resolve every shipped preset row, and it also gained `@deepseek-ai/dsh-delegation-cap`, which the `standard` and `wind-up-wind-down` presets mount and the closure was missing. `@deepseek-ai/dsh-checkpoint` declares `zod`: its generated `./typert` host surface imports it, and without the declaration the row failed to load in every profile that reached it — a defect the base mount surfaced.

## Alternatives considered

**Mount `lsp-stdio` enabled.** The intent was navigation that works out of the box. Rejected after measuring it: a missing `gopls` fails `lsp-stdio`'s `apply()`, so the failure is not a degraded tool but an unbootable harness for every base-backed profile on CI runners, Windows hosts, and any machine without Go. A disabled row keeps the boot unconditional and makes enabling an explicit, one-line deployment decision.

**Keep navigation out of base and let deployments compose it** (the recorded position of [the discovery-flow decision](2026-09-21-standard-code-discovery-flow.md)). Rejected now because the tools are the product surface a preset advertises: leaving them to an overlay made the shipped presets advertise a capability the shipped profiles did not mount, which is what the `do-standard` example existed to paper over.

**Put `lsp`, `lsp-stdio`, and the tool rows inside each preset.** The seam, the provider registry, and the capture service are process-wide host services; mounting them per session would register one LSP provider table and one checkpoint store per preset realm, and the presets that mount no navigation tool would still pay for the seam.

**Mount the capture service only where a Files view exists.** Rejected: capture is observation over the session's own dispatches, and the headless, SDK, and ACP surfaces have the same question to answer after a call. The view is a client concern; the record is not.

## Consequences

Every base-backed profile now carries the LSP prompt and tool surface: `lsp` and `symbols` appear in the catalog wherever the agent plane is not a preset, and the presets that mount them shift every recorded tool-schema and prompt expectation — the snapshot lane owns that evidence and needs a refresh pass. Profiles that mount no provider show the two tools failing with `LSP_UNAVAILABLE` and a fix in the message.

`checkpoint` is mounted in every base-backed profile. A committed `write` appends `checkpoint/scan` rows and retains content objects under `<dshHome>/checkpoints/v1/<sessionId>/`. Capture stays observation-only: a failed store write degrades to no event, never a failed call. The service does not listen on `tools/execute`.

An overlay that already inserts these row ids as new entries collides with the base rows and fails the load with `duplicate loader entry id`; such an overlay must become an id-targeted override. The shipped `do-standard` example was rewritten that way, and the home-level copy of it on a developer machine has to be updated before that machine can boot a base-backed profile.

`dsh-base` gains five dependencies, `python/sdk-runtime` four, and `dsh-web-app` loses its `checkpoint` insert because `base` owns the row.

## Verification

`packages/bundle/base/tests/base.spec.ts` pins the five rows, the `gopls` map, `lsp-stdio`'s `disabled: true`, and the five manifest dependencies. `apps/cli/tests/windows-shell.spec.ts` asserts every shipped preset gates its shell rows by platform and that each preset other than `minimal` mounts both navigation tools. `apps/cli/tests/web-agent-presets.e2e.ts` carries the exact `standard` catalog (now including `lsp` and `symbols`) and `minimal`'s fixed `['bash']` catalog at five call sites. `apps/cli/composition.md` is regenerated. The built-CLI check that decided the provider's default: with `gopls` removed from `PATH`, `node apps/cli/lib/bin.js --profile headless` fails at `lsp-stdio` when the row is enabled and boots when it is disabled.

## Deferred

- Per-language server defaults beyond Go, and a way to express "mount this provider only where its command resolves" so the row could ship enabled.
- Refresh of the recorded-session snapshot lane for the new tool catalog and prompt sections.
