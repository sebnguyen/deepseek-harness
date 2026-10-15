# Agent Note: Ephemeral request grammar — the header carries durable intent only

Status: implemented

## Problem

Under quiet/tools turn shapes — and under any grammar contribution — the per-request grammar fields (`structuredOutput`, `toolChoice`) leaked into the session's persisted `request/header`, and `requestProposal` re-seeded every later request from that durable state. Contributions abstaining ("don't write this pass") could never retract a field the seed already carried, and `headerEquals` then never saw a change, so no clean header ever replaced the dirty one: a session that ran one quiet/tools turn emitted `auto` plus the strict `{}` shield on every later request, including after the user flipped back to narrate. Assistant text blocks came out `{}`, the sanitizer hid them, and turns ended visibly empty; the quiet wrap-up step's own request inherited hints the same way, so its closing answer was `{}` too. Live-reproduced in two sessions on 2026-10-14 — the visible "quiet does nothing" and "narrate switch does nothing" reports were this one mechanism. All 17 conversation-mode host specs passed throughout: they seed clean configs, so the layer they proved correct (contribution-layer abstention) was never the layer that failed (seed-layer inheritance).

## Decision

Every request-config field gets exactly one owner and one lifetime. Durable intent (provider, model, effort, token bounds) belongs to `request/header`, lifetime: the session. Per-request grammar (`structuredOutput`, `toolChoice`) belongs to the request-grammar fold, lifetime: one request. The enforcement, all in `packages/core/agent-loop`:

1. `requestProposal` drops the ephemeral fields from every seed. Sessions poisoned before this fix heal on their next request — no migration, no log rewriting.
2. The persist path logs a stripped snapshot: `stripEphemeralHeaderGrammar` cleans the canonical header for every `request/header` append branch and its `headerEquals` baseline comparison. The live request keeps its grammar on the wire; only the durable copy and its baseline are cleaned.
3. `EPHEMERAL_CONFIG_FIELDS` in `constants.ts` holds the field list both sites read — one shared seam, exported from the package root.

No retraction operator was added: a contribution abstaining plus a grammar-free seed already equals the field being absent. This unblocks the [strict tool-required and finish() proposal](../../proposed/feature/2026-10-14-turn-shape-strict-required-and-finish-tool.md), whose design depends on grammar being enterable and exitable per request.

### Regression pins

`packages/core/agent-loop/tests/request-ephemeral-grammar.spec.ts` anchors the contract at the loop level: a quiet/tools-style contribution's grammar rides the wire but never lands in a `request/header` event; when the writer stops, the very next request is clean; and a session whose log carries a pre-fix dirty header sends clean requests from the first request on — all through the real loop, session log, and request headers.

## Alternatives considered

- **Retraction operators in the fold** (delete-marker patches, or a service-level reset before contributions). Puts a transition calculus onto a write calculus designed to be stateless per request; every future writer would own a retraction burden; doesn't heal sessions already polluted.
- **Strip inside `canonicalHeader` / `headerEquals`** (session package). Rejected: those are the general session-level normalizers shared by `foldRequestHeader` and reconstruction tooling, which must replay historic logs that legitimately contain grammar. The strip belongs to the loop's seed/persist lifecycle, not to the data model's read paths.
- **Seed-time strip only.** Heals seeds from old logs but keeps writing ephemeral lies into fresh `request/header` events, misleading replay and diagnostics forever; persist-side strip closes both directions.

## Consequences

- The durable header is now the record of durable intent only: `request/header` events carry no `structuredOutput`/`toolChoice` — ever, not only for turn shapes. Any future contribution family inherits the ephemeral treatment by being listed in `EPHEMERAL_CONFIG_FIELDS`.
- Flipping a mode off is immediately honest: quiet/tools → narrate removes the shape's grammar from the very next request, and quiet's wrap-up step receives no working-step grammar.
- The first post-fix turn on a pre-fix session can append one clean `change` header where the old code would have seen no difference — an expected, bounded self-heal: one extra event per affected session.
- Replay tooling that reconstructed grammar from historical headers (none exists today; `foldRequestHeader` replays headers verbatim for continuity, and `request/wire` already logs the true per-request payload) must use wire records for grammar-accurate reconstruction going forward.

## Risks

- The only two seams that mutate semantics are the seed (`requestProposal`) and the persist copy (`stripEphemeralHeaderGrammar`); the live request is untouched, so wire behavior is unchanged for any session whose header was clean. Nothing else reading the header (change detection, `toolsChanged`, adapter-default stripping, resume) shifts shape, since compares now happen on the same stripped form the log holds.
