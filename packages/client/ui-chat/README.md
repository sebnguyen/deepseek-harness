---
description: "Browser Chat target that renders Session conversation nodes, historical images, actions, localization, and scroll state."
kind: "package-reference"
---
# @deepseek-ai/dsh-client-ui-chat

## Summary

Use this package to render a browser chat from recorded Session conversations, including historical images, localized actions, and restored scroll position. Each assistant Step renders as a span whose message stands alone while its reasoning, Tool, and retry rows fold behind a per-step disclosure. Local transcript and steering submissions appear immediately, remain in their original surface, and disappear atomically when authoritative Session records arrive, while queued submissions stay outside Chat. The package does not assemble or modify model requests.

File-mention providers receive the viewed Session ID with the closing-turn owner, so links into inherited history can address the fork itself.

## Table of Contents

- [Reference previews](#reference-previews)
- [System prompt row](#system-prompt-row)
- [Turn token usage](#turn-token-usage)
- [Completed-turn footer](#completed-turn-footer)
- [Step Span Folding](#step-span-folding)
- [Scroll ownership](#scroll-ownership)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="reference-previews"></a>
## Reference previews

Sent file references and skills confirmed by the message’s logged invocation open in the right Sidebar. File paths use the viewed Session; skill names resolve through its current input-trigger source. Both use the prose file-link dotted underline on hover or focus. Sessions, directories, and command labels remain non-navigating references.

<a id="system-prompt-row"></a>
## System prompt row

Each nonempty appended `system/message` owns a collapsed prompt row, including a complete prompt at the start of a headerless window; the same-step header does not duplicate it. Chat also shows a collapsed `System prompt` row for a non-empty initial request, explicit message-series start, or `system/message` surface node replacement whose text differs, reading the last nonempty surviving system node in surface order at the `request/header`; a non-initial request whose preceding header is outside the loaded history window also shows one. A resume repeats the row even when its system text is unchanged, including after pagination supplies the preceding header and system node; same-series config-only or tool-only changes, tool steps, and retries create no repetition, and a `system/message` event is never rendered as a transcript message. The row appears before that request's user messages, matching the provider envelope, and expands to the exact model-visible text with its original line breaks. A request whose system node is empty or outside the loaded window creates no row until the page holding the node arrives.

<a id="turn-token-usage"></a>
## Turn token usage

A completed Turn shows an expandable usage row only when the loaded window includes `turn/start` and every started model attempt reports safe, exact usage. The row omits unavailable optional buckets. Incomplete or contradictory accounting hides the complete disclosure instead of presenting a partial total.

<a id="completed-turn-footer"></a>
## Completed-turn footer

The completed-turn action footer starts 20px below the preceding prose or extension content.

-----

<a id="step-span-folding"></a>
## Step Span Folding

Each assistant Step materializes four rows — an opener at `step/start`, a reasoning section, a message section, and a closer at `step/end` — and the span they bound hosts the fold: the message section is always visible whenever it carries reply content, while reasoning sections, Tool rows, retry rows, and step-bound injected-context rows fold behind a disclosure rendered on the opener row. Context rows that arrive inside a started Step — reminder, reasoning-prefetch, and async-tool injections — carry step coordinates and fold with that Step's span; injections that precede the Turn's first Step keep standing at the turn head. Consecutive Steps whose message section carries no reply content share one fold: its disclosure rides the run's first opener — or the prompt row the run head covers when a submission logged inside that span — leads with the folded range — `Steps 1 - 3` in the en locale — and its counts cover the whole run — `N context · S subagents · M thoughts · K tool calls` in that segment order, zero-valued segments omitted and the Tool and subagent figures mutually exclusive over the run — while a visible reply closes the run. A user or steering prompt closes the run before the first Step whose events postdate it — by Step coordinates when the prompt carries them, otherwise by log seq — so the work answering the reader's latest message never folds above it. A running span whose only member is the opener reads `Working`; a closed span with no members reads `Thought for a while`. Folds default to closed; the session-scoped store records manual expansion per run key, so widening one run reveals exactly its members and never its neighbours. While a Turn streams, finished spans fold exactly like closed ones and the live span folds as its members materialize. While older history remains available through Load earlier, a span whose opener row the window lost shows its members uncollapsed until the page lands, and the fold's counts re-derive in place when it lands. The System prompt remains independently visible before the opening User throughout the Turn, and user, steering, error, max-token, and turn-tail rows stay outside every span. Stable Chat Node Seats keep every renderer mounted, hidden members and declined settled-boundary rows add no flow spacing, and a closed disclosure sits 8px above its message row. A 2px inset left rule runs through each disclosure seat and its folded member seats (an inset shadow, because the elevation contract reserves layout-consuming neutral strokes for 0.5px hairlines), so a run of folds reads as one process header on a shared rail. Collapse does not depend on tail-follow position, so a reader above the tail may see the transcript reflow. An automatic collapse that would hide keyboard focus keeps the span open and leaves focus in place; a manual close focuses the disclosure before hiding its members. The opener row anchors at the Step boundary, so while a Step is still streaming its disclosure rides the boundary row and re-derives beside the step rows once the turn settles.

-----

<a id="scroll-ownership"></a>
## Scroll ownership

Chat restores semantic anchors across history prepend and renderer remounts. Pinned scroll deliveries without reader movement update follow ownership immediately, before subsequent layout changes can invalidate their floor. Reader movement remains pending until the sampling interval or `scrollend`, even inside the follow threshold, so layout growth cannot erase small scroll gestures. While the reader is pinned to the floor, `ResizeObserver` follows the new floor and selects the latest loaded Turn without reading row geometry. Once the reader moves away, flow-height changes preserve the top position and the reading-line geometry selects the active Turn. Turn-rail previews paint above sticky Markdown code-block banners, while the rail frame remains inside the transcript band above the composer.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package renders logged conversation state in the browser and registers nothing model-facing.

#### KV Cache effect

None; Chat presentation does not assemble or mutate provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The transcript reflects the loaded Session window** — older transcript nodes become available only after Session Controller loads the preceding event page. Turn navigation is wider than the window: the rail merges the loaded Turns with the host `turnOutline` projection, so every started Turn gets a fixed-pitch mark (10px apart; a ladder taller than the frame scrolls inside it with gradient fades), and activating an unloaded mark pages history through the Turn's `turn/start` seq before landing on its row. Without the projection (assemblies not mounting `dsh-session-turn-outline`) the rail falls back to loaded Turns only.
- **Rail previews are card-sized** — one prompt line (50 characters) and up to three response lines (120), on loaded and unloaded Turns alike; an unloaded Turn's response arrives from the outline only once the Turn settled, so an open Turn previews its prompt (or just the Turn number) until then.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Conversation and Slot registration enforce Chat target consistency.
