# Agent Note: Flat session list folds like the workspace groups

Status: implemented

## Problem

The sidebar's hierarchy-free ("In one list") session view rendered every visible Session as a top-level row, while the grouped Workspace view folded each group to five ordinary rows behind a **Show more** control. Flat mode therefore lost the browsing region's whole reason to fold — the sidebar column stays scannable regardless of account size — precisely when nothing else groups or limits the rows.

## Decision

**One fold policy, two pinned sets.** Both presentations fold at the same five-rows-per-account constant, through one `foldedSessionRows` helper. Groups pin only the selected blank New Session (the pre-existing behavior). The flat list additionally pins every live row — `running` Sessions and Sessions whose connected subagent descendants are running — so active work is never the hidden remainder; running pins read `runningSubagentCount` (the same lineage projection the row statuses use) because descendant Sessions never appear as flat rows. The fold state is component-local in each body: group bodies keep their transient expand-all array, and FlatList gains one, so collapsing the sidebar restores the folded projection in both modes. Search results stay unfolded (they are already query-bounded).

**Drags and search navigation reuse the fold-aware reorder math.** The grouped body's collapsed-drag reasoning (visible-boundary anchoring before hidden members, and rejecting a drop that would fold the source out of view) moves into one `droppedOrderOnVisibleRows` helper that both bodies call with their pinned predicate, so FlatList drags get the same no-hidden-source guarantee. The FlatList search-reveal effect mirrors the grouped one: choosing a hidden result expands the list so the follow-up scroll-into-view lands on a rendered row.

## Verification

`packages/client/ui-workspace/tests/workspace-browser.client.spec.tsx` exercises the fold's quota and pins (blank, running, and subagent-inherited rows stay visible while ordinary rows fold), show-more/collapse in flat mode, collapsed-drag anchoring past a pinned boundary (rejected when the source would hide, committed in the visible half), and the unfold-on-search-reveal path.

## Alternatives considered

**Paginate the flat list.** Rejected: the sidebar already scrolls; a fold with an overflow control matches the grouped mode's established gesture, and persistence of a page cursor would fight the recency order the flat list defaults to.

**Pin every non-idle status (pending interactions, completed).** Rejected: the fold's purpose is hiding latency-tolerable rows; a waiting approval or a just-finished Session still surfaces through its group's warning dot and through hover, while running work is the one state the user must see to know the harness is busy.

**Persist the flat expand state in the view store.** Rejected: the grouped expand-all is already transient by decision (folding is a per-visit projection), and persisting one body's expansion but not the other's would reintroduce the asymmetry this change removes.

## Consequences

- Both browsing modes hide rows at the same five-row constant, and the flat fold's hidden count drives the same **Show more** / **Show less** control the groups use, so no new locale keys are needed.
- The flat account's rendered rows are a subset of its stored order; drag commits and the search-reveal path both resolve against the folded projection, and the shared `droppedOrderOnVisibleRows` helper now owns the visible-boundary anchor rule for both bodies.
- A flat list of five or fewer ordinary rows renders exactly as before, with no overflow control.
