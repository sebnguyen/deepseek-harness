# Theme & UI-complexity audit — web/desktop app + VS Code twin

Scope: `apps/web`, `packages/client/*` (the shared renderer, also consumed by the Electron
`apps/desktop`), `packages/api/ide` (twin theme). Method: full cross-reference of every CSS
custom property defined vs. referenced across the client UI (423 defined / 237 referenced),
plus direct reads of the theme sheets, the twin theme, and the largest component files.
Every finding below cites the file it lives in.

Verdict up front: the **mechanism** is healthy (one token layer, one dark-mode switch
`body[data-ds-dark-theme]`, one theme service, disciplined token consumption in feature
packages). The mess concentrates in four places: the token sheet itself, at least four
design systems' values leaking into it, two hand-copied forks of it (twin theme, boot page),
and a handful of actually-broken token references that render as silently-unset styles today.

---

## P0 — Broken token references (rendering wrong today)

These `var(--…)` calls reference tokens that are **defined nowhere** in the tree and carry
**no fallback**, so the property silently falls to `unset`/inherit. Verified by
cross-referencing all definitions against all references.

| Token referenced | Where | Effect |
| --- | --- | --- |
| `--dsw-alias-label-error` | `packages/client/ui-settings-plugins/src/client/SubagentModelSelectionCard.module.css:43,52`, `PluginCard.module.css:109`, `fields.module.css:78` | Error text/border renders in inherited color, not red |
| `--dsw-alias-label-quaternary` | `packages/client/ui-agent-preset/src/client/AgentPresetSeat.module.css:44` | Text tone inherits instead of quaternary |
| `--dsw-alias-fill-l2` | `packages/client/ui-activity/src/client/ActivityDock.module.css:224,239,285` | Fill renders transparent |
| `--dsw-alias-fill-tsp-secondary` | `packages/client/ui-agent-preset/src/client/AgentPresetLabel.module.css:11` | Fill renders transparent |
| `--dsw-alias-separator-primary` | `packages/client/ui-chat/src/client/chat/StatsPills.module.css:33` | Separator invisible |
| `--dsw-alias-bg-layer-4` | `packages/client/ui-settings-plugins/src/client/SubagentModelSelectionCard.module.css:111` | Tries to use a 4th surface layer; only `--dsw-alias-bg-layer-1..3` exist |
| `--dsw-font-sm-13` | `packages/client/ui-tool/src/client/tool/components/ToolRow.module.css:370` | Font shorthand unset; correct token is `--dsw-font-xs-13` |
| `--dsw-interactive-bg-hover-solid` | `packages/client/ui-tool/src/client/tool/toolviews/bash-row.module.css:274` | Typo: missing `alias` (`--dsw-alias-interactive-bg-hover-solid` exists); hover fill missing |

Either add the missing aliases to the theme sheet (several read like legitimately-intended
tokens, e.g. `label-error`, `fill-l2`, `separator-primary`) or correct the call sites.

---

## P1 — Brand identity flips between themes

The single biggest "feels inconsistent" driver: the app's own accent color is a different
**hue family** per theme.

- Light theme: `--dsw-alias-brand-primary: rgb(0, 99, 248)` — DeepSeek-web blue (`#0063F8`),
  buttons ride blue-500 (`rgb(38,145,234)`). `design-platform.css:208,219,222`
- Dark theme: `--dsw-alias-brand-primary: rgb(123, 180, 188)` — DeepSeek teal (`#7BB4BC`),
  buttons ride deepseek-400. `design-platform.css:308,319,341`

So light mode is a **blue** product and dark mode is a **teal** product. `body` chrome,
links, focus rings, tab carets all switch hue families with the theme. If this is an
intentional DO-branding move (DO blue accent), the dark alias layer contradicts it; if it's
DeepSeek heritage never cleansed, the light layer contradicts the dark one. One decision
needed, then one palette.

## P1 — The token sheet is a merge of ≥4 design systems

`packages/client/ui-theme/src/styles/design-platform.css` mixes, in one file:

1. **DO "walrus" tokens** — its header says so; blue/violet/silt scales.
2. **DeepSeek-web scales** — `--dsw-static-deepseek-*` teal, incl. `--dsw-static-deepseek-700-delete`
   (literally named `*-delete`, `:123`) and a duplicate rung: `deepseek-300` == `deepseek-400`
   (both `rgb(148,198,204)`, `:117–118`).
3. **Tailwind palette** — state tint values: `--dsw-alias-state-success-bg: rgba(34,197,94,…)`
   (Tailwind green-500), success-primary dark `rgb(134,239,172)` (green-300), warn-label
   `rgb(252,211,77)` (amber-300) — none of these are walrus rungs (`:277–279,369,372,376–378`).
4. **GitHub Primer + old-DeepSeek fallbacks leaked into feature CSS** —
   `ui-line-note/src/client/LineNoteGutter.module.css:8,33` references nonexistent
   `--dsw-alias-text-secondary, #8b949e` and `--dsw-alias-surface-raised, #161b22`
   (GitHub dark) — the fallbacks save rendering but bake foreign palette hexes;
   `ui-attachment/src/FileCard.module.css` does the same with Tailwind `#b91c1c` and the old
   DeepSeek brand `#4d6bfe` (vs. current `#0063F8`) as fallback for the same alias.

## P1 — Load-bearing botched names and dead tokens

- `--dsw-alias-brand-primary-new-colorprimary-new-color` (`design-platform.css:210,310`) —
  a botched rename that shipped, now **load-bearing**: 8+ usages in
  `ui-trajectory/src/client/TrajectoryTable.module.css:277–683` and the dockkit tab caret
  (`ui-dockkit/src/components/dockkit.module.css`). Rename needs a codemod, not a find/replace blunder.
- `--dsw-static-deepseek-700-delete` — dead migration leftover (see above).
- **~130 defined tokens are never referenced anywhere.** Bulk: Figma-exported per-property
  font decompositions (`--dsw-font-*-font-family/-weight/-style/-size/-line-height` in
  `gradient-shadow-text.css` — only the shorthand is consumed) plus ~19 aliases
  (`--dsw-alias-accent-*`, `bg-mask-2/3/photo`, `markdown-code-segment-*`, `toast-bg`, …).
  Pure entropy for anyone editing the sheet.
- **Duplicated scale blocks**: the entire `--dsw-static-*` scale is re-declared verbatim in
  the `body[data-ds-dark-theme]` block (lines 97–182 ≈ lines 10–95) though statics don't
  change per theme — because the "dark surfaces" are expressed at the alias layer. ~85 lines
  of dead duplication. Also `neutral-*` and `neutral-bluish-*` scales overlap heavily
  (e.g. neutral-100 = neutral-150 = neutral-bluish-60 = `rgb(238,240,240)`).

## P1 — The theme package bypasses its own tokens

- `packages/client/ui-theme/src/styles/ocean-scene.css` hardcodes `#FFFFFF`,
  `rgba(0,99,248,.18)`, `rgba(38,145,234,.26)`… for the light-ray background — raw hexes in
  the canonical theme file (its comment calls them "raw marketing" values).
- `packages/client/ui-theme/src/styles/shiki.css` holds the syntax palette as raw hex
  (acceptably static — but see the twin fork below).
- `gradient-shadow-text.css` is three files in one: shadows/elevation + the entire markdown
  font ladder + mask blur; the name lies. Comments are in Chinese (`:4, 10, 22, 42–53`) with
  Figma-plugin-export heritage notes.

## P1 — Two hand-copied forks of the palette, no sync mechanism

1. **VS Code twin theme** (`packages/api/ide/src/twin-theme.ts`, shipped as a staged
   extension): every color re-typed as a literal — `#121618/#1b1f21/#171b1d` (bluish
   950/875/900), `#7bb4bc` brand, the full shiki syntax palette restated
   (`DO_TOKEN_COLORS`), ANSI palette. Drift check done during this audit: values *currently*
   match the dark alias layer — but nothing enforces that tomorrow.
   - **Dark-only**: contributes `DO Harness Dark` alone; harness switched to light keeps a
     dark editor island (or one more theme to hand-maintain).
   - `editor.fontSize: 13` fixed, ignoring the harness content font-size setting (12–17).
2. **Boot page** (`packages/client/web/src/boot-page.module.css`): hardcodes the token
   values a second time as `--dsh-boot-*` fallbacks (`#121618`, `#0063f8`/light,
   `#7bb4bc`/dark…). Needed because the boot screen renders before the theme sheet loads —
   fine — but it's a second copy to keep in sync, already drifting in naming (`#0063f8`
   baked as "brand" in light, i.e. the blue story).

## P1 — Three token naming generations coexist

Census of defined tokens: `--dsw-*` 375, `--dsh-*` 43, `--ds-*` 5, plus an orthogonal
`--shiki-*` set. `--dsw-` (deepseek-web) and `--ds-` (`--ds-font-family-code`,
`--ds-ease-in-out` in `base.css`) are legacy prefixes that any new contributor will read as
"the other system". Pick one beneficiary prefix and document the layers
(static → alias → specific).

---

## P2 — Complexity outliers (the "all over the place" half)

Scale: ~45 `ui-*` packages under `packages/client/`, ~41.5k lines of `.tsx`, ~22.9k lines of
`.css`. No duplicate component *implementations* turned up (same-named files across packages:
zero) — complexity concentrates in a few god-files:

| File | Size | Note |
| --- | --- | --- |
| `ui-trajectory/src/client/TrajectoryTable.tsx` + `.module.css` | 3,581 + 1,908 lines | By far the worst outlier: god component + god sheet |
| `ui-workspace/src/client/rows/WorkspaceBrowser.tsx` | 1,509 | |
| `ui-directory-picker-browse/…/DirectoryBrowser.tsx` | 1,052 | Parallel world to WorkspaceBrowser? |
| `ui-renderer/src/client/scoped-slots.tsx` | 994 | |
| `ui-chat/src/client/chat/ChatView.tsx` | 897 | |
| `ui-subagent/src/client/SubagentHeaderLineage.tsx` | 844 | |

…and the design-experiment pile living in-repo: `design/` (~20 mockup HTMLs), `mockups/`
(three competing candidate themes: walrus, aurora-mistral, gridspace), three root
`*-ui-sketch.html` files with unrelated ad-hoc palettes (`#0069ff`, `#ddc4d8/#daa549`, …),
which is how the twin syntax palette got in. Worth deciding which experiment is the
truth, then archiving the rest.

---

## What's healthy (don't tear it down)

- Single token layer, single dark-mode attribute, one theme service at
  `ui-theme/src/client/index.ts` with light/dark/system + font-size settings.
- Feature packages consume tokens well: most have **zero** raw color literals; the token
  cross-reference shows 0 references to nonexistent tokens *other than* the P0 list,
  and no competing dark-mode mechanism (`prefers-color-scheme` appears only in the theme
  service and boot script).
- `ui-primitives` is a real shared library (Button/Menu/Modal/Toast/Tooltip/…); its raw
  colors are icon-artwork data and ANSI mappings, legitimately.

## Recommended order of operations

1. **Fix the 8 broken references** (P0). Small, mechanical, immediately visible.
2. **Decide the brand story**: one accent hue across light+dark (pick DO-blue or teal),
   re-point `brand-primary`, `button-info-*`, `link`, `state-business-*` accordingly. This
   is *the* "theme problem" users feel.
3. **Rename codemod**: `…new-colorprimary-new-color` → `--dsw-alias-brand-accent` (or delete
   in favor of `brand-primary`), drop `…-700-delete`, dedupe `deepseek-300/400`.
4. **Collapse the sheet**: statics move to `:root` once (drop the duplicated dark block),
   merge `neutral`/`neutral-bluish`, prune the ~130 dead tokens, convert state-*-bg tints
   to `color-mix()` of palette colors instead of Tailwind literals.
5. **Single-source the twin**: generate `twin-theme.ts`'s color map from the token sheet at
   build time (or a shared JSON both read); add a light variant; follow harness font-size.
6. **Cleanup forks/fallbacks**: tokenize `ocean-scene.css`, strip GitHub-Primer/Tailwind
   fallback hexes from feature CSS, document one prefix policy; split
   `gradient-shadow-text.css` into `fonts.css` + `elevation.css`; translate comments.
7. **Then** complexity: a separate effort on `TrajectoryTable` (and friends) — it's a
   refactor, not a theming fix.

---

### Reproduce the cross-reference

```sh
cd deepseek-harness
USED=$(grep -rhoE 'var\(--(dsw|dsh)-[a-zA-Z0-9-]+' packages/client apps/web/src packages/api/ide/src \
  --include='*.css' --include='*.ts' --include='*.tsx' | sed 's/var(//' | sort -u)
DEFINED=$(grep -rhoE -- '--(dsw|dsh|ds)-[a-zA-Z0-9-]+:' packages/client apps/web/src packages/api/ide/src \
  --include='*.css' --include='*.ts' | grep -oE -- '--[a-zA-Z0-9-]+' | sort -u)
comm -23 <(echo "$USED") <(echo "$DEFINED")   # referenced, never defined (P0 + benign runtime tokens)
comm -13 <(echo "$USED") <(echo "$DEFINED")   # defined, never referenced (dead-token list)
```

Benign entries in the "never defined" list are runtime-written tokens
(`--dsh-content-font-size`, `--dsh-composer-height`, `--dsh-conversation-*`,
`--dsh-width-handle-pointer-y`, set via `style.setProperty` on body) and locally-scoped
component tokens with fallbacks (e.g. `--dsh-file-type-icon-color`, `--dsh-boot-*` in the
boot page).
