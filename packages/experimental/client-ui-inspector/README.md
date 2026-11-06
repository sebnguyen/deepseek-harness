---
description: "Display live Host and browser Cordis Context/Fiber trees in the Web global sidebar."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-inspector

## Summary

This private package adds a **Cordis runtime** tab to the Web global sidebar. It reads the experimental Inspector's detached Host and Client snapshots and renders their Context and Fiber relationships without opening Chrome DevTools. The package is experimental, has no configuration fields, and contributes no model-facing behavior.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Apply either existing [Inspector overlay](../inspector/README.md#configuration). Both overlays mount the Inspector Host plugin and this package's inert Host entry; the Client module scanner then mounts both browser entries. The default Web profile does not include either package.

The **Cordis runtime** bottom-sidebar control sits at the shared footer size with the other actions and opens a root-scoped main panel with one section for the Host and one for browser Clients. Expand a Context to see its child Fiber and Context layers. Each Fiber's owned Context appears directly beneath it. All Fiber and Context rows start expanded. Fiber rows show their Loader entry or plugin callback name and lifecycle; their detail list exposes declared injects, cached service-to-provider links, and provided-service names. Realm rows show the latest revision, connection state, and node-limit truncation.

Provider buttons focus their actual realm's Fiber, even when Host and Client realms repeat a uid. Focus expands collapsed ancestors and retries after clearing filters that hid the target. The root Fiber is omitted, and disposed or absent providers produce an unavailable notice rather than a broken focus action.

Service selection also opens an optional preview pane with that service's current value or type summary. Each preview is fetched once when selected and discarded after close, replacement, or disposal rather than polled with the tree. An older response cannot replace a newer selection. Preview output may contain secrets and must only be selected for values intended for this local debugging UI.

**All realms**, **Host only**, and **Browser clients only** select whole sections without changing the Worker snapshot. **Hide empty Fibers and Contexts** is off by default; enabling it prunes leaves with no nested Fibers, declared injects, cached services, or provided services and removes Context branches left with no surviving Fibers while retaining ancestors of useful subtrees. A realm with no surviving nodes shows an explicit empty state. Filters affect only this presentation, not inspection or other consumers.

The first visible reader queries immediately and later reads occur once per second after the prior query settles. Hiding the panel stops polling. **Refresh** requests an immediate read, and a failed read retains the last successful tree beside the failure notice. Removing or unloading the plugin removes both slot contributions and stops its reads.

<a id="understand-the-implementation"></a>
## Understand the implementation

The client plugin requires `inspector`, `slots`, and `locale`. It registers `sidebar.panellist` for navigation and the matching `main` key for content. The `tree-source.ts` observable owns single-flight queries, subscription generations, and polling; `CordisTreePanel.tsx` receives that source through the framework's `hooks` injection and contains no transport or Cordis access. The Host export is inert.

The source reuses `ctx.inspector.cordis.getTree()` and its bounded `CordisRuntimeTree` values rather than collecting live objects again. `filter-tree.ts` recursively prunes matched snapshots without mutating their source; the component derives filtered views with `useMemo` while keeping filter controls in local view state. `service-selection.ts` maps realm-scoped selections to focus keys and exact Worker coordinates, including ordinal duplicate services. `service-preview.ts` owns one-shot reads and invalidates superseded results; the pane renders JSON or summaries without evaluating objects in React. Transport-independent snapshot generation and reachability rules remain owned by the [Inspector package](../inspector/README.md#cordis-tree-inspection).

<a id="model-experience"></a>
## Model Experience

None. This read-only browser projection adds no model-visible input.

#### KV Cache effect

None; the package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **On-demand value boundaries** — preview output includes JSON-compatible content selected through the Inspector; unsupported, accessor-backed, circular or class instances become summaries. Plugin configs and full live-object inspection remain in DevTools.
- **Polling transport** — the Inspector query protocol has no tree subscription, so updates poll rather than arriving through push notifications.
- **Reachable tree only** — root-Fiber omission, bounded collection, and contexts the Inspector cannot discover retain the Inspector's existing limits.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The visible contract is disposal-safe slot composition over a read-only service; component tests, observable-source tests, and the real Web composition test cover that relationship without introducing an independently observable engine invariant.
