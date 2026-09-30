---
description: "Web background-activity surface: an input-dock chip and drawer unifying this session's jobs and subagents over the session-controller mirrors; for users and maintainers of the background-activity experience."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-activity

English | [中文](README.zh.md)

## Summary

This package renders the background-activity surface of the Web GUI: a chip docked above the composer that appears while the session owns at least one background item, and a drawer that opens beneath the composer by lifting the whole sticky stack. One row model joins the session's mirrored jobs with its direct subagent descendants; the tree splits live rows from an archive, and the detail pane shows a job's outcome text or an opening into a subagent's full session view. Every fact arrives through the Session Controller mirrors — `jobsBySession`, `subagentsByParent`, and the session summaries — and the two injected callbacks route through the sessions service's catalog verbs, so the plugin issues no RPC of its own. The model's own view of the same jobs belongs to `dsh-tool-jobs`; this package is a read-only projection for the human.

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

Mount the plugin alongside the runtime; the chip then appears in the input dock whenever the session owns at least one job or subagent. Its badge counts live work — running jobs plus running subagents — with a spinner while positive, and the badge is omitted when only settled rows remain. Clicking the chip opens the drawer beneath the composer: the Live section lists running work in start order, an Archive section, collapsed under a counted header behind an alive-only filter, keeps settled jobs with a legible failure detail and inactive subagents in newest-settled order. Selecting a job row shows its outcome — the producer's detail where one exists, the status word otherwise; selecting a subagent row shows its status and an open-as-session control, disabled until the parent's catalog is ready, that routes the child through its exact address. ArrowUp and ArrowDown walk the visible rows, Escape closes the drawer and returns focus to the chip.

### Retirement it carries

This package replaces the retired header job popover; the quiet entry point, zero-live badge, and legible failure detail decisions carry over unchanged. The header subagent catalog stays until the planned drawer tree inherits its contracts.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package contributes one entry to `conversation.input.dock` (`ActivityDock`), registered with `inject` callbacks whose closure reads `ctx.sessions`: `onRefresh` is the existing `refreshSubagents(parentSessionId)` kick, issued once per open so subagent rows gain catalog labels and modes, and `onOpenChild` resolves the child's retained address through `subagentAddress` and hands it to `openSubagent`, the same navigation the catalog uses. `model.ts` is the pure projection: job records become rows verbatim, direct subagent children are read from the session summaries and refined by a ready catalog, and `sections` orders live rows by start then settled rows newest-first with a same-millisecond tie broken on start order. The row clock ticks once per second only while an open drawer shows live work. The drawer renders inside the sticky composer stack below the input bar, so opening it lifts the stack in one geometry.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the activity surface is not enough. They move from the browser drawer to the registry and the model-facing tool.

- [dsh-tool-jobs](../../jobs/tool-jobs/README.md) — the model-facing jobs tool over the same registry.
- [Session Controller](../../api/session-controller/README.md) — folds the mirrors this package reads.
- [ui-subagent](../ui-subagent/README.md) — the subagent catalog whose header trigger retires with the planned drawer tree.
- [Web background-activity drawer](../../../.agents/notes/proposed/feature/2026-09-30-web-background-activity-drawer.md) — the design note this package implements.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package renders host-computed mirror state for a human and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the first-phase drawer. They are current package constraints, not a task backlog.

- **The tree is flat** — descendants nest no deeper than the session's direct subagent children, and a child's own jobs are the child's session's rows, not its parent's; descendant job frames and the lazy-descendant tree are the design note's second phase.
- **A row shows state but does not cancel** — cancellation owes the model-facing decision the 2026-08-08 note recorded: `kill()` marks terminal delivery reported, so a human interrupt would leave the model believing its job is still running.
- **Job rows show outcome, not raw output** — the terminal tail rides the job-output channel under construction beside this package; the detail pane gains the retained lines once that client mirror lands. The drawer does not embed a subagent transcript either: "open as session" is the P1 route into a child, and the embedded read-only transcript is the second phase.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. This package is a read-only projection of the list mirrors onto one input-dock slot entry. It emits no Cordis events, owns no cross-plugin mutable state, and its single slot registration proves disposal through the HMR-safety spec.
