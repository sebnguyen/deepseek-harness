# Agent Note: The chat width axis fills the column

Status: implemented

## Problem

The chat window's shared width axis capped the transcript at the readable measure — 431px at the default content face — so on any reasonably wide center column the message flow floated in a narrow centered lane with dead side margins, and the composer, dock cards, and takeover panels repeated the same narrow lane. The side margins read as wasted space on the product's primary surface.

## Decision

The default content width is the full column: `ConversationRoot`'s `.root` declares `--dsh-chat-content-width: var(--dsh-chat-user-width, 100%)` — no readable-measure cap, no 64%-of-column share — and `resolveContentWidth` returns the column width when no preference exists. Every surface that rides the axis fills the column: the transcript, the input card (W + 32px), dock cards, takeover panels, stats pills, and the wide-table breakout vector (whose spare now computes to zero, so tables span the column directly). The 32px-per-side scroller gutter (composer clearance + 16px) stays as the only horizontal inset. A stored drag preference (`--dsh-chat-user-width`, `dsh.conversation.contentWidth`) still replaces the default wholesale, bounded by the 640px floor and the 176px handle budget, and the width handles keep their geometry against the user width. The Settings content font size no longer shapes any width; the readable-measure default of [the 2026-10-08 note](2026-10-08-readable-measure-caps-chat-width.md) is reversed.

## Alternatives considered

**Keep the readable-measure cap (the 2026-10-08 default).** Rejected on request of the product change driving this work: at the wide-monitor layouts this app lives in, the 431px lane left most of the center column empty, and the 45–75-character guidance applies to prose measures, not to a mixed prose/code/chat-flow surface whose widest content (tables, diffs, tool rows) benefits from the room.

**Remove the constraint at the transcript only** (drop `max-width` on ChatView's `.column`). Rejected: the axis exists so the transcript, composer, dock cards, and takeover surfaces share one width; widening only the transcript would strand every other consumer at the cap and leave the composer card visibly narrower than the flow it feeds — a second mismatch complaint to answer later.

**Delete the width handles and the stored preference with the cap.** Rejected: the drag machinery still serves a narrowed preference (stored values keep working and the handles re-engage around any user width); removing the only width affordance alongside the cap would make full width irreversible for users who wanted the measure.

**Keep a proportional default (64% of the column) without the measure.** Rejected: a percentage lane reproduces the same dead margins the cap produced, proportionally — it is the cap with a different constant.

## Consequences

- Transcript, composer, dock cards, and takeover panels span the center column out of the box; the 32px scroller gutter and the frame's 8px inset remain outside them.
- At the full-width default the drag handles' strips compute zero hit area and vanish, so the narrowing affordance is no longer discoverable without an existing preference — the accepted cost of removing the margins the handles once occupied.
- The wide markdown table breakout's spare vector is zero at the default; wide tables still scroll in-column past their natural width, and the hook re-opens the breakout the moment a dragged preference narrows the column.
- `readableContentCap` and the font-size readout left `ConversationRoot.tsx`; the Settings content font size now affects type only. `--dsh-conversation-column-width` keeps publishing as a layout-done readout for tests, though nothing in CSS consumes it.
- Stored width preferences survive unchanged and keep governing their sessions; the geometry bounds (640px floor, column − 176px budget) are untouched.

## Verification

`skeleton.client.spec.tsx` re-pins the drag round-trip against the full-width base (1600px column: inward drag to 1400; a 900px window then re-clamps the display to 724 without rewriting the storage) and replaces the font-size case with one proving the drag base ignores the setting. `markdown-wide-table.e2e.ts` now pins the neutral clamp (zero spare, zero lead) at every sweep stop, and `composer-tab-geometry.e2e.ts` records the full-seat control geometry (whole band on the right edge and width, nothing on the left). Both e2e goldens are refreshed in kind.
