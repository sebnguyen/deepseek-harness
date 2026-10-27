# Pixel symbols — 32×32

> **Archived experiment.** The shipping decision is the existing 16×16 grid,
> rendered at whole multiples of 16 px (16/32/48/64/96/128). This 32×32
> derivation is kept for reference and is not wired into the app. The shipping
> preview is `design/pixel-symbols-mockup.html`, built by
> `design/pixel-symbols-mockup.mjs`.

33 glyphs derived from **Material Symbols Outlined** SVGs through
`design/downsample.mjs` (the same hard-downsample engine as the DigitalOcean
mark): flatten the vector, trim to its ink bounds, fit to the engine's 24×24
canvas, then keep each 32×32 cell whose coverage window crosses 50%.

Source art: `https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/<name>/default/24px.svg`
(Outlined, `FILL 0`, `wght 400`, `GRAD 0`, `opsz 24` — the Google Fonts link's
defaults). Fetched sources are cached in `../material/`; `error` is Material's
`dangerous` (the link's selected icon), and `add` / `dangerous` reproduce the
old 16×16 cell set exactly.

## Why 32

A cell is only pixel-exact when the render size is a whole multiple of the
grid. The 32 grid is exact at 32, 64, 96 and 128 px; at 18 px it is 0.56 px per
cell and gets *softer*, not crisper. The shipped chat mark stays on the 16×16
set at 16 px (1 px per cell). Do not render these assets at 12–18 px.

## Mapping

| glyph | Material Symbols | glyph | Material Symbols |
|---|---|---|---|
| `add` | `add` | `folder-add` | `create_new_folder` |
| `adjust` | `tune` | `folder-close` | `folder` |
| `ask` | `help` | `folder-open` | `folder_open` |
| `attach` | `attach_file` | `fork` | `fork_right` |
| `bash` | `terminal` | `generic` | `construction` |
| `check` | `check` | `image-read` | `image_search` |
| `clock` | `schedule` | `internet` | `public` |
| `close` | `close` | `model-provider` | `smart_toy` |
| `context` | `note_add` | `narrate-mode` | `volume_up` |
| `copy` | `content_copy` | `pause` | `pause` |
| `error` | `dangerous` | `quiet-mode` | `volume_off` |
| `read` | `description` | `statistic` | `insert_chart` |
| `reload` | `refresh` | `think` | `psychology` |
| `send` | `send` | `thumb-down` | `thumb_down` |
| `setting` | `settings` | `thumb-up` | `thumb_up` |
| `todo` | `checklist` | `token` | `token` |
| `write` | `edit` | | |

## Regenerate and check

```sh
cd deepseek-harness
node design/pixel-symbols-gen.mjs            # uses ../material/; --refresh re-fetches
node design/pixel-symbols-32-check.mjs       # exits nonzero if any asset drifts
```
