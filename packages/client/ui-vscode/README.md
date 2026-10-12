# @deepseek-ai/dsh-client-ui-vscode

Browser half of the embedded VS Code seat.

Registers the `vscode` tab type on the right Sidebar at the `extension` band (one above the text editor's `builtin`) for `dsh-resource://file/**` addresses: when `@deepseek-ai/dsh-api-ide` runs a twin, mounting one of these tabs boots a VS Code iframe in place of the CodeMirror editor; when the namespace answers `enabled: false` the body shows its unavailable line, and because the body — not the claim — gates readiness, closing/ops never regress a tab that cannot mount. The iframe points at the twin's own loopback URL (`url/?tkn=<token>&folder=<workspaceRoot>`), which serves the workbench and the resolver from one origin.

The iframe element lives above any tab body: `keep-alive.tsx` hosts one frame per ready src — identical across sessions on one workspace, because the host runs one twin per workspace root and answers one URL + token — in a document-level node no session owns. A body adopts its workspace's frame on mount and parks it hidden on unmount; moving the element between connected parents never reloads its document, so a session switch on the same workspace re-shows the live workbench with no reload, a switch to another workspace keeps the first frame alive for an instant restore on return, and only a new workspace root loads a fresh frame (the cap is two; the least-recently-created parked frame falls out). The workbench's origin-keyed IndexedDB keeps reload-visible state across restarts.

The `vscodeBridge.hello` handshake, back/forward injection, and the close-confirmation dialog are later layers in the design note path.
