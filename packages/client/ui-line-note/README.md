---
kind: package-reference
---

# @deepseek-ai/dsh-client-ui-line-note

## Summary

Line-anchored editor notes for the Web plane. The plugin contributes one entry to the editor's `editor.cm.extension` slot: a gutter column left of the line numbers shows a `+` on hover and a pencil where a note exists; the popover writes a `note` slot through the checkpoint `slotPut` remote with the line's current text as `retained`. The session's live notes ride a `lineNotes` session-standard hook over `remote.checkpoint.slots`, re-fetched on each binding revision. The companion Agent Note is `2026-10-08-line-anchored-editor-notes-as-prompt-snapshots`.

## Known Limitations and Deferred Work

- Notes render in the source editor only; the rendered Markdown and HTML previews carry no hover affordance yet.
- Releasing a note from the gutter is not wired; `slotRelease` remains a remote-only surface.
- The `@<path>#L<line>#<note-id>` mention grammar is owned by the reference pipeline, not this package.
