---
description: "The model-facing frames bash tool for users and maintainers choosing, configuring, or debugging batched command execution with one labeled result frame per element."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-bash-frames

## Summary

`dsh-tool-bash-frames` is the `bash` tool whose call surface carries both the v1 singular face (one `command`, fresh shell, exit markers, `run_in_background`, sandbox escalation) and a `commands` batch face: several independent commands settle into one labeled frame each inside a single result. Elements run in written order, each with its own exit code, timeout, sandbox marker, or background job id, and every element runs even if an earlier one fails. It is the mountable successor of `dsh-tool-bash` for the shipped presets: presets address it by the same plugin id, so id-keyed disabling keeps working. Use an executor such as `dsh-bash-local` or `dsh-bash-sandbox` and load `dsh-shell-env`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Load this plugin in any composition where the agent should run bash commands: it registers the `bash` tool once an executor provider and the `dsh-shell-env` registry are mounted, and stays pending until the `tools`, `shell`, `systemPrompt`, and `shellEnv` services exist. Mount exactly one of this package and `dsh-tool-bash`: both register the same tool name.

### Minimal configuration

The common path is an executor provider, the environment registry, and this tool; add the job runtime when the agent may run commands in the background.

```yaml
- name: '@deepseek-ai/dsh-bash-local'
- name: '@deepseek-ai/dsh-shell-env'
- name: '@deepseek-ai/dsh-tool-bash-frames'

# Optional: background jobs
- name: '@deepseek-ai/dsh-jobs-local'
- name: '@deepseek-ai/dsh-tool-jobs'
```

Configuration fields tune the batch face and background support.

| Field | Default | Meaning |
|---|---|---|
| `enableRunInBackground` | `true` | Expose `run_in_background`; when `false`, forced background calls are rejected |
| `maxCommandsPerCall` | `8` | Maximum elements one `commands` invocation may carry |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-bash-frames) is the exhaustive source for every accepted field and its JSDoc; the generated [tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-bash-frames) carries the full argument schema.

### Running commands

A singular call executes `bash -c <command>` exactly as `dsh-tool-bash` does. Passing `commands` runs each element as its own fresh-shell dispatch, serially in written order; the result is one section per element headed `[i/N] $ <command>` with that element's output and markers exactly as a singular call would render them. A non-zero exit on one element is reported in its own frame and does not stop later elements; steps that must read an earlier output belong in a later call. An element's `workdir` and `timeoutMs` override the call-level values, and an element's `run_in_background` starts a background job whose frame reads `started background job <jobId>`; the job runtime's `job_output`, `job_list`, and `job_kill` manage it as with singular background calls. A `description` in active voice (5–10 words) labels the call in the UI. Output beyond the executor's stream caps is truncated to its tail, with the full output saved to a spill file whose path is reported.

### Sandboxed execution and escalation

When the mounted executor confines commands (for example `dsh-bash-sandbox`), a blocked file operation is reported per element as `[sandbox: file access denied under <mode> mode]` — a policy denial, not a command failure. Escalation with `sandbox_permissions` and a `justification` applies to singular calls only: widening authority never rides a batch. A denial inside a batch is therefore final for that call; rerun the denied command as a singular call and escalate there.

### What can go wrong

A composition with no executor provider never activates the tool. Background calls without the job runtime fail with `background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs`, and `sandbox_permissions` without a sandboxing executor fails with `sandbox_permissions is not available in this composition (no sandboxing executor to escalate)`. `enableRunInBackground: false` removes the parameter and rejects a forced background call at execution time; a `commands` invocation over `maxCommandsPerCall` fails before anything executes, as does `command` beside `commands`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the tool and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **Model-facing consumer of the shell seam.** The tool is the Consumer role of the bash capability: it registers the `bash` schema, renders results, and resolves per-call policy, while the executor seam owns process mechanics.
- **A batch is its elements.** `executeFrames` dispatches each element through the same resolve/run path the singular face uses, so each element inherits defaulting, policy, escalation clamping, and sandbox facts; the frames union arm adds `job` and `not-run` outcomes beside the singular result facts.
- **Non-zero exits are reported, not errored.** Only infrastructure failures (spawn errors, aborts) surface as tool errors; the model interprets exit codes and markers per frame.
- **Background work belongs to the job runtime.** A background element registers a process handle with `ctx.jobs`; ids, ownership, completion notices, and disposal are the runtime's, and this tool only maps bash exit and sandbox facts into job output.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: tool registration, prompt section, arg validation, escalation, singular and frames dispatch |
| [`src/background.ts`](src/background.ts) | Map a settled background process onto generic job outcome vocabulary |
| — | Model-facing result text lives in [`dsh-shell`](../shell/README.md): streams, markers, truncation notices, and the shared `renderFrames` sectioning. |
| — | No runtime invariant companion is published; the environment registry validates ownership and collected values at each mutation/read; it publishes no independent snapshot that a companion could cross-check. |

### Request resolution

The tool resolves each workdir before `ctx.shell.resolve()` runs: an explicit relative `workdir` is resolved against the session cwd, and a sandbox policy's canonical workspace root wins so confinement and launch use the same identity. Sandbox policy resolves per call through `ctx.sandboxPolicy`; an escalation request goes through `ctx.approval` before anything executes, and the tool fails at load if the executor confines but no policy service is mounted.

### Rendering story

Element sections reuse the shared `renderFrames` from `dsh-shell`, which in turn reuses `renderResult`'s marker grammar verbatim: stdout, `[stderr]` section, truncation notice, sandbox denial, timeout, signal, and exit code lines. The terminal UI presents a frames call as a generic execute card listing every command while pending, and result text as fenced console output when settled; one exit pill cannot represent several elements, so the terminal card stays reserved for singular calls.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shell family to the executor seam, the job runtime, and the decision notes behind the behavior.

- [shell package map](../README.md) — the bash capability family and its roles.
- [Bash executor subsystem](../../../docs/subsystems/shell.md) — request/spec vocabulary, results, and background processes.
- [shell-env](../shell-env/README.md) — the managed `DSH_*` environment every call receives.
- [tool-jobs](../../jobs/tool-jobs/README.md) — `job_output`, `job_list`, and `job_kill` controls for background runs.
- [multi-command shell calls Agent Note](../../../.agents/notes/implemented/feature/2026-10-07-multi-command-shell-calls.md) — the batch-face design and its rejected alternatives.
- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-bash-frames) — the exact `bash` argument schema.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-bash-frames) — every accepted config field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

### System prompt

#### What the model sees

Every request in this plugin's registration scope contains the bash guidance below at the shared `TOOL_BASH` order. The guidance names the batch face — one call for independent shell work, each element settling on its own — beside the singular habits. The policy owner contributes current sandbox state through its cache-safe runtime context rather than changing this section.

##### Bash guidance

```markdown
Bash covers builds, git, installs, and test runners, the work no structured tool performs; pass a short description so the user can follow what ran. Example: bash pnpm test with filter api after code changes, with description Run api package tests. Use `commands` when independent shell work arrives together — one call running the narrowed test, grepping the symbol, and listing the directory. Check the [exit code: N] marker on every bash result; investigate failures before moving on.
```

#### Token effect

Small fixed input cost per request while the plugin is active, unchanged by sandbox mode or mode switches.

#### KV Cache effect

Prefix-stable while the registration scope and prompt text are unchanged. Plugin activation or disposal may invalidate reuse from this prompt section; sandbox mode switches do not.

### Tool schemas

#### What the model sees

The model sees the generated [`bash` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-bash-frames): the v1 singular parameters plus `commands`, the batch face whose elements carry `command`, `description`, `workdir`, `timeoutMs`, and (when enabled) `run_in_background`. `run_in_background` appears only when this producer enables it; `sandbox_permissions` and `justification` appear only when the mounted executor advertises sandboxing and apply to singular calls only. Agent-scoped tool restrictions can remove the definition for that agent.

#### Token effect

Fixed schema cost on every request where the tools are visible; the `commands` face adds one array parameter; sandbox support adds the escalation fields and its conditional description paragraph.

#### KV Cache effect

Prefix-stable while visibility, background support, and executor sandbox capabilities are unchanged. A restriction, config change, or executor change may invalidate reuse from the first changed tool definition.

### Foreground result

#### What the model sees

A singular call renders exactly as `dsh-tool-bash` does: the data-dependent stdout tail, optional `[stderr]` section, and conditional marker lines. A `commands` call renders one `[i/N] $ <command>` section per element in submission order, each with its element's output and the same conditional markers; a background element's section reads `started background job <jobId>`, and an element skipped after an abort reads `[not run: <reason>]`.

#### Token effect

Zero result tokens before a call. Each element's output is bounded by the executor's stream caps, so a batch's result is bounded by element count times those caps; every emitted line remains in history until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Background job context and results

#### What the model sees

A background element's frame carries exactly `started background job <jobId>`. This producer supplies incremental process output, optional spill notices, sandbox facts, and terminal detail to the generic job runtime. [`dsh-tool-jobs`](../../jobs/tool-jobs/README.md) owns the visible status line, completion notice, listing, and cancellation response.

#### Token effect

The frame acknowledgement is small and retained; collected output is data-dependent and bounded by the executor's stream buffers. Consuming reads do not repeat prior output.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

### Tool errors

#### What the model sees

Validation and policy failures are normalized as `Error: <message>`. This package's stable messages are the singular messages of `dsh-tool-bash` plus `invalid args: `command` and `commands` are mutually exclusive`, `invalid commands: expected a non-empty array of command objects`, `invalid commands: at most <N> elements, got <n>`, `invalid args: sandbox_permissions applies to one-command calls only`, `invalid commands element: expected a non-empty command string`, `invalid commands element description: expected a non-empty string`, and `invalid commands element timeoutMs: expected a positive number, got <value>`.

#### Token effect

Only the failing call adds these retained tokens; a validation failure runs nothing.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the tool is a poor fit or needs special care. They are current package constraints, not a task backlog.

- **Elements run serially in v1** — a batch saves round trips, not wall-clock time; a batch that must run concurrently waits for the whole element list to finish.
- **Escalation is singular-only** — `sandbox_permissions` never rides a batch; a denied element must be retried as a singular call to escalate.
- **No concurrency classifier** — the tool declares itself concurrent-unsafe for the whole call, so batches never overlap with other shell work.
- **Replay exit pills parse from result text** — output whose final line happens to be exactly `[exit code: N]` / `[killed by signal: …]` shows a wrong pill on session replay, because the parse treats it as the marker it consumes; a display-only known residual.
- **The `bash` tool opts out of `timeout-policy` budgets** — it keeps the executor-owned `BASH_TIMEOUT` path, per [the tool-call timeout-policy Agent Note](../../../.agents/notes/implemented/architecture/2026-07-07-tool-call-timeout-policy.md).
- **Background processes have no executor timeout** — callers must use `job_kill`, or rely on owner/service disposal, when work no longer matters.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
