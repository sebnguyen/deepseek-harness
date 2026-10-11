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

## Revision 1: roll the explorer into the generic subagent (2026-10-10)

The explorer is already the generic subagent tool with a fixed config — one
`dsh-tool-subagent` row carrying persona, `outputSchema`, `maxSteps`,
`childSandboxMode: read-only`, a `toolFilter` allow-list, `enableBatchTasks`,
one-shot mode (`packages/preset/agent-presets/presets/standard/agent.cordis.yml:249-297`).
Nothing in the engine knows what an "explorer" is; only that row does. Rolling it
into the general subagent family therefore means changing what the row carries,
not building a new system.

### What the AI can discover about models today

- `list_subagent_models` (`packages/subagent/tool-subagent/src/list-models.ts:86-113`)
  is the only model-facing discovery: no args → registered providers, `provider`
  → its advertised models (id, display name, catalog description),
  `provider`+`model` → that model's reasoning-effort menu with the default
  marked. Every list is gated by the session's `ModelSelectionPolicy` — a route
  absent from the allowed list is invisible to the AI.
- The allowed list itself lives in the `subagent-model-selection` settings
  section (`model-selection-settings.ts:20-34`): `enabled` plus an exact
  `{provider, model}` route array, **shipped `enabled: false` with an empty
  list**; a tool row opts the exposure in per tool via
  `modelSelectionSettings: true` (the standard preset enables it only on the
  plain `subagent` row, `agent.cordis.yml:224`).
- The AI gets **no cost signal anywhere**: providers are listed by display name,
  models by catalog description. The session-stats pricing table exists in
  bundle config but renders UI-only (cost chips, tuning window); no
  model-facing tool can rank routes by spend or name a "flash" model as such.

### The roll-in design

1. **Explore keeps its deployment-owned envelope, loses the pin.** Persona,
   schema, sandbox, step budget, and the read-only tool allow-list stay exactly
   where they are (config rows, never model choices); `agentOptions` leaves the
   row entirely. The explorer child then inherits the parent's route unless the
   AI selects otherwise.
2. **Give the row the same model-selection exposure as `subagent`.** Setting
   `modelSelectionSettings: true` on the explore row (and the allowed-route
   settings) makes `list_subagent_models` available during exploration
   delegations, so the AI picks the route per call — `provider`, `model`, and
   optionally `reasoning_effort`, validated by the existing preflight. The
   tool's own description already names the intent: "cheap broad reader" stays
   in the persona, and the selection-schema text teaches "omit to inherit."
3. **Make "cheap" a first-class, operator-owned fact.** Allowed-route entries
   grow an optional operator annotation (a label such as `cheap-flash` /
   `fast` / `thinking` rendered in `list_subagent_models` output, and named in
   the delegation tool's selection-schema description when routes are
   annotated). Ranking by price must not come from an endpoint: DO publishes
   rates in documentation, not at the endpoint, so the operator states cost
   classes in the allowed list and the AI follows labels, mirroring how the
   tuning window treats rates as operator data.
4. **Default exposure stays settings-backed.** The operator curates the allowed
   list through the existing `subagent-model-selection` settings section
   (likely per tool row — an explore-scoped allowed list is one config field
   over the global one); with the section absent or empty, the explorer
   behaves as today minus the pin: parent inheritance, no selection affordance.

### What this changes from the role sketch above

The role map is unnecessary for the explorer: the per-call selection plus an
annotated allowed list covers "quick and cheap explorer" without a new named
default. The role map still earns its cost only for *unattended* children
(workflow workers, ralph rounds) where no AI turn selects a route at call time.
Open check: the standard preset's existing `modelSelectionSettings: true` on the
`subagent` row already requires the settings service; confirm the headless base
bundle mounts `subagent-model-selection-settings` before enabling the same flag
on the explore row in every profile.
