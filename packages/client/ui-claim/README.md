---
description: "Claim surface for the Web GUI: per-turn claim chips in the chat turn tail plus a compact Claims dropdown in the composer; for users and maintainers of the claim experience."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-claim

English | [中文](README.zh.md)

## Summary

The Web GUI claim surface turns the session's durable claims into compact status chips in two placements. Each turn's tail lists every claim that turn declared — pending or settled — as a chip labeled with the claim's `title` and a status dot (blue while verifying, green when passed, red when failed or tampered); clicking a chip opens its details card (title, description, the raw verifier script, the last run, and the blocked reason). The composer's accessory row carries a compact `Claims` trigger with an aggregate dot — red when any claim failed, blue while any is pending, green once all passed — that opens a dropdown menu of the latest turn's claims. The plugin only reads the `claim` session projection; it declares no actions and creates no claims. Shipped Web presets mount it; removing the `ui-claim` row from the web-app bundle's patch removes the surface entirely.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin alongside `ui-chat`. Each turn's action row then lists that turn's claims — settled ones stay viewable — and the composer shows the `Claims` dropdown trigger once any claim exists. A session without the claim capability has no `claim` projection and renders nothing; a turn that declared no claim renders nothing in its action row.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The chip is a pure reader: `useProjection('claim')` delivers the host-computed, turn-ordered ledger as one whole snapshot per update. The action-row entry filters the ledger to the owning Turn; the composer trigger filters it to the latest turn and derives its aggregate dot from the settlements. There is no client-side fold, no domain store, and no mutation path.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- `@deepseek-ai/dsh-claim` (`packages/claim/claim`) — the claim domain: the `claim/*` events, the projection, and the settlement policy this surface reads.
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
