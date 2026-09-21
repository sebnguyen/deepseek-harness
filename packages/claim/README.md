---
description: "The claim group map: immutable verification claims, one per declared condition, each with one bound shell verifier, model tools, and turn-boundary settlement, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/claim

## Summary

The claim group lets the agent open each work turn with an immutable declaration of why the turn exists and what must be true when it completes, bound to one shell verifier. The settlement package runs that verifier when the turn is about to close and steers a failure back for in-turn repair under a bounded budget. Claims are advisory: the group never blocks a tool call, escalates a sandbox mode, or changes what the model may do.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`claim`](claim/README.md) | Immutable claims, any number per turn: declare, record verifier runs, settle, abandon | `ctx.claims` |
| [`tool-claim`](tool-claim/README.md) | Model tools `declare_claim`, `run_claim`, and `abandon_claim`, the standing demand, and the per-turn reminder | registers on `ctx.tools`, `ctx.systemPrompt`, and `agent/pre-step` |
| [`claim-settlement`](claim-settlement/README.md) | Turn-boundary settlement: runs the bound verifier, steers repairs, owns the budget policy | no service key |

Mount all three for the complete loop. Mounting `claim` alone stores and serves claims without running or prompting anything.

-----

<a id="related-documentation"></a>
## Related documentation

- [Declared verification claims Agent Note](../../.agents/notes/implemented/architecture/2026-09-19-declared-verification-claims.md) — the design, its evidence, its alternatives, and the properties it knowingly gives up.
- [Claim subsystem](../../docs/subsystems/claim.md) — the claim seam reference.
- [Session projection](../session/session-projection/README.md) — the registry the `claim` projection unit registers into.
- [Shell capability](../shell/shell/README.md) — the executor seam every verifier runs through.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is not authoritative for shipped behavior.

None.

</details>
