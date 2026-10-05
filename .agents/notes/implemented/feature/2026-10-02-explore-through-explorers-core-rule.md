# Agent Note: Explore Through Explorers is a core rule in the assembled system prompt

Status: implemented

## Problem

Agents tasked with unknown territory read broadly in their own context: every page they read is re-submitted on each later turn (the echo, billed at the cache rate) and condensed away by auto-compaction exactly when it stops fitting. The wind-up/wind-down design moved discovery into read-only explorer children whose capped handoffs replace the parent's reading log, but that shape lived only in an opt-in preset and a proposed note. Compositions without the preset kept paying the quadratic echo, and even inside the preset the model needed a reason to spend its three-per-turn delegation budget on readers instead of reading inline. The rule had to reach every assembly that offers a delegation tool, with the reason, not just the ones that load the preset.

## Decision

Core Rule `Explore Through Explorers` is a built-in section of `dsh-system-prompt`: `harness:core-rule:explore-through-explorers`, order `140` in `SECTION_ORDERS`, appended last in `CORE_RULE_SECTIONS`. It tells the model to send discovery to explorer readers that write nothing and report findings only, and names the three reasons: parallel readers return sooner (speed), capped verified findings beat the model's fading memory of long files (correctness), and the handoff is paid once at a flat rate while pages read in session echo at the cache rate on every later turn (cost). It names the one-call `tasks` array as the mechanical half of the parallelism — several prompts in one explore call, children running at once — and keeps the brakes in the same sentence: the per-turn cap counts every child a batch spawns, and accepted handoffs convert to todo items before acting ([explore batch fan-out](../architecture/2026-10-02-explore-batch-fan-out.md)). It complements [Structure Your Search](./2026-09-25-structure-your-search.md), which orders the lookups themselves, and supplies the model-facing half of the proposed [wind-up/wind-down phase split](../../proposed/architecture/2026-10-02-wind-up-wind-down-phase-split.md) whose preset composition carries the same trade as deployment policy.

The section registers empty text unless the assembly offers a delegation tool (`subagent`, `explore`, or `delegate` in `registeredToolNames`), mirroring the prove-it gate on claim tools: a composition without readers would be steered toward a tool it cannot call. The text follows the oracle formatting rules of [core-prompt-guidance.md](../../../../docs/subsystems/core-prompt-guidance.md): plain ASCII prose, one paragraph, closing `Example:` line, no markdown, arrows, or unicode dashes.

## Alternatives considered

**Preset-only persona prose.** The wind-up-wind-down preset already carries discipline rows, but presets are opt-in compositions; the default, headless, SDK, and ACP assemblies that face unknown territory would keep the echo exactly where unattended runs do the most reading. Core rules exist precisely because they are the one guidance every assembly carries, and the gate keeps the rule honest where no reader is mounted.

**A `subagent` tool `Advice:` line.** Advice scope to one tool's schema and reads as usage help, not as a cost/correctness argument; the rule compares two ways of spending the turn and belongs beside the other cross-tool procedure rules.

**Folding into Structure Your Search or Context Over Inference.** Those govern ordering lookups and gathering facts for arguments, not the choice between reading in-session and delegating the read; folding would make the cost argument the tail of someone else's rule and the budget ratchet would own it awkwardly.

## Consequences

Every assembly with a delegation tool grows one section (762 characters), charged as a new per-section ceiling beside the existing ones and raising the aggregate ceiling from 8998 to 9760 in the same change, so the cost is visible and ratcheted. Assemblies without a delegation tool render the section as empty text, so their prompts are byte-identical to before and their snapshots do not move. The rule states the default and the reasons, not a veto: a single targeted read in own context remains the right call for a known file, and the Example names the batched three-reader case rather than forbidding inline reads.
