# Agent Note: Web shell clips the document viewport

Status: implemented

## Problem

The web shell pinned `html, body, #root` to `height: 100%` but never stated that the document itself does not scroll, so the fixed-viewport application rested on the content always fitting. Any stray overflow box — one left ~5px of document scroll height past the viewport while every chrome box stayed viewport-sized — made the whole application chrome scroll like a plain web page.

## Decision

`packages/client/web/src/base.css` clips the document: `html, body { overflow: hidden }` beside the height pin. The application is a single-page fixed-viewport shell whose scrollable surfaces are all internal scrollers — the conversation scrollport (`ui-conversation` `.scrollBody`), chat transcript (`ui-chat` `.scroll`), workspace and file-tree lists, view bodies, and modal bodies (`ui-primitives` Modal, onboarding dialogs) — so no shipped surface needs document scroll; the boot page fits the viewport and dialogs scroll inside their own boxes. The clip states that contract explicitly instead of deriving it from content fit; removing it would silently regress any future overflow box back into whole-page scroll. A surface that genuinely needs document scroll must revisit this rule deliberately, not collide with it.

## Alternatives considered

- `overflow: clip` on `html, body`: expresses no-scroll without creating a scroll container, but `clip` forbids programmatic scrolling of the document and offers no advantage here — the shell never scrolls the document programmatically, and `hidden` is the spelling every shipped engine resolves identically.
- `position: fixed` or `100dvh` sizing on `#root`: pins the shell but leaves the document flow scrollable around it, so the reported whole-page scroll would persist.
- Hunting each stray overflow box as it appears: treats the symptom per incident and re-litigates the contract on every new surface; the clip makes the overflow inert instead.

## Consequences

- The document scrollport stays inert: wheel and touch gestures reach it only when no inner scroller consumes them, and any future overflow box is clipped instead of widening the page.
- Every legitimately scrolling surface must be an internal scroller; the boot page and all dialogs were verified to fit or scroll inside their own boxes before the clip shipped, so no shipped surface loses access to its content.
- Browser features anchored to document scroll (scroll chaining to the viewport, `scroll-behavior` on `html`, document-level scroll restoration) no longer engage in the web shell; none is consumed by the client stack.
