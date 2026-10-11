# @deepseek-ai/dsh-client-ui-vscode

Browser half of the embedded VS Code seat.

Registers the `vscode` tab type on the right Sidebar at the `extension` band
(one above the text editor's `builtin`) for `dsh-resource://file/**` addresses:
when `@deepseek-ai/dsh-api-ide` runs a twin, mounting one of these tabs boots
a VS Code iframe in place of the CodeMirror editor; when the namespace
answers `enabled: false` the body shows its unavailable line, and because the
body — not the claim — gates readiness, closing/ops never regress a tab that
cannot mount. The iframe points at the twin's own loopback URL
(`url/?tkn=<token>&folder=<workspaceRoot>`), which serves the workbench and
the resolver from one origin.

The `vscodeBridge.hello` handshake, back/forward injection, and the
close-confirmation dialog are later layers in the design note path; this
scaffold carries the mount only.
