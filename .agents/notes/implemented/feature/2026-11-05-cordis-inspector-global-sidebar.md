# Agent Note: Cordis Inspector global sidebar

Status: implemented

## Problem

The experimental Inspector exposes live Host and browser Context/Fiber trees through Chrome DevTools and a query API, but no Harness UI consumes that query API. Understanding plugin ownership therefore requires launching a separate DevTools document instead of using the application shell.

## Decision

The private `client-ui-inspector` package registers a shared-size **Cordis runtime** control in `sidebar.footer.action` with the other bottom-sidebar actions, plus a matching root-scoped `main` panel. The control opens that panel through `ctx.layout.selectPanel`; it is distinct from the dynamic plugin-management footer action. Both existing Inspector overlays also load this package's inert Host entry, allowing the ordinary Client module scanner to mount its browser entry. The stable Web profile remains independent of this opt-in view.

The panel renders `CordisRuntimeTree` snapshots without adding another collector. Host and Client realms expose revision, connection state, and truncation; nested Context and Fiber nodes reveal the ownership tree already present in the query model. Version-1 Fiber nodes add runtime and Loader entry identity, lifecycle, declared inject names, cached service-to-provider links, and provided-service names without copying service values or plugin configs. Runtime identity deliberately avoids `fiber.name`, which inherits an ancestor's name for anonymous plugins. Observer subscriptions include `internal/service` so changes to these stores refresh alongside lifecycle changes. The component receives a bare observable through slot `hooks` and never reads Cordis services or transport state directly.

A realm selector chooses All, Host, or browser Clients. An opt-in empty-Fiber filter prunes leaves with no nested Fibers, declared injects, cached services, or provided services; Context branches without a surviving Fiber also disappear, while ancestors of useful subtrees remain. An all-filtered realm renders an empty message rather than a lone root Context. Filtering runs in the panel over the current detached value and never changes Worker snapshots.

Every Fiber and Context row starts expanded, including branches deeper than three levels. Provider buttons use realm-scoped uids, so an identical uid inside another realm cannot become the focus target. The panel opens ancestor details, focuses the selected row, clears a filter that hid it, and reports an omitted root or absent provider without mutating the retained snapshot. Isolated providers are selected by provider, name, and ordinal rather than by name alone.

Service values enter no periodic snapshot or observation frame. A separate `cordis-service/get` query evaluates one selected value in its owning realm with a disposable session. Injection resolution uses the consumer's own isolate map. Provided same-name isolated Impls use the collector's duplicate order and occurrence count; a mismatch becomes a stale summary. Bounded inspection emits JSON for compatible values and summaries for functions, classes, accessors, circular structures and excess nesting. Selection invalidates older responses, while closing the pane or the plugin rejects later publication.

The observable source polls once per second after each query settles because the Inspector query protocol is pull-only. Its first subscriber triggers an immediate query and the last unsubscribe invalidates outstanding work. Queries are single-flight, identical detached trees retain snapshot identity, errors retain the last successful tree, and disposal prevents future reads. Manual refresh uses the same single-flight path.

## Alternatives considered

**Extend the stable `ui-cordis` package.** That package owns dynamic-plugin management and ships in the default Web profile. Coupling it to the private Inspector would either introduce an experimental dependency in a release package or add a permanent tab whose data is usually unavailable. A sibling experimental client package preserves both ownership boundaries.

**Put React registration in the Inspector transport plugin.** The transport currently has no presentation dependencies and its browser fixtures need no UI services. A separate package keeps those contracts intact and follows the existing experimental Client UI package pattern.

**Add Worker-to-Client tree subscriptions.** Push updates would require a new wire operation, query-peer lifecycle rules, and a bridge from the Worker-internal store subscription. One-second visible polling supplies the requested live view without changing that protocol. A later transport subscription can replace the source without changing the panel.

**Include service objects in every snapshot.** Arbitrary service values can contain secrets, accessors, functions, cyclic references and opaque class state. Including them would repeatedly serialize values nobody selected and could execute property behavior on every lifecycle event. Explicit on-demand inspection preserves snapshot semantics and returns summaries when bounded JSON projection is unsuitable.

## Consequences

Both Inspector opt-in overlays now compose two packages, so their instructions also enable the sidebar tab. Normal profiles pay no package or query cost. Enabled panels issue bounded reads only while visible; they still serialize the existing tree once per second after settlement. Composed Host and all Client responses share a configurable 1 MiB frame budget, so useful real-plugin trees are not rejected at the older 128 KiB envelope while remaining bounded. The view supplies structural relationships, detached dependency/provider metadata and one-shot service previews instead of opaque service values in every snapshot. Preview values may be sensitive, so callers choose them deliberately and the same loopback-only authority applies as the Inspector itself. Full object evaluation remains in DevTools.

## Testing

Observable-source tests cover lazy start, polling, single-flight reads, unchanged snapshots, failure recovery, stale generations, and disposal. Component tests cover nested Context/Fiber output with all rows expanded, realm status, realm selection, empty-Fiber-and-Context controls, all-filtered realm states, exact provider focus, filter recovery, missing providers, and preview presentation; pure controller tests pin stale-response suppression and disposal. Protocol and real Host/Client tests cover query validation, injection resolution, isolated-duplicate ordinals, current JSON values and summaries. The whole-client test uses the production `bootClient` and renderer with the external Inspector service replaced by a fixed snapshot, opens the real panel from the footer control, verifies refresh output, and confirms Loader unload removes both registrations.
