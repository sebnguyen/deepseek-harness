# @deepseek-ai/dsh-client-ui-vscode

## Summary

The embedded VS Code editor plane as a right-Sidebar tab type, the client half of the frame proposed by the Agent Note `2026-10-09-embedded-vscode-reh-editor-frame.md`. It claims `dsh-resource://file/**` addresses at the `builtin` band ahead of the CodeMirror editor while `dsh-host-ide` reports the frame ready, renders the loopback workbench's editor plane in an iframe, and drops every claim back to the fallback the moment readiness falls. File chips and delivery cards open in it for free: the chat view's `openFile` already routes through the sidebar registry claim.

## Model Experience

### What the model sees

Nothing directly. The frame is a human seat; the model's file chips resolve through the registry ranking this package joins, and a mention that resolves to a claimed address opens the frame instead of the preview.

### What the model writes

No surface here consumes model output. The agent-authored gutter and line notes live inside the frame's extension layer, covered by the note.

## Known Limitations and Deferred Work

- The timeline slider, comment threads, and dsh-dark theme are the bridge extension's ring-1 surfaces and ship in later waves of the same branch.
- The iframe rides the launch token in its url; loopback-only binding is the fence the note records.
