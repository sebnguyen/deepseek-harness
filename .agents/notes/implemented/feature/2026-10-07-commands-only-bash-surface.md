# Agent Note: Commands-only bash surface — the batch face as the sole call shape

Status: implemented

## Problem

`dsh-tool-bash-frames` shipped with the v1 singular face kept byte-identical beside the batch face so preset migrations stayed invisible ([multi-command shell calls](2026-10-07-multi-command-shell-calls.md)). The parity outlived its purpose once the shipped presets all mount the frames provider: models offered both faces keep emitting singular calls — the one-thought-one-call degeneration the batch face exists to defeat — and every consumer (validation, presenters, the PTC SDK example, the Web approval detail, the catalog) pays for two argument shapes that only differ in whether the batch wraps one element. The singular face's two call-level privileges (whole-call `run_in_background`, whole-call escalation) were the only behaviors the batch could not express, and both had natural element-shaped owners.

## Decision

The frames tool's `bash` schema carries the `commands` batch as its only execution face. Root parameters reduce to `commands` (required), `description` (required), and element defaults `workdir` and `timeoutMs`; the call-level `command`, `run_in_background`, `sandbox_permissions`, and `justification` are gone from the schema, and validate rejects a root escalation pairing with `invalid args: sandbox_permissions and justification apply per commands element` so stale or injected singular-shaped calls fail loud instead of silently dropping the escalation.

Backgrounding rides the element: `run_in_background` on an element detaches that element through the unchanged `startBackgroundJob` path, so a one-element call is the successor of a singular background call and the `background` output arm disappears with the singular result arm — the tool's canonical output is now the frames arm alone.

Escalation rides the element, as the wrapper the existing singular mechanism always was: `sandbox_permissions` plus `justification` on an element resolves that element's one-shot approval through the shared `requestBashEscalation` sequence before that element dispatches, and the granted mode applies to that element's policy alone while siblings keep the standing policy. Approval failures still fail the call before any element starts, and a cancellation landing during the approval never detaches work: a background element aborts with the bare abort contract, a foreground element settles into a `not-run` frame.

Presentation is generic-only: one exit pill cannot represent several elements, so a pending call is a generic execute card listing every command and a settled result is fenced console text; the terminal card stays reserved for the single-exit tools (`dsh-tool-bash`, the persistent twins). The singular `dsh-tool-bash` stays published and untouched for profiles that pin it, and `renderToolsSdk`'s bash example predicate accepts either face per the registered schema, so singular compositions keep their byte-stable PTC fixtures while frames compositions teach the batch example.

Recorded sessions never replay through the frames schema (snapshot harnesses mount the singular tool), and the presenters soft-validate, so UI replay of older singular recordings degrades to generic rendering rather than failing.

## Alternatives considered

**Keep the singular face as a compatibility alias.** Silently coercing a root `command` into a one-element batch papers over exactly the emission habit the design fights, keeps two argument shapes in every consumer, and makes the migration permanent by making it painless to postpone.

**Whole-call escalation.** The approval plane grants one mode to one call; widening every element because one element was denied grants write authority to commands that never asked for it, violating the approved-retry scope the sandbox note defines. Element scope is the element-level wrapper of that retry.

**Whole-call backgrounding.** A second job arm per call adds a second label and output vocabulary for a need the element job already serves; a call that must run wholly in the background is a one-element call with a backgrounded element.

## Consequences

- The frames schema is `commands` + `description` plus element defaults; the model sees only the batch habit, matching the `write` `edits[]` precedent with the singular escape removed.
- Escalation grants are element-scoped: an approved retry never widens siblings or later calls, and the composition guard, no-channel fail-closed paths, and approval outcome mapping are unchanged at the element level.
- The Web terminal card does not render frames calls as terminal cards; `commandOf` resolves the approval detail's command from the batch's first element, and the batch summary rides the call's `description`.
- Generated surfaces (tool catalog, config catalog) and the shell subsystem page, frames README, and this note's predecessor regenerate around the single face.
- `dsh-tool-bash`, being the byte-stable singular owner for pinned profiles and snapshot harnesses, keeps the old validation and presenters; parity between the two bash consumers is now a historical relationship, not a maintenance contract.

## Risks

**Singular batches.** One-element calls pay the `[1/1] $ <command>` header line per result; the cost is one line per call and buys a uniform parse against every shell result, which the per-invocation output-budget telemetry deferred by the multi-command note already watches.

**Stale hand-built callers.** Anything still emitting `{command}` to a frames composition now fails with `missing required property "commands"`; that fail-loud rejection is the migration signal, and no shipped composition trips it.

## Deferred work

- The `commands` face on `dsh-tool-pwsh` and the persistent twins remains deferred per the multi-command note.
- Per-invocation output budget and read-only concurrency classifier remain telemetry-gated per the multi-command note.
