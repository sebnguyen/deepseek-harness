# Agent Note: Role-bound delegation routes instead of a pinned explorer model

Status: proposed

## Problem

The standard preset's explorer row hardcodes a literal child route:

```yaml
agentOptions:
  provider: digitalocean
  model: deepseek-v4.1-flash
  reasoningEffort: off
```

(`packages/preset/agent-presets/presets/standard/agent.cordis.yml:294-297`; the wind-up
preset carries a sibling pin). That literal is a deployment fact — a vendor model id
and an effort spelling — frozen into shipped product configuration, and it bypasses
every dynamic surface the product already owns:

- **It is not a composition fact.** Which route is cheap enough for peripheral reads
  differs per deployment; the `agent-default-model` package already solves exactly
  this shape for the *parent* default (composition base + live settings source,
  every consumer reading `currentSelection()`), but delegation never rides it.
- **It is not validated for wire acceptance.** The spawn provider does preflight
  the configured selection through `llm.resolveCallConfig`
  (`packages/subagent/tool-subagent/src/model-selection.ts:176-196`), so a missing
  route fails at spawn — but the preflight validates against the adapter's own
  description. `off` passed preflight while the shipped route menu materialized it
  as `reasoning_effort: "none"` on the wire, which the DO gateway 400s on the
  deepseek-v4 family (2026-10-10 outage: every explore child died at step 1). The
  preset comment's promise — "a deployment without that route retunes it to its own
  cheap model" — describes behavior that does not exist: nothing retunes; the pin
  either 400s or prefights hard.
- **It defeats the provider's own fallback.** When `agentOptions` is omitted, the
  child purely inherits the parent's live route
  (`packages/subagent/tool-subagent/src/model-selection.ts:105`,
  `index.ts:646-651`) — a fully dynamic path that the pin renders unreachable for
  the one tool that spawns the most children.

The model-facing layer already proves the grammar can carry selection authority
(`modelSelectionSettings` + the `AllowedModelRoute` policy, and per-call
`provider`/`model`/`reasoning_effort` overrides merged in
`requestedAgentOptions`). What is missing is a *named, deployment-bound default*
between "inherit the parent verbatim" and "literal vendor pin".

## Decision

**Introduce delegation roles: named selections bound by composition, live in
settings, consumed by reference.** The sketch has three seams.

**1. Roles live in `agent-default-model`.** The package already merges a composition
base under a live settings section that every consumer reads through one seam;
extend that pattern from one anonymous default to a small `roles` map:

```yaml
# composition base (a deployment patch)
- id: agent-default-model
  config:
    provider: digitalocean
    model: qwen3.8-max
    roles:
      explore:
        provider: digitalocean
        model: deepseek-v4-flash-0731
        reasoningEffort: low
```

with the same namespace in `settings.yaml` as the live operator layer, so a role is
retuned from the Models/tuning surfaces without a composition edit. A role entry
carries the same optional fields as the default (`provider`, `model`, optional
`reasoningEffort`, `maxTokens`); an omitted effort means "the route's own default",
never an inherited spelling from another model family. No role is shipped with a
vendor model in the base bundle — the dormant posture of the base bundle holds for
roles exactly as it holds for the default route.

**2. `tool-subagent` accepts a reference instead of a literal.** The `agentOptions`
config object grows one optional field, `role: <name>`, mutually exclusive with the
literal `provider`/`model` fields. At spawn the provider resolves the reference
through the role seam into a concrete selection, then feeds the *existing* layer
merge (`parent ← providerRouteDefaults ← configured ← per-call override`) and the
existing `preflightChildLlmRoute` — nothing about validation, the allowed-route
policy, or the model-facing override grammar changes, because by preflight time a
reference has collapsed into the same `AgentOptions` shape a literal produces. The
shipped preset row becomes:

```yaml
agentOptions:
  role: explore
```

— the preset names a *purpose*, the deployment names a *route*.

**3. An unbound role is parent inheritance, not an error.** When the role map has no
entry (fresh boot, non-DO deployment, base bundle alone), reference resolution
yields "no configured selection", which is precisely the omitted-`agentOptions`
path the provider already implements: the child inherits the parent's live route.
That single rule turns the preset comment's fiction into behavior — a deployment
without the named route "retunes" by simply not binding the role — and keeps the
explorer working on every deployment the parent works on, by construction.

**Effort stops being a preset fact.** The outage's wire mismatch (`off` → `none`
versus omit) is adapter-owned: the shipped route menu now spells `off` as an empty
wire value for models whose gateway refuses `none`, and per-model `off: none`
declarations win where the model accepts it. The role's optional `reasoningEffort`
is the operator's deliberate choice per route (verified against the live menu at
preflight); silence means the resolved model's own default effort, which is the
only effort spelling a deployment can state without knowing the vendor's wire.

## Alternatives considered

**Delete the pin, inherit the parent for explore.** Fully dynamic, zero new seams —
but every explore child then bills at the parent's thinking route. The pin exists
because peripheral reads should ride a cheap model; the role keeps that benefit
while moving the vendor fact from shipped YAML to deployment config.

**Auto-pick the cheapest advertised model via `llm/discoverModels`.** Discovery
answers what an endpoint lists, not what it costs or which efforts its families
accept; DO publishes rates in documentation, not at the endpoint, and a silent
auto-pick would surprise operators the way the pin did. Naming a role is
operator-owned, matching how the tuning window treats every other route fact.

**Per-preset literal pins in every deployment patch.** That is today's shape one
hop down: the vendor fact moves from one shipped file to N deployment files, still
literal, still un-retunable from settings, still repeated per preset (standard,
wind-up).

## Consequences

- Shipped presets carry no vendor model ids; `tool-subagent-explore` and the wind-up
  explorer both state `role: explore`, and new delegation rows with cheap-route
  needs (workflow workers, future ralph rounds) reference the same role map.
- A DO deployment binds the role in `do-standard/cordis.yml` (and the tuning window
  can later edit the stored role, reusing its route row and effort vocabulary);
  everyone else boots with the base bundle and the explorer inherits the parent.
- The preflight, allowed-route policy, model-facing override fields, and
  `list_subagent_models` advertisement all continue to operate on resolved
  `AgentOptions`; the reference resolves before any of them runs.
- Settings-written roles converge with the Models page and the tuning window
  through the same `settings/document-updated` invalidation the default selection
  uses, because they live in the same namespace.

## Risks

- Two live sources for one role (composition base, settings layer) repeat the
default selection's merge order question; the precedence explicit call override
over settings over composition must stay in the one resolver the preset comment
should finally describe truthfully.
- A role bound to a route whose credential is absent fails at spawn preflight with
the existing MISSING_CREDENTIAL diagnostic — loud, but only discoverable by
spawning; the Models page credential badge should name unbound-by-role routes.
- `role` as a config vocabulary word collides with sandbox/permission "roles" in
operator head; the schema help text must state it is a model-selection role.

## Open questions

- Should `delegation-cap` or the session-stats cost chip attribute child spend per
  role, making the role visible in the pricing surface?
- Does the fork provider (`subagent_fork`, which must inherit the parent's exact
  route for prefix reuse) need a policy error when handed a role reference, or is
  the reference simply ignored there?
