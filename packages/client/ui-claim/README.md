---
description: "Claim surface for the Web GUI: the per-turn claim status row in the chat turn tail that shows what each turn promised and how its verifier settled; for users and maintainers of the claim experience."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-claim

English | [中文](README.zh.md)

## Summary

The Web GUI claim surface turns each turn's durable claim into one status row at the bottom of that turn's tail, directly above the assistant action row (copy / Like / Dislike). The row mounts as soon as the turn's claim is declared — a pending state with an animated dot — and stays mounted after settlement, so a failed or tampered claim remains visible on the finished turn. Hovering or focusing the chip shows the claim's purpose, its satisfy condition, the last verifier run, and, for a blocked claim, the settlement's explanation. The plugin only reads the `claim` session projection; it declares no actions and creates no claims. Shipped Web presets mount it; removing the `ui-claim` row from the web-app bundle's patch removes the surface entirely.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin alongside `ui-chat`; the row then appears directly above the copy / Like / Dislike action row of every turn that declared a claim. The chip shows `Verifying claim` while the claim is open, `Claim passed` after a passing settlement, and `Claim failed` or `Claim tampered` after a settlement without passing. A session without the claim capability has no `claim` projection and renders nothing; a turn that declared no claim renders nothing.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The chip is a pure reader: `useProjection('claim')` delivers the host-computed, turn-ordered ledger as one whole snapshot per update, and the turn-status entry selects the row whose `turn` matches the owning Turn's location. There is no client-side fold, no domain store, and no mutation path. The `conversation.chat.turnStatus` list slot is a list, not a chain, so the claim row coexists with any other turn-status contributor and with the turn-tail chain above it.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-claim](../../claim/claim/README.md) — the claim domain: the `claim/*` events, the projection, and the settlement policy this surface reads.
- [ui-chat](../ui-chat/README.md) — declares the `conversation.chat.turnStatus` slot and owns the turn tail.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

None. The chip reads the durable `claim/*` events through the projection and renders them to the human; it adds no model-visible input, prompt content, or tool surface.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Read-only surface** — the chip renders the durable ledger only; re-running or abandoning a claim stays model-side via the existing tools.
