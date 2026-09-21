# Agent Note: Standard code-discovery flow lives in core system-prompt

Status: implemented

English | [中文](2026-09-21-standard-code-discovery-flow.zh.md)

## Problem

The ordered code-discovery flow — glob, then outline, then grep, then read — reached the model only from `@deepseek-ai/dsh-tool-lsp-map`. That package registered the `tool:discovery` prompt section and suppressed it unless the `glob`, `lsp`, and `read` tools were all mounted. No shipped bundle mounts `dsh-tool-lsp-map`: only the `do-standard` example overlay and one snapshot fixture do. The comparable cross-tool advice, `harness:tool-batching`, is owned by `@deepseek-ai/dsh-system-prompt` and emitted in every profile, and that guidance already names `lsp` unconditionally. The flow was therefore absent from every shipped deployment.

## Decision

`dsh-system-prompt` owns the standard flow as the built-in `harness:tool-discovery` section at order `960`, immediately after `harness:tool-batching` (`950`) and ahead of the per-tool sections. Its text is advisory and ordered: glob to find the candidate files, symbols to outline their structure where a symbol tool is available, grep to locate the definitions and usages you need, then read only the files that matter. The symbol step is permitted rather than required, so the advice states no capability the deployment must have and holds with no symbol tool mounted. `includeToolDiscoveryGuidance` (default `true`) suppresses the section for a deployment that owns its own exploration instructions, matching `includeToolBatchingGuidance`. `dsh-tool-lsp-map` no longer registers `tool:discovery`; it keeps the `tool:lsp-map` section carrying the pinned `in:`/`out:` legend.

## Alternatives considered

**Relax the LSP map gate so the funnel renders whenever `glob` and `read` exist.** Rejected: general exploration advice would still be owned by the LSP package, and the text would still name `symbols` and `lsp` tools that a deployment without the seam cannot call.

**Mount `dsh-lsp`, `dsh-tool-lsp`, and `dsh-tool-lsp-map` in `dsh-base` so the funnel ships with the tools it names.** Rejected: it adds model-facing tools with no configured language server, so `lsp` and `symbols` would fail at call time in every deployment that supplies none.

**Emit the section unconditionally, with no config field.** Rejected: every other first-party guidance section is suppressible by the deployment that owns that instruction, and a composition owning its exploration guidance would have to shadow a reserved built-in name instead of switching it off.

## Consequences

Every profile carries one more prompt section between the batching guidance and the per-tool rules, so the assembled prompt grows by one paragraph and the section ordering shifts. `dsh-tool-lsp-map` no longer reads `glob` and `read` from `ctx.tools` for a gate; it keeps its `tools`, `lsp`, and `systemPrompt` injections. A deployment with no symbol tool reads a symbol step it cannot run; that is deliberate, because the step is qualified as permitted and the surrounding routing (grep, read) always applies.

## Verification

`packages/core/system-prompt/tests/system-prompt.spec.ts` pins the default emission, the ordered flow with its permitted symbol step, and suppression under `includeToolDiscoveryGuidance: false`. The section-list and rendered-prompt oracles in `packages/fs/tool-fs/tests/tools.spec.ts` and `packages/shell/tool-bash/tests/tools.spec.ts` carry the new built-in. `docs/config-catalog.md` is regenerated with the new field.
