# Agent Note: Keyless web search via a self-managed SearXNG container

Status: implemented


## Problem

The harness's three existing search providers — Exa, Perplexity, and DeepSeek native search — all require an external vendor API key. A deployment that wants a working `web_search` tool without holding or paying for a third-party credential has no option.

## Decision

`dsh-web-search-searxng` adds a fourth `WebSearchProvider` for `ctx.web`, backed by SearXNG, an open-source metasearch engine. Rather than requiring the deployment to point at an externally run instance, the package launches and manages its own SearXNG container automatically. `SearxngRuntime`, a Cordis `Service` registered as `ctx.searxngRuntime`, owns the container's lifecycle end to end: it generates a settings.yml enabling SearXNG's JSON search format (disabled upstream by default), starts an ephemeral `docker run -d --rm` bound to an OS-assigned host port through `ctx.subprocess`, resolves that port with `docker port`, polls the search endpoint until it answers or `readyTimeoutMs` elapses, and stops the container (`docker stop`, which triggers its own `--rm`) when the owning fiber disposes.

`SearxngSearchProvider` holds no lifecycle state of its own: every search first calls `SearxngRuntime.ready()` for the current instance URL, so the provider is a pure HTTP client over a runtime it does not own. `SearxngRuntime` being a Cordis `Service` is what guarantees exactly one container per context regardless of how many providers or searches reference it; its `ready()` additionally memoizes the in-flight startup promise so concurrent callers before the container is up single-flight one `docker run` instead of racing to start their own. The container starts lazily on the first `ready()` call rather than at plugin load, so a deployment that mounts the provider but never searches never pays Docker startup cost, and a Docker failure surfaces from the search call that triggered it, not from an unrelated boot step.

`available()` is unconditionally `true`: unlike Exa/Perplexity, there is no static credential or configured URL to validate. A missing `docker` binary, an unreachable daemon, or an image pull failure are dynamic facts that surface as `WEB_PROVIDER_ERROR` from the first search instead of from provider selection.

## Alternatives considered

- **Scraping a public search engine's HTML results page (for example DuckDuckGo).** Rejected: no official API contract, prone to breaking on markup changes or triggering bot-blocking, and scraping a search engine's result page directly may run against its terms of use.
- **Requiring an externally configured SearXNG instance URL**, mirroring Exa/Perplexity's `apiKey`/`baseURL` shape. This was the package's first iteration. Rejected in favor of full auto-management: it still required the deployer to stand up and maintain infrastructure, defeating the zero-external-dependency goal that motivated adding this provider.
- **A persistent, named container reused across harness restarts** (start-if-not-running under a fixed name, left running indefinitely). Rejected for this iteration in favor of an ephemeral per-fiber container: it matches this repository's effect-scoped disposal convention — registrations clean up unconditionally with their owning fiber — and avoids the harness managing a long-lived, out-of-band resource it does not fully own. Revisit if cold-start latency proves disruptive in practice.
- **Headless-browser-driven live search.** Rejected as unnecessarily heavy for this iteration: it needs browser automation infrastructure this repository does not otherwise depend on for a model tool, while a Docker-run metasearch engine already returns structured, engine-native results without scraping rendered HTML.

## Consequences

Deployments gain a fourth search provider with no vendor credential, at the cost of requiring a working Docker daemon on the host — the provider is unusable without Docker or without permission to run containers, and the default `latest` image tag is a moving target a production deployment should pin explicitly. The container is ephemeral: every harness restart pays SearXNG's cold start again (image pull, if not cached, plus its own startup), bounded but not hidden by the configurable `readyTimeoutMs`. SearXNG's JSON endpoint exposes no native result-count control, so `maxResults` is enforced only by the seam's post-hoc truncation, unlike Exa's request-level `numResults`.
