---
description: "Readable-answers conversation rules: four evidence-grounded core rules contributed as one static system-prompt section."
kind: "package"
---

# readability-rules/

Contributes one static system-prompt section named `readability:plain-answers` carrying four core readability rules: Answer First, Readable Sentences, One Name Per Concept, and Active, Concrete Language. The rationale and the experiment trail (term registry, harvester, embedding seam — all shelved) live in the [Agent Note](../../../.agents/notes/implemented/feature/2026-10-13-readability-conversation-rules.md).

## Configuration

None. The section text is a constant; a deployment tunes the contribution by disabling or replacing the composition row by `id` (`readability-rules` in the base bundle).

## Extension points

No extension points — the package is terminal text. The source of the section text is `PLAIN_ANSWERS_RULES` in `src/index.ts`; edit it there with the note as the review contract.

## Model Experience

The model sees the four rules on every request as part of the system prompt, after the staging core rule (external order 143). The rules ask for conclusion-first structure, short-distance dependents, one stable name per concept, and active concrete verbs — behavior that lands in every visible reply. No tools are added or renamed; no model state changes. Snapshot sessions recorded before this package's introduction change because their system prompt has changed; that refresh sweep ships with the introducing PR.

## Known Limitations and Deferred Work

- The enforcement net is prompt compliance alone: there is no downstream check on the rules. Recorded-session snapshots are the leading indicator; the Agent Note carries the escalation (registry/harvesting machinery) as reopenable shelves.
- Two drafted rules (Scannable Layout, Read the Reader) were cut at selection; a per-request reader-calibration hint via `ctx.systemPrompt.context(...)` is the deferred follow-up if telemetry shows mixed-audience failure.
- No `./invariant` companion: the package owns no relationship independent observations can diverge on — its only observable is one static section registration, verifiable from a single observation.
- The plugin is zero-config by design; `audience` calibration was deliberately shelved with the rules it fed.
