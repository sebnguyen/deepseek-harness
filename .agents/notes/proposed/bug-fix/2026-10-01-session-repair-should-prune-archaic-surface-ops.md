# Agent Note: Session repair should accept archaic surface-op carriers by normalizing them before foldSurface appends

Status: proposed

## Problem

`foldSurface` accepts the historical `{ op: 'replace', start, end }` carriers from session-format-v2 logs (`applyReplaceOp` normalizes them to `startSeq`/`endSeq`), while `validateSurfaceOp` — the admission gate used by `packages/core/session/src/repair.ts` when importing or recovering a log into the current format — only accepts the current `'append' | { op: 'replace', startSeq, endSeq }` union and rejects anything else at the append site. The two readers therefore disagree on what a surface op may be: replay folds, acceptance rejects. Today this cannot bite because no production writer emits the archaic carrier, but any future importer that replays a v2-era log through the repair path will fail loud on events the fold itself understands, and the mismatch hides in two functions three files apart with no shared comment naming the split.

## Proposal

Have `repair.ts` normalize archaic carriers to the current shape before appending (one `mapSurfaceOpForRepair` helper over the two variants), or make `validateSurfaceOp` delegate to the same predicate `applyReplaceOp` uses, so acceptance and folding share one definition of "a surface op this format instance can carry". Keep the append-time validation strict about *fresh* writes from current code (current code emits only current carriers); open the gate only for the inbound repair/import path that is already version-deriving.

## Alternatives considered

**Leave `validateSurfaceOp` strict and let importers reject v2 carriers.** Lost: the fold already understands the archaic carrier, so a repair that fails on it refuses logs the current format instance can carry — admission and folding keep two definitions of one vocabulary.

**Widen the append-time validation for everyone.** Lost: current code emits only current carriers, and loosening the shared predicate would let fresh writes reintroduce the archaic shape through any append site, not just the version-deriving import path.

## Acceptance criteria

Importing a fixture log containing one `{ op: 'replace', start, end }` surface event through the repair path materializes a Session whose surface equals the fold of the same log; fresh append sites still reject the archaic carrier, and the malformed-current-carrier rejection pins stay unchanged.

## Risks

- Normalization at import is added surface in `repair.ts` for a carrier no production writer emits today; the helper stays the only tolerant path, and normalization logs current-shape events so model-visible ⟺ logged is untouched.
