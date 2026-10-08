---
description: "The model-facing frames bash tool for users and maintainers choosing, configuring, or debugging batched command execution with one labeled result frame per element."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-bash-frames

## Summary

`dsh-tool-bash-frames` registers the `bash` tool whose only call shape is the `commands` batch: one invocation fans out across independent fresh-shell dispatches, and each element settles into its own labeled frame with its own exit code, timeout, sandbox marker, or background job id; every element runs even if an earlier one fails. An element's `run_in_background` starts a background job, and its `sandbox_permissions`/`justification` widens the sandbox mode for that element alone. Shipped presets mount it in place of `dsh-tool-bash` under the same plugin id, so id-keyed disabling keeps working; it needs an executor such as `dsh-bash-local` or `dsh-bash-sandbox` and `dsh-shell-env`.

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
| `enableRunInBackground` | `true` | Expose element `run_in_background`; when `false`, background elements are rejected |
| `maxCommandsPerCall` | `8` | Maximum elements one `commands` invocation may carry |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-bash-frames) is the exhaustive source for every accepted field and its JSDoc; the generated [tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-bash-frames) carries the full argument schema.

### Running commands

A call carries one to `maxCommandsPerCall` elements; each runs as its own fresh-shell dispatch, serially in written order, and the result is one section per element headed `[i/N] $ <command>` with that element's output and markers exactly as a one-command result would render them. A non-zero exit on one element is reported in its own frame and does not stop later elements; steps that must read an earlier output belong in a later call. An element's `workdir` and `timeoutMs` override the call-level `workdir` and `timeoutMs` defaults, and an element's `run_in_background` starts a background job whose frame reads `started background job <jobId>`; the job runtime's `job_output`, `job_list`, and `job_kill` manage it. A `description` in active voice (5–10 words) labels the call in the UI. Output beyond the executor's stream caps is truncated to its tail, with the full output saved to a spill file whose path is reported.

### Sandboxed execution and escalation

When the mounted executor confines commands (for example `dsh-bash-sandbox`), a blocked file operation is reported in the denied element's frame as `[sandbox: file access denied under <mode> mode]` — a policy denial, not a command failure. Escalation rides a single element: it pairs `sandbox_permissions` with a one-sentence `justification`, and one approved retry widens the sandbox mode for that element alone while its siblings keep the standing policy. The approval gate refuses without a sandboxing executor and fails closed when no approval channel exists; a call cancelled while an approval is outstanding never detaches work.

### What can go wrong

A composition with no executor provider never activates the tool. Background elements without the job runtime fail with `background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs`, and an element `sandbox_permissions` without a sandboxing executor fails with `sandbox_permissions is not available in this composition (no sandboxing executor to escalate)`. `enableRunInBackground: false` removes the element parameter and rejects a forced background element at execution time; an element list over `maxCommandsPerCall` or a root-level `sandbox_permissions`/`justification` fails before anything executes.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the tool and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **Model-facing consumer of the shell seam.** The tool is the Consumer role of the bash capability: it registers the `bash` schema, renders results, and resolves per-call policy, while the executor seam owns process mechanics.
- **A batch is its elements.** `executeFrames` dispatches each element through the same resolve/run path a one-command call would use, so each element inherits workdir defaulting, the call-level timeout fallback, the managed `dshEnv`, and either the standing policy or that element's approved escalation mode; the output union is the frames arm with `job` and `not-run` outcomes.
- **Non-zero exits are reported, not errored.** Only infrastructure failures (spawn errors, aborts) surface as tool errors; the model interprets exit codes and markers per frame.
- **Background work belongs to the job runtime.** A background element registers a process handle with `ctx.jobs`; ids, ownership, completion notices, and disposal are the runtime's, and this tool only maps bash exit and sandbox facts into job output.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: tool registration, prompt section, arg validation, per-element escalation, frames dispatch |
| [`src/background.ts`](src/background.ts) | Map a settled background process onto generic job outcome vocabulary |
| — | Model-facing result text lives in [`dsh-shell`](../shell/README.md): streams, markers, truncation notices, and the shared `renderFrames` sectioning. |
| — | No runtime invariant companion is published; the environment registry validates ownership and collected values at each mutation/read; it publishes no independent snapshot that a companion could cross-check. |

### Request resolution

The tool resolves each workdir before `ctx.shell.resolve()` runs: an explicit relative `workdir` is resolved against the session cwd, and a sandbox policy's canonical workspace root wins so confinement and launch use the same identity. Sandbox policy resolves per call through `ctx.sandboxPolicy`; an element's escalation request goes through `ctx.approval` before that element dispatches, and the tool fails at load if the executor confines but no policy service is mounted.

### Rendering story

Element sections reuse the shared `renderFrames` from `dsh-shell`, which in turn reuses `renderResult`'s marker grammar verbatim: stdout, `[stderr]` section, truncation notice, sandbox denial, timeout, signal, and exit code lines. The Host presenters stay generic — a pending call is an execute card listing every command and a settled result is fenced console text, because one terminal exit pill cannot represent several elements — while the Web Client owns a richer keyed `bash` toolview (`bash-row` in `@deepseek-ai/dsh-client-ui-tool`): it splits the same section grammar into one terminal block per element, each with its own exit pill, copy control, and elapsed-time accessory read from the call's persisted presentation meta, draws backgrounded and skipped elements as detach lines, and ticks a live elapsed timer in the row suffix while the batch runs. Non-batch shell calls and malformed or older recordings degrade to the single-exit terminal card or the generic row.

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
- [commands-only bash surface Agent Note](../../../.agents/notes/implemented/feature/2026-10-07-commands-only-bash-surface.md) — the decision to make the batch face the tool's only call shape.
- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-bash-frames) — the exact `bash` argument schema.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-bash-frames) — every accepted config field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

### System prompt

#### What the model sees

Every request in this plugin's registration scope contains the bash guidance below at the shared `TOOL_BASH` order. The guidance names the batch face — one call for independent shell work, each element settling on its own. The policy owner contributes current sandbox state through its cache-safe runtime context rather than changing this section.

##### Bash guidance

```markdown
Bash covers builds, git, installs, and test runners, the work no structured tool performs; pass a short description so the user can follow what ran. Example: bash pnpm test with filter api after code changes, with description Run api package tests. Batch the independent steps of one thought into one `commands` call — one call running the narrowed test, grepping the symbol, and listing the directory instead of three calls; a step that reads an earlier output belongs in a later call. Check the [exit code: N] marker on every frame; investigate failures before moving on.
```

#### Token effect

Small fixed input cost per request while the plugin is active, unchanged by sandbox mode or mode switches.

#### KV Cache effect

Prefix-stable while the registration scope and prompt text are unchanged. Plugin activation or disposal may invalidate reuse from this prompt section; sandbox mode switches do not.

### Tool schemas

#### What the model sees

The model sees the generated [`bash` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-bash-frames): required `commands` carrying one to `maxCommandsPerCall` elements, each with required `command` plus optional `description`, `workdir`, `timeoutMs`, and — when this producer enables it — `run_in_background`; when the mounted executor advertises sandboxing the elements also carry `sandbox_permissions` and `justification`. Optional root `workdir` and `timeoutMs` default elements that omit their own, and `description` labels the call. Agent-scoped tool restrictions can remove the definition for that agent.

#### Token effect

Fixed schema cost on every request where the tools are visible; sandbox support adds the element escalation fields and its conditional description paragraph.

#### KV Cache effect

Prefix-stable while visibility, background support, and executor sandbox capabilities are unchanged. A restriction, config change, or executor change may invalidate reuse from the first changed tool definition.

### Result

#### What the model sees

A call renders one `[i/N] $ <command>` section per element in submission order, each with its element's output and the conditional marker lines; a background element's section reads `started background job <jobId>`, and an element skipped after an abort reads `[not run: <reason>]`. Each foreground element's canonical frame also carries `durationMs` — the element's wall time measured at dispatch — and `output.presentationMeta` persists the per-index durations with the session log so the Web frames card shows per-element elapsed time on replay.

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

Validation and policy failures are normalized as `Error: <message>`. This package's stable messages are `invalid description: expected a non-empty string`, `invalid args: sandbox_permissions and justification apply per commands element`, `invalid commands: expected a non-empty array of command objects`, `invalid commands: at most <N> elements, got <n>`, `invalid commands element: expected a non-empty command string`, `invalid commands element description: expected a non-empty string`, `invalid commands element timeoutMs: expected a positive number, got <value>`, plus the shared escalation pairing messages (`invalid escalation: sandbox_permissions requires a justification`, `invalid escalation: justification is only valid together with sandbox_permissions`, `invalid justification: expected a non-empty sentence`).

#### Token effect

Only the failing call adds these retained tokens; a validation failure runs nothing.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the tool is a poor fit or needs special care. They are current package constraints, not a task backlog.

- **Elements run serially in v1** — a batch saves round trips, not wall-clock time; a batch that must run concurrently waits for the whole element list to finish.
- **Escalation widens one element** — an approved `sandbox_permissions` retry never lifts the standing policy for sibling elements or later calls; a batch whose whole element list needs a wider mode repeats the pair per element.
- **Root-level escalation is a stale shape** — recorded or hand-built calls carrying `sandbox_permissions`/`justification` at the call root fail with `invalid args: sandbox_permissions and justification apply per commands element`.
- **No concurrency classifier** — the tool declares itself concurrent-unsafe for the whole call, so batches never overlap with other shell work.
- **The `bash` tool opts out of `timeout-policy` budgets** — it keeps the executor-owned `BASH_TIMEOUT` path, per [the tool-call timeout-policy Agent Note](../../../.agents/notes/implemented/architecture/2026-07-07-tool-call-timeout-policy.md).
- **Background processes have no executor timeout** — callers must use `job_kill`, or rely on owner/service disposal, when work no longer matters.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
