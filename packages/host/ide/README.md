# @deepseek-ai/dsh-host-ide

## Summary

Host half of the embedded VS Code REH editor frame proposed by the Agent Note `2026-10-09-embedded-vscode-reh-editor-frame.md`: the manifest row load, twin artifact resolution with sha256 refusal, the loopback REH spawn under a per-launch token through `ctx.subprocess`, and the `ide` Remote namespace (`status`, `events`, `open`, `hello`) the web client's `ui-vscode` tab kind and the dsh-bridge extension share. A deployment without twins reports `ready: false` forever, which is the editor-foundation note's M1 posture, so the frame never gates the product.

## Model Experience

### What the model sees

Nothing directly. The frame is a human-facing seat; the agent reaches it only through file chips and the registry claim the client half owns, and reads frame liveness nowhere in its prompt.

### What the model writes

No tool touches this package. Agent file writes land in the same workspace the REH edits, governed by the shared sandbox-policy stack the note records.

## Known Limitations and Deferred Work

- Windows and darwin twins sequence after the linux-x64 lane proves out; `IDE_PLATFORM` names whatever the Host runs on.
- The REH port rides the spawn handle's `port` promise; the real `ctx.subprocess` plumbing for port discovery is the wave's follow-up seam.
