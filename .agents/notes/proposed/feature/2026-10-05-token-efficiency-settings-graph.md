# Agent Note: Token efficiency rail window over the session list's spend projections

Status: proposed

## Problem

The composer cost pill answers "how much has this session spent, at what blended rate", but nothing lets a user compare HOW their sessions used models: a mixed explore–act pattern (cheap model explores, expensive model acts) against a single-model session. The per-session figures needed for that comparison already reach the client — every sessions-list row carries its `projectionValues.sessionCost` fold with per-model buckets — so the gap is a presentation seam, not a data one.

## Proposal

A rail entry above the Settings trigger that opens its own window — not a settings section. The sidebar foot is ui-settings-general's `sidebar.settings` register (`SettingsRoot`), whose trigger row currently stacks the Settings button plus a connection indicator and exposes no sibling seat; the proposal adds one list child to that register, `settings.trigger-item`, rendered above the Settings button inside the existing trigger row. ui-chat registers the Efficiency entry — icon plus locale-owned label through the same re-register-on-locale mechanic the sections use — and owns both the entry and the window it opens, so the settings shell stays copy-free per its contract. The window is the pill's dialog pattern scaled up: portaled, viewport-clamped panel, Escape and outside-pointerdown close, own dialog role and accessible name. A static visual mock of the rail entry and the window stands beside this note in the redesign's column layout: [the viewable mock](./2026-10-05-token-efficiency-settings-graph.mock.html). The window wears the pills' vocabulary ([composer session stats pills](../../implemented/feature/2026-09-07-composer-session-stats-pills.md)), and its per-model hover rows inherit spend-not-rates plus the per-scope projection with client-side descendant rollup from [cost popover per-model spend](../../implemented/architecture/2026-10-02-cost-popover-per-model-spend.md).

### Data seam

The window component reads rows through the global `useSessions` seat every slot component receives, the same seat StatsPills' descendant rollup uses. Nothing new is served: one table row per list row that carries `projectionValues.sessionCost`. Per row the display derives:

- billed tokens = the fold's four buckets summed, spend = `costMicros`, blended rate = spend over billed tokens × 1M (the pill's `perMillionMicros`, extracted beside it so both surfaces share one formula), cache hit = the fold's own prompt-side ratio (`formatCacheHitPercent`).
- models = the count of non-empty entries in the fold's `perModel` map.
- token mix = the fold's four billed buckets (uncached input, cache read, cache write, output) as display percents of the billed total; root rows pool the same four buckets over their subagent tree.
- whole-table anchors over the root families' blended rates: `efficiencyAnchors` returns the pooled micros-over-tokens rate (Σ spend ÷ Σ tokens, divided once — the money average), the median family rate (the middle of the sorted rates, the mean of the middle two on an even count), and the maximum family rate; each row's three chips divide its rate by those anchors, printed by `formatMultiple` (one decimal under 10, whole at and above) and colored by `multipleBand` (<1 cheaper, <2 near, beyond pricier).

### Rendering

The window body is a fixed-column table of single-line rows, not free-form rows and no explanatory sub paragraph — the tiles, column heads, and the mix legend own every definition: `Session | Token mix | $/M tok | vs median | vs avg | vs max | Hit | Spend | Tokens | Models`, one header row and one `tr` per priced session, fixed column widths so content can never resize a column. The mix bar renders first because it is the only non-numeric glance and explains the rate beside it: four bucket segments share a fixed-width track at 100% of the row's billed total, so nothing ever saturates, and an uncached-heavy bar names the lever (cache more, shrink prompts) a rank bar never did; its hover states the four bucket percents. The rate column states the blended $/M-tok figure; the three multiple columns restate that rate against the three anchors, each column individually headed so a scan down one column answers one question across all chats, the worst chat reading ×1.0 on vs max. Hit, spend, billed tokens, and the model count trail as the plain numeric detail layer. Header tiles above the table name the pooled spend and tokens plus the three anchor rates, so the chip denominators are always visible. Unpriced rows render dashes in the multiple columns and an empty mix track; unbilled folds render `$0.00` and no hover. Root rows show their session family's pooled figures — micros, rate, mix, cache hit, and the per-model hover roll the root fold plus its subagent tree, because the session is the unit of comparison the table exists for; an indented child row keeps its own fold so the composition stays inspectable. Rows ladder by recency, latest first at every level; subagent sessions sit in an accordion under their `parentId` root — each root row carries a caret that unfolds one level of its subtree (each child row expandable in turn), collapsed by default so the table stays tight. The rail entry and the window's header stay visible in every deployment; the window body shows the empty state — "this deployment declares no per-million rates" — unless at least one row carries a `sessionCost`, matching the cost pill's presence rule exactly. Copy rides ui-chat's locale namespace with the rest of the stats vocabulary, zh + en.

### Gating and placement

The `settings.trigger-item` list slot is declared by ui-settings-general (it owns the foot) and consumed by ui-chat through `ctx.slots.inject`, so the shell's trigger row learns one render site and no copy; the entry renders in every deployment and the window degrades to its empty state when nothing is priced.

## Alternatives considered

**A settings section (the first sketch, withdrawn on user direction).** A `settings.section` entry above Models would reuse an existing seat, but buries a spend-analysis surface one nav level deep and mixes it with preference chrome the user reads as configuration. The rail entry is discoverable without opening settings and keeps the window's lifecycle out of the settings shell.

**A per-step timeline inside one session.** Color each request by model and watch the explore–act mix live. Loses for now because the whole-log fold exposes per-model totals, not a per-step series; a client paged window cannot price what it has not loaded. Shipping it means extending the host cost fold with a bounded per-step series projection — named as follow-up work, not folded into this surface.

**A chart inside the spend dialog.** Reuses the dialog skin but scopes the view to the viewed session plus its descendants, which is the one comparison the pill already makes; the cross-session question has no home there.

**A proportional-width bar as the only row body (both early sketches, withdrawn on review).** With rates spanning 0.14–2.36 $/M the bars swung from full width to a sliver and the row columns rode along. The table keeps every column fixed and confines any swing inside a fixed track.

**A max-scaled fill bar (shipped in the first landing, withdrawn on user direction).** Scale the fill against the session that spent the most per million tokens and every other row is read as a fraction of one outlier; rows past any later anchor pin at full and hide the number the user wants. The redesign prints the comparison as ×N chips that cannot saturate and keeps the max as one of three named anchors.

**An avg-scaled fill bar (the second landing, withdrawn on the same direction).** The pooled average is token-weighted, so one big chat drags it and the share read still asked the hover for the figure behind the fill. The pooled rate survives as the vs-avg column's denominator and its own tile; the typical anchor is the median, which one expensive sweep cannot drag.

**Dots on one shared $/M-tok axis (redesign rev 1, withdrawn on user review).** Once each chip prints its multiple, a shared-axis dot strip only repeats the number, so the strip went and the chips stayed.

**Grouped "vs anchors" header over the three chip columns (rev 3, withdrawn on user direction).** The three comparisons read better as three individually-headed columns, like any other numeric columns, than as one span decoded against the legend.

**Two-line rows with the mix bar under the title (rev 3, withdrawn on user review).** The second grid line plus row-gap read as a massive gap between rows; every session is one line and the mix bar takes its own column.

**An explanatory sub paragraph under the window title (withdrawn on user review as filler).** The tiles label the three anchors outright and each comparison column head names its anchor; a paragraph restating them is filler.

**A `settings.general.item` row.** The trunk row seat stacks single preferences; a table with a headline and tooltips would outgrow it.

**A new client package.** The data, the formatters, and the locale vocabulary all live in ui-chat; a package would import ui-chat internals or duplicate them.

## Acceptance criteria

- The sidebar foot renders an Efficiency entry above the Settings trigger in every deployment; its window opens portaled and clamped, closes on Escape and outside pointerdown, and shows the empty state on an unpriced deployment, one table row per priced session otherwise.
- The rate column equals the cost pill's blended figure for the same fold; vs avg divides by pooled micros over pooled tokens taken once over every priced session, vs median by the middle root-family rate, vs max by the highest, and the worst row's vs max reads ×1. The header tiles state the pooled spend and the three anchor rates.
- The mix bar segments equal the fold's four billed bucket shares (pooled over the family on root rows) and hover states them; the Models cell on a root row shows the session family's model count and opens the pooled per-model listing on hover; subagent rows ladder under their `parentId` one accordion level per click.
- A component spec drives the section with realistic rows (mixed, single, unlogged-model, subagent child, unpriced, unbilled) and asserts the empty state and the dash cells; copy is locale-owned in both dictionaries.
- The shipped surface matches the linked mock in structure; visual deltas land as mock updates before code.

## Risks

The `perModel` key count classifies by logged model id, so a session that switched rate tiers under one id reads as single; acceptable for a trend surface but the legend copy must say "models logged", not "models used". Subagent rows depend on the list serving `parentId` and `sessionCost` together; a deployment whose list projection omits `sessionCost` degrades to the empty state, never to a wrong chart. The four mix percents round independently and can sum off 100 by a point; they are a glance, the hover and the Tokens column carry the exact figures.
