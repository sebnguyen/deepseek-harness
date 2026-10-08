# Agent Note: Files-batch web cards — one card per read/write frame

Status: proposed

## Problem

The shipped `files` batch faces settle `read` and `write` as sectioned `[i/N] <path>` text ([files batch faces](../../implemented/feature/2026-10-08-files-batch-faces-for-read-and-write.md)), and the current Web rows flatten that: `readCardModel` renders a single read card from the first successful frame and `diff-card-model` stacks the committed hunks, so a three-file read shows one file and a mixed batch hides which element failed, previewed, or skipped. The path label a row prints is the product's one clickable workspace fact — ToolRow renders `filePath` with `onOpenFile` as a hover-underline link into the Sidebar text preview — yet in a batched row nothing is clickable, so a settled multi-file call offers no way to reach any of its files. The frames `bash` row solved the same problem with one terminal card per element plus tray and not-run lines; the fs faces need the equivalent mock before the client rewrite.

## Proposal

The keyed `read` and `write` toolviews keep today's flat DisclosureRow summary lines and stack per-frame cards in the expanded body on bash-row's stacked geometry, with every frame's path rendered in the shipped dotted fileLink style as a real hyperlink; [the viewable mock](./2026-10-08-files-batch-web-cards.mock.html) renders those rows from the shipped geometry facts — 24px lines, `Showing N of M lines` / lang / Copy banners on ReadBlock, banner-less DiffBlock with drawn signs and `+N −M · K files` footers, bash detached shapes for error and not-run frames, the current dark alias palette — plus the two destinations the links route to: the Sidebar text preview opened at the frame's start line, and the trajectory view the row's Inspect pill opens with the raw call and result.

- A settled batched `read` row expands to one read card per successful frame in element order: the card header carries the relativized label, the language badge, and the `(lines a-b of n)` footer line; error frames render as a compact red pill row under the same `[i/N]` order, and abort-skipped elements render the warn-dot not-run line the bash row uses. The row title is `N reads: <first>`; while running the row is the bare summary with the elapsed suffix, matching bash.
- A settled batched `write` row expands to one diff card per element: a created file shows all-`+` lines with the ok `Created file` pill, a patch shows its unified hunks with the `N edits applied (M matches)` accessory, a dry-run element shows its would-be hunks behind a dashed warn `Dry run — no commit` pill, refused elements keep the err pill with the remediation sentence (including the escalation hint under confining backends), and not-run elements the warn line. Per-frame `diffs` from persisted meta win over argument-derived intent, exactly as `diffCardModel` does today for the merged card.
- Every path occurrence routes like the singular rows do today: read card banners, diff card headers, error and not-run line paths, and the row summary link all call the owner's `openFile` with the frame's start line; the collapsed row carries `diffTotals`' `+N −M` stat like the current diff rows.
- The Inspect control is demoted from the expanded body to a perpetual position on the line: a labeled Inspect chip at the right end of every DisclosureRow summary line — the shipped pill's icon plus its `row.inspect` label, at the row's 11px tier — present on collapsed and expanded, settled and running rows alike, so a collapsed call gets the trajectory jump without a preceding expand. A bare glyph was rejected at this position: on a line whose whole grammar is text plus one dotted link, an unlabeled mark reads as furniture, and the row already resolves width by letting the summary truncate, so the chip's fixed label costs nothing. Its click stops the row click so inspecting never opens or closes the accordion. This replaces both the shipped hover gate (`.root:hover .inspectButton`, `ToolRow.module.css`) and the expand-first placement: the collapsed line is the state the user scans across hundreds of calls, and it is exactly there a hover-only or expand-only affordance stays invisible. Removing the jump instead was rejected: the cards condense by design and would then offer no route to the uncondensed record (the full batch arguments plus every frame's persisted window).
- Singular legacy replay rows are untouched: non-batch args keep the existing single read card and single diff card, so recorded sessions render as they do now.

## Alternatives considered

**One merged multi-file card.** A single card with internal tabs saves vertical space but reintroduces the toggle the bash review rejected for noisy batches and hides the per-element exit at a glance; the row stays a stack.

**Deriving cards from raw result text only.** Bash splits text because live rendering precedes meta; for fs the structured frames meta already persists every window and hunk, so the mock derives cards from meta and falls back to text-splitting only when meta is absent (live first paint before settlement still uses argument intent, as today).

## Consequences

- `read-card-model` grows a frames variant returning an ordered card list while `readCardModel` keeps its one-card contract for the first frame until the row rewrites; `diff-card-model`'s merged list becomes the per-frame grouping input.
- Conversation locales gain `read.frameError`/`write.frameDryRun`-class keys only if primitives cannot carry the pills; the mock uses primitive-owned pills so the client change stays locale-static.
- The mock is static hand-rolled HTML in the shipped dark appearance; implementation consumes `--dsw-*` tokens through CSS Modules like `bash-row`.

## Acceptance criteria

- A settled batched `read` row expands to one line-numbered read card per successful frame in element order, error and not-run frames rendered as err/warn lines, and the row title reads `N reads: <first>`; a running batched read shows the bare summary with a ticking elapsed suffix.
- A settled batched `write` row expands to one diff card per element with the create/patch/dry-run/err pills per frame outcome, per-frame meta hunks winning over argument intent, and the row title reads `N writes: <first>`.
- Every path in a batched row is a keyboard-reachable link that opens the Sidebar preview at that frame's start line, including the paths inside err/not-run lines; a not-found target renders the preview pane's refusal verbatim rather than a dead link.
- Every ToolRow line carries the labeled Inspect chip at its right end regardless of expansion and run state, for every tool name; clicking it opens the trajectory focus without toggling the accordion, and it is keyboard-reachable in the row's tab order after the row itself; component specs assert presence by row, not by hover or expansion state.
- Singular logged calls (legacy replay) keep the existing single read card and single diff card, and non-batch or ungrammatical payloads keep the generic IN/OUT card.
- Component specs assert the stacked rows against realistic props and the persisted frames meta; `pnpm run test:gui` stays green with no new uncovered arms in the touched client packages.

## Risks

- Tall stacks of large read windows can dwarf the conversation; the mock inherits the bash-row bounded scrollbar precedent, but the read primitive's line cap was designed for single cards, so the stacked geometry needs a visible cap review before implementation.
- Error-line copy must come from the frames meta's `message` field printed verbatim, never parsed provider prose, and a meta-less live first paint shows at most the element paths until settlement.
