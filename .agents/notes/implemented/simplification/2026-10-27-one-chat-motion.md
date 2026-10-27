# Agent Note: One motion for the chat surface

Status: implemented

## Problem

The transcript carried four arrival motions and three dead ones. `apps/web/public/atlas.css` mounted pce rows and answer blocks on a 620ms rise that faded from quiet grey to surface ink; the answer's streaming text swelled per character on its own keyframe, `markdown-tail-swell`, ramping deep blue through foam to ink; the turn tail rose on a third keyframe, `tail-raise`; and the streaming answer carried a pulsing caret, `tide-caret`, on the line that was already arriving. The rows were also the slowest motion in the theme, 620ms against the theme's own 240ms duration token, while the character swell was the fastest.

The answer was the one row kind with no entrance at all. It is the markdown surface and not a pce row, so the `.pce` rule never reached it, and the only motion it had was the streaming rule's, which stops matching the moment the answer settles: an answer delivered whole, replayed from history, or woken back up by the row window appeared at its final position with nothing at all.

Three more animations were dead. The running tool row's glare sweep, the running bash row's copy of it, and the active retry row's shimmer named classes the pce port had already replaced, so none of them painted; the source read as if the transcript were still full of motion it no longer had.

## Decision

One keyframe, `surf-up`, with the character swell's shape — a rise from just under the line, a fade up, and a warm from deep through foam to surface ink — carries every arrival in the chat surface: a pce row that mounts, an answer's blocks, the characters an answer reveals, and the turn's tail.

The keyframe lives in `packages/client/ui-primitives/src/motion.css`, a global stylesheet, and the rules that say which elements arrive stay in `apps/web/public/atlas.css`. The split is forced by the build: a CSS module localizes every animation name it sees, including one it does not define, so a module can neither share a keyframe with the theme's rules nor name the theme's. The package's rule for the revealed characters moved into the same global stylesheet for the same reason.

Every site takes the theme's own `--a-dur` and `--a-ease`, so a rise is 240ms; the characters keep the `--a-tail-dur` and `--a-tail-ease` knobs they had. The backwards fill drops every finished animation, so at rest `document.getAnimations()` is empty.

The streaming caret is gone: the live edge of an answer is the text arriving, and a second motion on the same line read as a second signal. The three dead animations are gone with it. The composer's sweep is not part of this — it is a state signal on the input, not an arrival in the transcript.

## Alternatives considered

- **Keep the character swell's keyframe name and give the rows a second one.** Two keyframes with one shape is not one animation: the second drifts the moment either changes.
- **Put the keyframe in `atlas.css` and have the package's markdown module name it.** The build rewrites the reference to the module's own scoped name, which resolves to no keyframe, so the animation silently does not run; the dependency would also run from a package to the app that hosts it.
- **Render the answer inside a headless `.pce` article.** The design mock draws its assistant element that way, and a wrapper would hand the answer the pce identity outright. The `.pce` class declares `container-type: inline-size`, so the wrapper would become the query container for the `100cqw` a wide markdown table breaks out against, and the table's measure would follow the narrower answer box instead of the chat window.
- **Bind the rise to the assistant node's flow kind instead of its body.** A node-level rule would animate the whole answer box, margins included, and would have to restate the block-level selector to keep the reasoning row out of it — that row's body is a `.pce-body`, not a `_body` module class, so it does not match the selector the rule uses.
- **Animate the answer as one block rather than per block.** The blocks arrive one at a time while an answer streams, and a single rise for the whole answer would hide that.
- **Give the rows the old 620ms rise.** The rows were the slowest motion in the theme, and the character swell at the theme's own duration is the reference for how fast an arrival reads.

## Consequences

- One animation, one shape, one duration: a row, an answer, a character and the turn's tail all arrive the same way.
- A row the band woke does not replay the rise. Dormancy re-mounts rows in bulk behind the reader mid-scroll, so the arrival there is not an arrival at all: 240ms of per-frame style and paint on every woken row would spend the whole animation budget where nobody is looking, at the moment the mounts already saturate the main thread. The theme suppresses every arrival site under `[data-chat-flow-woke]`; a row delivered at the tail and a session replayed from history keep the rise.
- A pce row's arrival drops from 620ms to 240ms.
- The answer rises with the rows, whether it arrives whole, replayed from history, or woken back up by the row window.
- The streaming answer keeps its characters arriving one at a time, on the same motion as the block they sit in.
- The transcript no longer paints a caret at the live edge of a streaming answer, and no longer carries the dead sweeps and the dead shimmer.
- A row that animates needs `position: relative`, because the rise is a `top` offset: `top` is the only property that paints on the character spans, which are non-replaced inline boxes a transform does not apply to.

## Testing

- Observed in Chromium against the shipped stylesheets — `atlas.css`, `PceRow.css` and `motion.css` — with a pce row, a settled answer, a streaming answer, a revealed character and a turn tail in one flow: at the first frame all five report one animation named `surf-up` at 240ms with opacity `0`, `top: 5px` and the deep start colour `rgb(14, 74, 122)`; after it all five report no animation, opacity `1`, `top: 0px` and the ink colour `rgb(247, 248, 248)`, and `document.getAnimations()` is empty.
- Observed in the same page: the five sites report one distinct animation name between them, the document holds exactly one keyframe rule, `surf-up`, and the streaming answer's trailing pseudo-element computes `content: none`.
- Every changed stylesheet parses: `apps/web/public/atlas.css`, `packages/client/ui-primitives/src/motion.css`, `MarkdownText.module.css`, `ToolRow.module.css`, `bash-row.module.css`, `MessageItem.module.css`, `ReasoningRow.module.css` and `GenericCommandCard.module.css`.