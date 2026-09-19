---
description: "Claim surface for the Web GUI: the claim status row in the chat turn tail that shows the session's current pending claim; for users and maintainers of the claim experience."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-claim

English | [中文](README.zh.md)

## Summary

The Web GUI claim surface turns the session's durable claim into one status row in the chat turn tail, directly above the assistant action row (copy / Like / Dislike). While a claim is pending, every turn's row mounts the same chip — the chip follows the session's current pending claim, not the owning turn — and a strip docked above the composer repeats it while the session runs. Hovering or focusing the chip shows the claim's purpose, its satisfy condition, and the last verifier run. The plugin only reads the `claim` session projection; it declares no actions and creates no claims. Shipped Web presets mount it; removing the `ui-claim` row from the web-app bundle's patch removes the surface entirely.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin alongside `ui-chat`; the row then appears directly above the copy / Like / Dislike action row while a claim is pending. The chip shows `Verifying claim` while the claim is open; once no claim is pending, the row renders nothing. A session without the claim capability has no `claim` projection and renders nothing; a session with no pending claim renders nothing.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The chip is a pure reader: `useProjection('claim')` delivers the host-computed, turn-ordered ledger as one whole snapshot per update, and the action-row entry selects the session's current pending claim from it, regardless of which turn declared it. There is no client-side fold, no domain store, and no mutation path.

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
