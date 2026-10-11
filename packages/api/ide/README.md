# @deepseek-ai/dsh-api-ide

Host Remote namespace `ideBridge` plus the per-session VS Code twin spawner.

The config `dist` names a **combined VS Code twin directory**: the
`vscode-reh-web-linux-x64` product (the lane that serves `out/` — see
`scripts/prepare-vscode-twin.sh` in this repository). With `dist` empty the
package discovers the twin itself: the sibling `<repo>/../.vscode-twin/dist`
then the in-repo `.vscode-twin/dist`, so a plain `dsh web` (no
`DSH_VSCODE_TWIN_DIST`) mounts the tab whenever a twin was staged. Only when
discovery also finds nothing does the namespace answer `enabled: false` and
the client tab render its unavailable line instead of the iframe.

`ideBridge.status(sessionId)` lazily spawns one `bin/code-server-oss` child per
session bound to loopback on a free port, with a per-spawn connection token,
`--accept-server-license-terms`, and twin-local `--server-data-dir`,
`--user-data-dir`, and `--extensions-dir` under `dist/.dsh/`. The response
carries the loopback URL, the token, and the session's workspace root so the
client can form `url/?tkn=<token>&folder=<workspaceRoot>`. All children are
torn down when the host context disposes.

Each spawn restages the DigitalOcean identity as a small extension
(`dsh.do-harness`) under the twin's own `--extensions-dir` (`dist/.dsh/exts/`):
a `configurationDefaults` row the REH-web workbench actually reads (DO default
theme, harness code-font stack, hushed chrome — no Welcome walkthrough, no
Restricted Mode banner, no telemetry or update prompts, no chat surfaces
(`chat.disableAIFeatures` + hidden agents pill + hidden aux bar — the harness
is the conversation), the `Code - OSS` tail off the window title), plus a
first-class `DO Harness Dark` theme carrying the bluish palette and the
harness shiki syntax colors, with hairline dividers and half-alpha focus
rings in the harness's quiet-ink language. This channel exists because the
REH-web workbench keeps user settings in browser IndexedDB, not server-side
files — seeding `User/settings.json` never reached the workbench.
The spawn also passes `--disable-workspace-trust` and `--disable-telemetry`
for the chrome that flags own. The side bar rides right: its position is
stored UI state, not config, so the staged extension runs a one-time boot
script (`extension.cjs`, `onStartupFinished`) firing the deterministic
`workbench.action.moveSideBarRight` command and landing it in the profile's
global state — later manual moves win. Registry defaults otherwise stay
registry defaults: the twin's own Settings UI still wins over every key. See
`src/twin-theme.ts`.

The browser-origin persistence story lives next door: the workbench's
IndexedDB is origin-keyed, so the twin's port is pinned per dist
(`dist/.dsh/port`, seeded hash inside the harness band 45961+ with collision
walk) rather than random every boot — user choices in the twin survive
`dsh web` restarts. See `src/twin-port.ts`.

The harness webserver never proxies the REH: the client iframe points at the
loopback origin directly, which serves the workbench and the resolver from
one place (the OpenVSCode posture).

Downlink events (`vscodeBridge.hello`, file-forward signals, close
confirmation) land with the dedicated bridge extension package; this
scaffold carries status only.
