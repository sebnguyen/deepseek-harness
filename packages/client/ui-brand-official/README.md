---
description: "Official DigitalOcean Harness brand occupant for the sidebar, active only in official builds; for users and maintainers choosing or replacing brand presentation."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-brand-official

## Summary

This package gives an `official` client build the DigitalOcean mark in the sidebar brand row. Other build profiles keep the shell's identical DigitalOcean mark fallback, the sidebar name stays the shell's localized `DigitalOcean Harness` label in every profile, and the conversation hero shows the same plain product headline everywhere. Choose it for deployments branded as DigitalOcean Harness; deployments with another identity should provide a replacement brand package. It has no runtime state and does not affect model requests.

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

Mount this plugin in the browser roster of a deployment whose identity is DigitalOcean's own, then build the client with the `official` profile so the occupant registers.

### Choosing the profile

`DSH_CLIENT_BUILD_PROFILE` selects whether the mark registers. An `official` build shows the official DigitalOcean mark in the sidebar; any other value leaves the shell fallback — the same DigitalOcean mark — in place, and the localized product label renders either way. The conversation hero shows the plain product headline from `dsh-client-ui-conversation` regardless of profile. The plugin still loads and validates in both cases; only the registration is profile-gated.

### Replacing the brand

A deployment with its own identity leaves this package out and composes another package that occupies the sidebar slots. Occupying a slot is the only composition route; there is no brand configuration surface here.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The occupant installs as one declaration-aware registration: `ctx.slots.inject()` waits on the sidebar declaration, so it works whether this row activates before or after the declarer, withdraws the occupant when the declaration collapses, and leaves no partial brand mix during HMR. The browser half is [`src/client/index.ts`](src/client/index.ts); the node half is an empty Loader seat. The browser title and the sidebar name are build-environment and locale concerns (`DSH_CLIENT_TITLE`, the shell label), outside the slot system.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the brand surface is not enough. They move from the slots this package occupies to the shell that renders them.

- [ui-sidebar](../ui-sidebar/README.md) — declares `sidebar.brand.mark` and `sidebar.brand.name` and renders their fallbacks.
- [ui-conversation](../ui-conversation/README.md) — owns the conversation shell and its hero.
- [Web client architecture](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md) — how browser plugin rows load and register slots.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None, as the package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define how brand presentation is supplied. They are current package constraints, not a brand-design comparison or a task backlog.

- **One occupant** — alternative presentation belongs in another Cordis package occupying the same slot.
- **The sidebar name is shell-owned** — the official profile keeps the localized product label instead of registering a name occupant.
- **The browser title is independent** — `DSH_CLIENT_TITLE` selects title text at build time rather than through a UI slot.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The package retains no mutable state, and its slot occupant installs and leaves through one transactional effect.
