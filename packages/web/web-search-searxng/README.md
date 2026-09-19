---
description: "The SearXNG-backed search provider for ctx.web: how deployments get keyless web search from a Docker container the provider manages itself."
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-searxng

## Summary

With `dsh-web-search-searxng`, the harness searches the web through a SearXNG metasearch container it launches and manages itself — no API key, no account, and no configured endpoint. Choose it when a deployment wants working web search with zero external credentials and is willing to run Docker. On the first search, the provider starts one ephemeral `searxng/searxng` container, waits for it to answer, and reuses it for every later search until the harness disposes; searches issued before startup completes share that one startup instead of racing to launch their own container. The model-facing `web_search` tool lives in `dsh-tool-web`.

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

Mount the provider in a composition that already loads the web service and the subprocess service; it registers as the `searxng` search provider, so `ctx.web.search()` resolves it automatically when it is the only usable search backend — or pin it with `searchProvider: searxng`.

### When to choose it

Choose this backend when a deployment wants web search without holding a vendor API key and can run Docker on the host. The provider is always reported `available()` — it has no static credential to validate — so a `docker` binary that is missing, a daemon that will not start, or an image that fails to pull surfaces at the first search call, not at provider selection.

### Minimal configuration

Load the web service, the subprocess service, and the provider; every field is optional.

```yaml
- name: '@deepseek-ai/dsh-web'
- name: '@deepseek-ai/dsh-subprocess-local'
- name: '@deepseek-ai/dsh-web-search-searxng'
```

| Field | Default | Meaning |
|---|---|---|
| `image` | `searxng/searxng:latest` | Docker image for the managed container; pin an explicit tag in production — `latest` moves |
| `readyTimeoutMs` | `60000` | Upper bound to wait for the container to answer a search before startup fails |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-web-search-searxng) is the exhaustive source for every accepted field and its JSDoc.

### What a search returns

Each SearXNG result maps to a `WebSearchSource`: `url`, `title`, the engine-supplied snippet as `snippet`, and `publishedDate` as `publishedAt`. Unlike a provider whose only portable field is a highlight, SearXNG always returns a URL, so a result with no snippet is kept as a URL-only source rather than dropped. Any instant `answers[]` SearXNG returns (calculator results, unit conversions) join into `content`; most searches carry none.

### Failures and recovery

Provider failures — a missing `docker` binary, a daemon that will not start, an image pull failure, a container that never answers within `readyTimeoutMs`, HTTP errors, network failures, or unparseable bodies — surface as `WebError` `WEB_PROVIDER_ERROR`; an aborted request surfaces as `WEB_ABORTED`. HTTP redirects from the container are rejected before the `Location` target is contacted and surface as `WEB_PROVIDER_ERROR`. A failed startup can be retried by the next search call. Callers route on the code; the model-facing `web_search` tool surfaces failures to the model under its own error wrapper.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the provider; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The package splits container lifecycle from HTTP search behind one seam:

- **One managed instance, never a race.** `SearxngRuntime` is a Cordis `Service` — one instance per context by construction — so every `SearxngSearchProvider` search resolves the same runtime. Its `ready()` memoizes the in-flight startup promise, so concurrent searches before the container is up share one `docker run` instead of each starting their own.
- **Lazy startup, fail at the call that needs it.** The container starts on the first `ready()` call, not at plugin load — a deployment that mounts the provider but never searches never pays Docker startup cost, and a Docker failure surfaces from the search call that triggered it, not from an unrelated boot step.
- **Portable sources, no invented snippets.** A source keeps its URL even with no snippet, but never invents a `title`, `snippet`, or `publishedAt` SearXNG did not return.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, mounts `SearxngRuntime`, registers the search provider |
| [`src/runtime.ts`](src/runtime.ts) | `SearxngRuntime`: the managed container's lifecycle — start, readiness poll, stop |
| [`src/docker.ts`](src/docker.ts) | `docker` CLI helpers over `ctx.subprocess`: the enabling settings.yml, `docker port` parsing, one run-and-collect wrapper |
| [`src/provider.ts`](src/provider.ts) | `SearxngSearchProvider`: request dispatch against the runtime's current URL, result mapping |
| — | No runtime invariant companion is published; this package exposes no independent event sequence or mutable data relation beyond contracts enforced at its owning seam. |

### Request and mapping flow

`SearxngSearchProvider.search()` first awaits `SearxngRuntime.ready()` for the container's current base URL, then issues `GET {instanceUrl}/search?format=json`. `SearxngRuntime.ready()` starts the container on first use: it writes a generated settings.yml enabling SearXNG's `json` search format (disabled by default upstream) into a temp directory, runs `docker run -d --rm` binding an OS-assigned host port, resolves that port with `docker port`, and polls the search endpoint until it answers or `readyTimeoutMs` elapses. The parsed `results[]` are mapped one by one; the service applies the final `maxResults` bound on the way back. The container stops (`docker stop`, which triggers its own `--rm`) when the owning fiber disposes.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shared vocabulary to the service, the model-facing tools, and the design rationale.

- [Web subsystem](../../../docs/subsystems/web.md) — the exhaustive search request/result vocabulary and error codes.
- [Web package map](../README.md) — the package family and each role.
- [dsh-web](../web/README.md) — the web service this provider registers into.
- [dsh-tool-web](../tool-web/README.md) — the model-facing `web_search` tool that renders this provider's sources.
- [dsh-subprocess](../../subprocess/subprocess/README.md) — the subprocess service the managed container's `docker` invocations run through.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-web-search-searxng) — every accepted config field and its source declaration.
- [Web capability seam decision](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md) — why search and fetch share one provider-selection service.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-web`, which renders this provider's `maxResults`-bounded URLs, titles, snippets, and publication dates, or its exact `SearXNG search aborted`, `SearXNG search request failed: <error>`, and `SearXNG returned an unprocessable response body: <error>` failures under the consumer's error wrapper.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the provider is a poor fit. They are current package constraints.

- **Requires a working Docker daemon on the host.** There is no fallback when `docker` is missing, unreachable, or blocked by sandboxing; every search fails with `WEB_PROVIDER_ERROR` until it is available.
- **`image` defaults to a moving `latest` tag.** A production deployment should pin an explicit tag; the default favors zero-config startup over reproducibility.
- **No native result-count control.** SearXNG's JSON endpoint returns however many results its configured engines produce; the seam's `maxResults` truncation is the only bound, unlike Exa's request-level `numResults`.
- **First search pays container cold start.** Image pull (if not already cached) plus SearXNG's own startup can take several seconds to tens of seconds; `readyTimeoutMs` bounds this but does not hide the latency.
- **The container is ephemeral per fiber, not persistent.** Every harness restart starts a fresh container and repeats cold start; a persistent named container was considered and rejected for this iteration (see the Dev Note).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above and the linked Agent Notes.

#### Future: persistent named container

An earlier design considered a persistent, reused container (start-if-not-running under a fixed name, left running across harness restarts) to avoid repeated cold starts. The shipped design is ephemeral-per-fiber instead, matching this repository's effect-scoped disposal convention and keeping teardown unconditional. Revisit if cold-start latency proves disruptive in practice.

</details>
