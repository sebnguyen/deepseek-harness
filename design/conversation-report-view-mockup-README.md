# Mockup: turn-report view of the DSH conversation

File: `design/conversation-report-view-mockup.html`

A better chat/conversation surface for the harness web client. Open in a browser.

## Ideas
1. **Turn as a report card**: intent line, then the answer up front, then artifact
   chips (files touched with +/−), then collapsed *Evidence*: verb-grouped folds
   (Searched / Read / Edited / Ran) whose counts carry outcome (1 failed → 1 passed).
2. **Session outline rail** left of the column: one row per turn with status dot,
   turn number, intent, wall time; a "touched this session" aggregate at the foot.
   Makes scannability linear in turns instead of linear in tool rows.
3. **Report / Transcript toggle**: the raw tape remains one click away, same data,
   two readings — quiet for review, tape for verification.
4. **Decisions never fold**: approvals and user questions render as cards outside
   the evidence body so permission history is auditable at a glance.
5. **Live turn = skeleton report**: groups assemble as step spans settle, so the
   report is the same projection mid-turn and post-turn.

All chrome rides the live `--dsw-*` tokens (hairline 0.5px borders, elevation
stroke-carried shadows, dark-first with light toggle) so it reads as the shipped UI.
