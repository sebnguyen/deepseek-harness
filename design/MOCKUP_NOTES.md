# Turn-report view mockup

Deliverable for "mock up a better chat/conversation UI":
`design/conversation-report-view-mockup.html` — self-contained, opens in any browser.
Dark-first with a light toggle; Report/Transcript segmented control, session outline
rail, answer-first turn cards, verb-grouped evidence folds. Token sheet mirrors
`packages/client/ui-theme/src/styles/design-platform.css` (light block + dark block
verified against lines 184-381 of the live sheet this session).

Known UI bug being worked separately: trailing unparseable tool-invocation blocks in
assistant messages render as literal text in the web client.
