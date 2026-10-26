# VS Code twin — DigitalOcean identity (screenshots)

Live captures of the embedded twin editor before and after the DO identity
pass (`764e9350b5 feat(ide): DO identity for the twin`). Not mockups: every
pixel comes from the real `code-server-oss` product at the same 1500×950
viewport, headless Chromium through `probe/twin-shot.mjs`.

| | file | provenance |
|---|---|---|
| Before | `vscode-twin-before.png` | stock twin, fresh `--user-data-dir`/exts
| After | `vscode-twin-after.png` | same product, `dsh.do-harness` extension staged into `--extensions-dir`, `--disable-workspace-trust --disable-telemetry` |
| Boot | `vscode-twin-boot.png` | the boot seam inside the pane — DO twinkle mark over the wordmark before the iframe lands |
| In-situ | `vscode-twin-context.png` | the full harness page with the twin mounted in the vscode sidebar tab |

## Round 2 — the five chrome moves

- **Depth without float**: hairline dividers at 6% white, focus rings at half
  alpha — the framework's quiet-ink language instead of stock walls.
- **Chat fully out**: `chat.disableAIFeatures` + hidden agents pill + hidden
  aux bar — the twin is an editor; the harness is the conversation.
- **Sidebar right**: its position is stored UI state, not config, so the
  staged extension fires the deterministic `workbench.action.moveSideBarRight`
  once per profile and remembers it did (manual moves stay manual).
- **No double tree**: while a vscode tab is mounted, the harness's own
  explorer column leaves the right sidebar; it returns when the tab closes.
- **DO twinkle seam**: the pane's boot interstitial is the DO twinkle pixel
  mark under the wordmark, in the harness boot page's language.

## What the identity does

- **Palette**: bluish DO slate chrome (`#121618` activity/status,
  `#1b1f21` sidebar, `#171b1d` editor well), ink `#f7f8f8`, brand accent
  `#7bb4bc` on focus borders and the active tab edge, syntax colors mirrored
  from the harness `ui-theme` shiki sheet (keyword `#daa549`, string
  `#60a5af`, constant `#61c8f9`, function `#ddc4d8`, parameter `#d48b63`,
  comment `#738484` — same values the harness markdown renderer uses).
- **Chrome hush**: Welcome walkthrough never opens
  (`workbench.startupEditor: none`), no Restricted Mode banner (the harness
  sandbox owns trust), menu bar stays hidden (web default), telemetry
  off, update prompts off, experiments off, the `Code - OSS` tail off the
  window title, minimap off, editor at the harness 13px JetBrains Mono stack.
- **Delivery**: extension `configurationDefaults` + a first-class theme
  contribution staged on every spawn into `dist/.dsh/exts/` — the vscode-
  native product-default channel, so the twin's own Settings UI can still
  override anything. The before/after contrast is the whole point of the
  channel: identical product binaries, only the identity extension differs.

## Reproduce

```sh
# stock twin (before)
./bin/code-server-oss --port 47777 --connection-token T --accept-server-license-terms \
  --server-data-dir /tmp/s --user-data-dir /tmp/u --extensions-dir /tmp/e
TWIN_URL='http://127.0.0.1:47777/?tkn=T&folder=<ws>' OUT=before.png node probe/twin-shot.mjs

# staged twin (after) — same flags plus the dsh.do-harness extension and the
# trust/telemetry flags the harness spawn passes
node -e "import('<repo>/packages/api/ide/lib/index.js').then(m => m.stageTwinTheme('<exts>'))"
```

## Typography standard

Inter is the UI face and JetBrains Mono the code face on both sides. The
vscode fork bundles both and leads every workbench UI stack with `Inter`
(`src/vs/workbench/browser/media/style.css`); the twin extension sets the
editor and terminal to `JetBrains Mono` (`packages/api/ide/src/twin-theme.ts`).
The workbench CSS is compiled into the twin dist, so the twin side lands in a
rebuild; the harness shell loads the same files from
`apps/web/public/fonts/`.

## Known follow-ups

- Editor font size is still fixed at 13px and does not follow the harness
  content font-size setting (`design/THEME_AUDIT.md`).
- File-open-into-twin bridging (code opening in the twin editor when you
  click a tree row) is the next bridge layer, tracked separately.
