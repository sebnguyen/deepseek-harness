# DigitalOcean provider plugin — design

Design for `@deepseek-ai/dsh-llm-digitalocean`, a plugin that makes the harness's
DigitalOcean route adapt to facts DigitalOcean does not publish through any single
standard endpoint: model specs and pricing live only in the control-plane Model
Catalog, rate limits live only in per-response headers, and the inference plane
itself is a protocol-compatible proxy. Scope for the first build: serverless
inference models + cost metering. Knowledge bases and Agent Platform routing are
out of scope and only noted where they constrain choices.

## 1. What DigitalOcean actually exposes

Two planes, two credentials, no overlap:

| Plane | Base URL | Credential | What it answers |
|---|---|---|---|
| Serverless inference | `https://inference.do-ai.run` | Model access key | `POST /v1/chat/completions`, `POST /v1/responses` (OpenAI wires), Anthropic Messages; `GET /v1/models` (OpenAI-shaped ids); quota state in response headers; `Retry-After` on 429 |
| Control plane | `https://api.digitalocean.com/v2` | DO PAT / OAuth token (`genai:read`) | Model Catalog over REST: `GET /v2/gen-ai/models` ("List Available Models") plus the dedicated `List Model Catalog` / `Get Model Catalog Card` GETs in the [Agent Platform API reference](https://docs.digitalocean.com/products/inference/reference/api/agent-platform-api/); the [MCP tools](https://docs.digitalocean.com/reference/mcp/model-catalog-mcp-tools/) wrap the first; prepayment/balance; account/resource limits |

Per-fact fetchability, as verified against the docs (Oct 2026):

| Fact | Fetchable? | Source |
|---|---|---|
| Model ids served | Yes | `GET {inference}/v1/models` (OpenAI `data` array; harness discovery parser already reads it) |
| Context window, modalities, capabilities | Yes, one call | `GET /v2/gen-ai/models` per model: `context_window` (string, optional `K` suffix), `modalities.input/output`, `capabilities`, `model_availability`, `type`, plus `inference_name` — the exact id the inference plane expects in `model` |
| Pricing | Yes, mostly | Same response's `pricing`: input/output per 1M, cache-read per 1M, per-image/megapixel/second/character units. Cache-write (5m/1h) and long-context tiers are NOT in the API — only the pricing docs page has them, so metering merges a pinned docs-table fallback |
| Per-model rate limits | Yes, but only per-response | `x-ratelimit-{limit,remaining,reset}-{requests,tokens-per-minute,tokens-per-day}` on every inference response; reset values are continuous-refill projections, not window boundaries |
| Accepted sampling knobs | Yes, as schema | Each Model card carries `settings[]` (name, type number/dropdown, min/max/step/default/options — e.g. temperature, max_tokens), `reasoning_efforts[]`, `thinking`, and per-endpoint capabilities in `endpoints[]`. The wire caveat remains: chat completions require `model`, `messages`, `temperature`, `max_completion_tokens`; SI "may not be compatible with all OpenAI tools and plugins" and drops model-specific features — so the plugin uses the schema to validate and clamp, never to assume |
| Account tier gates | Partial | Limits page prose (Tier 1/2: no Anthropic, no OpenAI except gpt-oss); capacity rejections (503/overloaded) possible even within limits — treat as retryable SERVER, never as config error |

Consequence: the plugin must keep three fact stores with different refresh
strategies, and every one of them has a failure mode that degrades to
safe defaults rather than breaking the route.

## 2. Package shape

One cordis plugin package, `packages/llm/llm-digitalocean`, mirroring
`dsh-llm-retry`'s footprint (`src/index.ts` plugin entry, `types.ts`,
`invariant.ts`, tests). It owns namespace `llm-digitalocean` for its own config
and composes with — never reimplements — `dsh-llm-pi-ai` (wire) and `dsh-llm-retry`
(retries). Services:

1. `routeProvisioner` — writes the `llm-pi-ai` provider routes for DO (via the
   settings seam) when absent; never edits user-edited fields on re-runs.
2. `catalogSyncer` — refreshes specs/pricing from the control plane into the
   route's `models` entries (contextWindow, cost, input modalities,
   reasoningEfforts) on a TTL and on demand (`ctx.digitalocean.syncCatalog()`).
3. `quotaGovernor` — paces requests per model from observed quota state and
   usage accounting; publishes pace decisions as durable events.
4. `meterRates` — supplies per-model rate tiers to the token-meter seam,
   closing the `NO_COST` gap (`packages/llm/llm-pi-ai/src/catalog.ts:37`).

## 3. Route model

DO serves three wires; repo convention is one protocol per provider, so the
plugin provisions three routes sharing one credential namespace:

```yaml
llm-pi-ai:
  providers:
    digitalocean:            # chat + open-source reasoning models
      displayName: DigitalOcean Inference
      apiKeyEnv: DO_INFERENCE_KEY
      api: openai-completions
      baseURL: https://inference.do-ai.run/v1
      retryPolicy: { mode: normal, maxRetries: 5 }
    digitalocean-responses:  # OpenAI models needing tool search / reasoning wire
      apiKeyEnv: DO_INFERENCE_KEY
      api: openai-responses
      baseURL: https://inference.do-ai.run/v1
    digitalocean-anthropic:  # Claude models; Messages-only features
      apiKeyEnv: DO_INFERENCE_KEY
      api: anthropic-messages
      baseURL: https://inference.do-ai.run
```

Per-route model lists come from catalog sync, request ids taken from each card's
`inference_name` (the string the inference plane matches), keyed by `uuid`.
Compat defaults (the "knobs"
answer for DO): `maxTokensField: max_completion_tokens` on the completions route;
no `thinkingFormat` on any route (SI has no extended thinking — sync must not
declare `reasoningEfforts` for Anthropic ids, and declares OpenAI reasoning
models' efforts only as the responses wire carries them); `input: [text, image]`
only where the catalog card's input capabilities say so.

## 4. Catalog sync mapping

`inference-model-catalog-search` with empty query enumerates UUIDs; `get-card`
per UUID yields the card. Mapping rules:

- `context_window` (parse the `K` suffix) → `contextWindow`; missing → route `defaultContextWindow`.
- `pricing.input_price_per_million` / `output_price_per_million` → `cost.input` /
  `cost.output`; `text_cache_read_input_price_per_million` → `cost.cacheRead`;
  cache-write and long-context tier thresholds (Sonnet 4.5 >200K, GPT >272K)
  come from the pinned docs-table fixture as `costTiers` metadata for the
  meter (§6).
- `modalities.input` containing `image` → `input: [text, image]`, else `[text]`.
- `model_availability` must cover serverless; dedicated-only models are excluded
  from serverless routes with a diagnostic.
- `reasoning_efforts[]` on the card drives the `reasoningEfforts` mapping; SI
  strips Anthropic extended thinking, so Anthropic ids default
  `reasoningEfforts: false` unless the route's wire is one the docs say carries
  it; OpenAI reasoning ids keep efforts on the responses route only.
- `settings[]` (min/max/step/default) feeds a per-model request sanitizer that
  clamps user-set temperature/top_p/max_tokens to the card's declared ranges
  before the request leaves the adapter.
- The dedicated `List Model Catalog` / `Get Model Catalog Card` operations
  (reference anchors `genai_list_model_catalog`, `genai_get_model_catalog_card`)
  postdate godo and doctl; pin their exact paths from the reference page at
  implementation time and switch to them if their cards are richer.
- Catalog unreachable → keep last accepted entries; never empty the route
  (mirrors llm-pi-ai's deferred-resolution semantics).

Implementation pin (resolved): the catalog is one primary call —
`GET https://api.digitalocean.com/v2/gen-ai/models` (scope `genai:read`),
authenticated by a DO PAT, a second credential beside the inference key. godo's `SearchModels` and
`GetModelByUUID` are client-side filters over this single list, and so is the
plugin's sync: fetch the page once, map, store. The syncer parses via zod
against the field names above (godo `agentplatform.go` `Model`/`ModelPricing`
are the pinned wire shape) so a shape change fails as a typed diagnostic, not
garbage metadata.

## 5. Quota governor ("smartly adjust")

Two layers, reactive first because it needs no new seams:

- Reactive: 429 + `Retry-After` already flows through `dsh-llm-retry` (valid
  provider delay replaces local backoff within policy bounds). Classify
  terminal vs transient the way `dsh-llm-deepseek` does
  (`packages/llm/llm-deepseek/src/adapter.ts:366,728`): prepaid-balance exhaustion
  errors map to terminal `QUOTA` (DO is prepaid-only; suspended access never
  retries), throttling maps to `RATE_LIMIT`. 503/overloaded (capacity, not
  quota) maps to retryable `SERVER`.
- Proactive: today no pi-ai stream surface carries response headers into the
  harness (zero `x-ratelimit` references under `packages/`), so the governor
  starts usage-based: accumulate `prompt_tokens + completion_tokens` per model
  from stream usage; refill continuously at `limit/60` per second using the
  tier-cap defaults from the limits page; when projected remaining TPM < next
  request estimate, delay to the projected refill time
  (`max(reset - now, 1s)` semantics from the header docs). If headers later
  surface (upstream pi-ai contribution or an adapter hook), observed
  `x-ratelimit-remaining-tokens-per-minute` and the reset projection overwrite
  the estimate on every response — the accounting is a fallback, not the truth.
  RPM is a shared request group, so request pacing uses a conservative group
  counter, not per-model state.

The governor emits `digitalocean/pace` events (model, source: observed|estimated,
delay ms) so pacing is reconstructable from the session log like `llm/retry`.

## 6. Cost metering

`NO_COST` in `catalog.ts` is the hook: the harness zeroes pi-ai cost metadata
because nothing trustworthy supplies it; this plugin becomes the supplier.
`meterRates` registers the synced rate table keyed by route+model id into the
token-meter seam; meter picks the base tier and, when a request's prompt tokens
exceed the tier threshold, the long-context tier. Cache read/write counts come
from usage fields where the wire reports them; where it does not, cache cost
lines are omitted rather than guessed. Rates are versioned with the sync
timestamp; a rate change never rewrites history — projections recompute against
the rate version recorded per session event.

## 7. Tests

- Fixture-driven: pin a `tests/fixtures/do-model-catalog-<date>.json` (like the
  OpenRouter listing fixture in `llm-pi-ai`) and map-assert it into the expected
  `settings` fragment; drift surfaces as a failing snapshot, regenerate
  deliberately.
- Quota parser units: header triples incl. zero-reset, future reset, missing
  groups; pacer decisions against a fake clock; 429 body classification table
  (quota-exhausted vs throttled vs 503).
- Mock SI server e2e through the agent loop: route provisioning idempotence,
  retry honors Retry-After, pace event ordering.

## 8. Open questions (implementation pins)

1. Resolved: `GET /v2/gen-ai/models` (godo `agentModelBasePath`), fields per §4.
   The dedicated catalog-card pair exists in the reference op index but in no
   public SDK yet; its exact paths are the one remaining pin.
2. Resolved: the API exposes cache-READ only; cache-write (5m/1h) and
   long-context tiers come only from the docs pricing page (markdown table
   parser, pinned fixture).
3. Whether usage chunks on DO's three wires report cached-token counts.
4. godo ships `prepayment.go`, so a prepaid-balance endpoint exists; pin its
   path and use it to predict suspension (reactive QUOTA remains the fallback).
5. Upstream path for surfacing response headers in pi-ai — file or vendor-patch;
   the governor works without it.

Sources: DigitalOcean docs —
[Agent Platform API reference](https://docs.digitalocean.com/products/inference/reference/api/agent-platform-api/),
[Retrieve Available Models](https://docs.digitalocean.com/products/inference/how-to/retrieve-available-models/),
[models.dev sync source](https://github.com/anomalyco/models.dev/blob/dev/sync.md),
[Inference Limits](https://docs.digitalocean.com/products/inference/details/limits/),
[Inference Pricing](https://docs.digitalocean.com/products/inference/details/pricing/),
[Quota-Specific Response Headers](https://docs.digitalocean.com/products/inference/reference/quota-specific-response-headers/),
[Browse Model Catalog](https://docs.digitalocean.com/products/inference/how-to/browse-model-catalog/),
[Model Catalog MCP tools](https://docs.digitalocean.com/reference/mcp/model-catalog-mcp-tools/),
[Inference API Reference](https://docs.digitalocean.com/products/inference/reference/api/).
