# Agent Note: The cost fold prices each message under its logged model's rates

Status: implemented

## Problem

The session cost chip initially priced every token under four flat rates copied from the DeepSeek V3 list, because the cost fold predates any model identity in its input. Real deployments route through several models with widely different prices — the DigitalOcean catalog alone spans $0.14/M (deepseek-v4-flash) to $6.00/M output (qwen3.8-max) on its serverless inference table (docs verified 2026-10-01) — so a flat-rate chip can misstate a mixed session by an order of magnitude and the Stage-4 offline fold inherits the same error.

## Decision

Per-model pricing is configuration keyed by the model id the provider already logs: `assistant/message.message.source.model` is durable in every current-generation log, so no new session event was needed. `dsh-session-stats` `pricing.models` maps a model id to its own four rates; the flat four rates remain required and price any model the map does not list. Every entry — flat and per-model — is validated at plugin load and a malformed one throws, because a silently zero bucket understates spend. The patch layers ship the DigitalOcean serverless-inference table: bundled `packages/bundle/web-app/cordis.patch.yml`, the DO `--patch` example, and the home overlay `~/.dsh/cordis.patch.yml` each carry `pricing.models` for the catalog routes with flat fallback rates. `scripts/wind-up-cost-fold.ts` ships the same table as `DO_MODEL_RATES` beside a `foldSessionUsageByModel` split and a `--do` CLI mode that prices known models from the table and refuses unknown models without flat rates.

## Alternatives considered

**Reading rates off the provider at request time.** The llm seam already owns provider-side image pricing, but text rates are not a capability fact: the same model id bills differently across resellers, and the deployment — not the adapter — declares what it pays. Rates stay a `Config` field, never inferred.

**A new `usage/pricing` session event keyed per request.** Model-visible-equals-logged already records the model on each message, and retroactive events cannot price older logs; keying by the existing durable field keeps every recorded session re-priceable offline.

**Pricing tables compiled into the package.** A shipped table pins a vendor price list into code that must track it; configuration keeps the rate source in cordis.yml where deployments already re-rate per layer, with the DO table shipped as the documented example rather than as a default the code trusts.

## Consequences

The `sessionCost` projection state carries `rates` (the validated fallback plus the per-model map) beside the totals so any consumer can show which table priced them; the client's cost pill, however, lists per-model SPEND in its hover popover rather than the table itself, reading the `perModel` spend fold that [cost popover per-model spend](../architecture/2026-10-02-cost-popover-per-model-spend.md) added to the same unit and rolling descendant subagent sessions into the listing client-side. Locale-owned lines name each model, its amount, and its token total, with the empty-model key labeled for unlogged models. Deployments without `models` behave exactly as before. A mixed-model session now folds to the sum over messages of that message's model rates, and `pricing.models.*` typos fail at plugin load with the offending path named.
