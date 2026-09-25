---
description: "The durable verification-claim service for users and maintainers choosing, configuring, or debugging declared conditions and their recorded verifier runs."
kind: "package-reference"
---

# @deepseek-ai/dsh-claim

## Summary

`dsh-claim` stores immutable verification claims — any number per turn, one per independent condition — each carrying what must be true when it is settled, the one bound shell verifier, every verifier run recorded against it, and how it finally settled. The service is pure state — it registers no tool and contributes no prompt text — so mounting it alone records claims without prompting the model or running anything. The model tools live in `dsh-tool-claim` and the turn-boundary policy lives in `dsh-claim-settlement`.

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

Mount `dsh-claim` in any composition that should record declared claims durably. It requires `ctx.sessionProjections`; a composition that omits the projection registry cannot activate `ctx.claims`. The package declares no configuration.

```yaml
- name: '@deepseek-ai/dsh-claim'
```

### Drive the lifecycle

A claim moves through durable moments — declared, zero or more recorded verifier runs, settled — and the service exposes one operation for each, all of which take the exact live `Agent`.

| Operation | What it does |
|---|---|
| `openClaims(agent)` | Read the open turn's pending claims in declaration order |
| `turnClaims(agent)` | Read every claim of the open turn, pending or settled, in declaration order |
| `ledger(agent)` | Read every claim of the current session in turn order |
| `declare(agent, { title, description, script })` | Open one claim of the turn and hash the script into a frozen verifier |
| `record(agent, id, result)` | Append one verifier execution to that claim |
| `settle(agent, id, settlement)` | Close that claim terminally |
| `abandon(agent, id, message)` | Close it as blocked because the condition itself was wrong |
| `failures(agent, id)` | Count recorded `fail` results for that claim |
| `bindVerifier(source)` | Hash one script text into a frozen `Verifier` binding |

A claim's `settlement` starts as `{ kind: 'pending' }` and ends as `passed`, `tampered`, or `blocked` with a code of `abandoned`, `repair-budget-exhausted`, or `verifier-unavailable`. `declare` is refused while no turn is open or the request is invalid; a turn may declare any number of claims, each identified by its own `turn` field.

`abandon` is refused until the bound verifier has run at least once, so a claim cannot be opened and closed to dodge verification. The refusal reads the count of recorded results, which means the guard is a fold over the log rather than separate bookkeeping.

### What survives and what does not

Every accepted change is a durable `claim/*` session event, so a resumed session reconstructs the same claims, their verifiers, and their results from the log alone. Nothing durable lives in process memory.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the package realizes the behavior above; the observable contract is covered in [Use this package](#use-this-package).

### Design

- **Event-sourced state.** `claim/declared`, `claim/result`, and `claim/settled` are log-only events carrying no `surfaceOp`, following the `hook/*` and `compaction/*` precedent. The session log is the only store.
- **Strict replay.** The fold validates every durable field — non-empty `title` and `description` (reading the released `purpose` and `satisfy` payload fields when present), one frozen verifier, a closed outcome set, a closed block-code set, monotonic revisions — and rejects an event that is not a claim's exact next revision or a result against a settled claim.
- **Provenance by hashing at the boundary.** `bindVerifier` computes the SHA-256 of the script text at declaration. Nothing else in the group trusts a verifier without rechecking that digest.
- **Projection unit.** The package requires the projection registry and registers a strict `claim` unit whose client value is `readonly Claim[]` across the session's turns. A decode failure latches in the projection state instead of throwing through the registry.
- **No compare-and-set surface.** Mutations operate on the claim the caller names rather than carrying an expected revision. The goal service needs that reference because a tool, a command, and a driver all mutate one goal concurrently; a turn's claims are written by one agent at a time, so the guard would defend against a race that cannot occur.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `ClaimService`, `bindVerifier`, the `claim` projection unit |
| [`src/types.ts`](src/types.ts) | Client-safe vocabulary: `Claim`, `Verifier`, `VerifierResult`, `ClaimSettlement` |
| [`src/domain.ts`](src/domain.ts) | Durable `claim/*` payloads and the session event map |
| [`src/fold.ts`](src/fold.ts) | Strict replay fold and decoder |
| [`src/runtime.ts`](src/runtime.ts) | `ClaimError` codes |
| [`src/brand.ts`](src/brand.ts) | `ClaimId` branded type and brander |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion: independent incremental fold |
| [`src/client.ts`](src/client.ts) | Client half-entry: the pure claim vocabulary without host-side imports |

### The projection unit

The `claim` key merges into `SessionProjectionStateMap` (strict state) and `SessionProjectionMap` (the client value). Its wire view is the full `Claim[]` of the session; a claim is identified by its own `turn` field, so there is no separate index keyed by turn.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Claim group map](../README.md) — the sibling packages and how they compose.
- [Declared verification claims Agent Note](../../../.agents/notes/implemented/architecture/2026-09-19-declared-verification-claims.md) — design rationale and alternatives.
- [Session subsystem](../../../docs/subsystems/session.md) — the durable log this service derives from.
- [Session projection package](../../session/session-projection/README.md) — the registry contract this unit registers into.

-----

<a id="model-experience"></a>
## Model Experience

### Claim records

#### What the model sees

Nothing. Every `claim/*` event is log-only and carries no `surfaceOp`, so no claim field reaches a request. The model learns about claims only through the tool schemas and prompt section owned by `dsh-tool-claim`, and through failure text steered by `dsh-claim-settlement`.

#### Token effect

None. This package contributes no prompt section, no tool schema, and no message. Claim events are excluded from derived model history.

#### KV Cache effect

None. Because the package writes no model-visible input, mounting it cannot invalidate a cached prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the package needs special care. They are current constraints, not a task backlog.

- **A claim's content is immutable for its turn.** There is no edit or amend operation. A claim that named the wrong condition is abandoned, never corrected, because allowing a rewrite would reopen the "fail, then redefine success downward" path that immutability closes.
- **A declaration can be retrofitted.** Nothing forces `declare_claim` before work starts; a claim declared mid-turn is still recorded and verified, but its condition was not a genuine pre-commitment.
- **The fold never closes an open claim at `turn/end`.** A claim left open at the turn boundary stays `pending` in the log; only `dsh-claim-settlement` or an explicit `abandon` closes one, so mounting `claim` alone leaves the last claim open.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
