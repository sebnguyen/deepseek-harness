# Agent Note: Token efficiency rail window over the session list's spend projections

Status: proposed

## Problem

The composer cost pill answers "how much has this session spent, at what blended rate", but nothing lets a user compare HOW their sessions used models: a mixed explore–act pattern (cheap model explores, expensive model acts) against a single-model session. The per-session figures needed for that comparison already reach the client — every sessions-list row carries its `projectionValues.sessionCost` fold with per-model buckets — so the gap is a presentation seam, not a data one.

## Proposal

A rail entry above the Settings trigger that opens its own window — not a settings section. The sidebar foot is ui-settings-general's `sidebar.settings` register (`SettingsRoot`), whose trigger row currently stacks the Settings button plus a connection indicator and exposes no sibling seat; the proposal adds one list child to that register, `settings.trigger-item`, rendered above the Settings button inside the existing trigger row. ui-chat registers the Efficiency entry — icon plus locale-owned label through the same re-register-on-locale mechanic the sections use — and owns both the entry and the window it opens, so the settings shell stays copy-free per its contract. The window is the pill's dialog pattern scaled up: portaled, viewport-clamped panel, Escape and outside-pointerdown close, own dialog role and accessible name. A static visual mock of the rail entry and the window sits beside this note: [the viewable mock](./2026-10-05-token-efficiency-settings-graph.mock.html). The window wears the pills' vocabulary ([composer session stats pills](../../implemented/feature/2026-09-07-composer-session-stats-pills.md)), and its per-model hover rows inherit spend-not-rates plus the per-scope projection with client-side descendant rollup from [cost popover per-model spend](../../implemented/architecture/2026-10-02-cost-popover-per-model-spend.md).

A first implementation landed on local `master` through branch `feat/token-efficiency`, stacked on a port of the unlanded cost-fold work its data seam depends on; the branch and its worktree were removed after the merge, and the base commit should be dropped or rebased once the fold lands on its own branch. The formatter the window shares with the spend pill moves to `contract/token-format.ts` with it, and the models/rates/bar hovers run on the Tooltip primitive's pre-line label.

### Data seam

The window component reads rows through the global `useSessions` seat every slot component receives, the same seat StatsPills' descendant rollup uses. Nothing new is served: one table row per list row that carries `projectionValues.sessionCost`. Per row the display derives:

- billed tokens = the fold's four buckets summed, spend = `costMicros`, blended rate = spend over billed tokens × 1M (the pill's `perMillionMicros`, extracted beside it so both surfaces share one formula), cache hit = the fold's own prompt-side ratio (`formatCacheHitPercent`).
- models = the count of non-empty entries in the fold's `perModel` map; the pooled headline groups rows by **1 model** vs **2+ models** on that count.

### Rendering

The window body is a fixed-column table, not free-form rows: `Session | Models | Rate vs max | $/M tok | Spend | Cache hit`, one header row and one `tr` per priced session, `table-layout: fixed` with declared column widths so content can never resize a column. The Models cell on a root row shows the session family's logged model count — the root fold plus its subagent tree pooled: its $/M tok, Spend, and Cache hit cells and its per-model hover roll the same family, because the session is the unit of comparison the table exists for; an indented child row keeps its own fold's figures so the composition stays inspectable. The bar column is a fixed-width track in one hue; only the fill inside it scales (linear, against the priced maximum), so a cheap session's sliver stays inside its own column instead of swinging the layout. Hovering the fill shows two lines: the row's value as a share of the max, and the max blended rate itself. The numeric columns make every row readable whatever its bar does. The pooled group rates headline above the table: 2+-model rows' micros and tokens summed, 1-model rows' summed, each divided — "2+ model sessions pooled $0.56/M tok · 1-model sessions pooled $0.91/M tok" — because pooling micros over tokens is the honest aggregate, never an average of per-session rates. Rows sort by blended rate descending; subagent sessions sit in an accordion under their `parentId` root — each root row carries a caret that unfolds its subtree (laddered by an indent step per depth, each child row expandable in turn), collapsed by default so the table stays tight. The rail entry and the window's header stay visible in every deployment; the window body shows the empty state — "this deployment declares no per-million rates" — unless at least one row carries a `sessionCost`, matching the cost pill's presence rule exactly. Copy rides ui-chat's locale namespace with the rest of the stats vocabulary, zh + en.

### Gating and placement

The `settings.trigger-item` list slot is declared by ui-settings-general (it owns the foot) and consumed by ui-chat through `ctx.slots.inject`, so the shell's trigger row learns one render site and no copy; the entry renders in every deployment and the window degrades to its empty state when nothing is priced.

## Alternatives considered

**A settings section (the first sketch, withdrawn on user direction).** A `settings.section` entry above Models would reuse an existing seat, but buries a spend-analysis surface one nav level deep and mixes it with preference chrome the user reads as configuration. The rail entry is discoverable without opening settings and keeps the window's lifecycle out of the settings shell.

**A per-step timeline inside one session.** Color each request by model and watch the explore–act mix live. Loses for now because the whole-log fold exposes per-model totals, not a per-step series; a client paged window cannot price what it has not loaded. Shipping it means extending the host cost fold with a bounded per-step series projection — named as follow-up work, not folded into this surface.

**A chart inside the spend dialog.** Reuses the dialog skin but scopes the view to the viewed session plus its descendants, which is the one comparison the pill already makes; the cross-session question has no home there.

**A proportional-width bar as the only row body (both early sketches, withdrawn on review).** With rates spanning 0.14–2.36 $/M the bars swung from full width to a sliver and the row columns rode along. The table keeps every column fixed and confines the swing to the fill of a fixed track.

**A mixed/single Pattern chip per row (the second sketch, withdrawn on user review).** A binary chip answered the explore–act question inline but collapsed the model composition to two classes. The Models count with its hover popover carries the composition at full fidelity, and the pooled headline keeps the 1-vs-2+ read.

**A `settings.general.item` row.** The trunk row seat stacks single preferences; a bar list with a headline and tooltips would outgrow it.

**A new client package.** The data, the formatters, and the locale vocabulary all live in ui-chat; a package would import ui-chat internals or duplicate them.

## Acceptance criteria

- The sidebar foot renders an Efficiency entry above the Settings trigger in every deployment; its window opens portaled and clamped, closes on Escape and outside pointerdown, and shows the empty state on an unpriced deployment, one table row per priced session otherwise.
- Every bar's rate equals the cost pill's blended figure for the same fold; header group rates equal pooled micros over pooled tokens per model-count group (1 vs 2+).
- The Models cell on a root row shows the session family's model count (root plus subagents) and opens the pooled per-model listing on hover; the bar fill's hover names the row's value as a share of the max and the max blended rate; subagent rows ladder under their `parentId` when the ancestor rows above them are expanded.
- A component spec drives the section with realistic rows (mixed, single, unlogged-model, subagent child, unpriced) and asserts the empty state; copy is locale-owned in both dictionaries.
- The shipped surface matches the linked mock in structure; visual deltas land as mock updates before code.

## Risks

The `perModel` key count classifies by logged model id, so a session that switched rate tiers under one id reads as single; acceptable for a trend surface but the legend copy must say "models logged", not "models used". Subagent rows depend on the list serving `parentId` and `sessionCost` together; a deployment whose list projection omits `sessionCost` degrades to the empty state, never to a wrong chart.
