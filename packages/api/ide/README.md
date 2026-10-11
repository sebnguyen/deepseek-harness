# @deepseek-ai/dsh-api-ide

Host Remote namespace `ideBridge` plus the per-session VS Code twin spawner.

The config `dist` names a **combined VS Code twin directory**: the
`vscode-reh-linux-x64` product with the `vscode-web/out/*` tree overlaid onto
its own `out/` (the REH serves its workbench from `out/` — see
`scripts/prepare-vscode-twin.sh` in the build workspace). With `dist` empty
the namespace answers `enabled: false` and the client tab renders its
unavailable line instead of the iframe.

`ideBridge.status(sessionId)` lazily spawns one `bin/code-server-oss` child per
session bound to loopback on a free port, with a per-spawn connection token,
`--accept-server-license-terms`, and twin-local `--server-data-dir`,
`--user-data-dir`, and `--extensions-dir` under `dist/.dsh/`. The response
carries the loopback URL, the token, and the session's workspace root so the
client can form `url/?tkn=<token>&folder=<workspaceRoot>`. All children are
torn down when the host context disposes.

The harness webserver never proxies the REH: the client iframe points at the
loopback origin directly, which serves the workbench and the resolver from
one place (the OpenVSCode posture).

Downlink events (`vscodeBridge.hello`, file-forward signals, close
confirmation) land with the dedicated bridge extension package; this
scaffold carries status only.
