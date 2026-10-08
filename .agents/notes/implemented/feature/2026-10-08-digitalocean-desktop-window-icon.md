# Agent Note: The Desktop Windows icon carries the DigitalOcean mark

Status: implemented

## Problem

The rebrand swept the DeepSeek identity out of the web favicon, the manifest, the document titles, the sidebar mark, and the startup splash, but the Desktop application's Windows-facing surfaces had no corresponding asset: the Electron shell created windows without an icon option (the platform default), the Windows installer and executable would derive whatever electron-builder found (upstream's committed icon set renders the DeepSeek whale), and no raster pipeline existed in this tree to produce a branded one.

## Decision

One vector source, `apps/desktop/resources/icon-windows.svg`, carries the mark: the white DigitalOcean glyph — identical path geometry to `DigitalOceanLogo` in `dsh-client-ui-primitives` — centered on a rounded `#0069FF` DigitalOcean-blue tile in a 1024-unit viewBox, with the glyph wrapped in a `tray-glyph` group so small renders can enlarge it without touching the tile.

`scripts/render-tray-icon.ts` rasterizes it with sharp (devDependency `^0.35.3`) into the two committed outputs: `resources/icon-windows.png` (1024 px) and `resources/tray-windows.ico`, a Vista-style ICO bundling one PNG bitmap per display scale (16, 20, 24, 32, 40, 48, 64). Each bitmap renders at four times its edge and downscales, and the tray variant scales the `tray-glyph` 1.2x about the tile center so the mark stays legible at 16 px. Rerunning `pnpm run render:tray-icon` in `apps/desktop` is byte-stable; regeneration happens only on vector-source changes, so builds never need sharp.

Consumption: electron-builder takes the PNG as `win.icon` (NSIS installer and executable) and ships `resources/*` inside the asar; `src/main.ts` resolves `resources/icon-windows.png` against `app.getAppPath()` — the source tree in development, the asar packaged — and passes it as `icon` to every `BrowserWindow`, falling back to the platform default when the image loads empty. macOS and Linux keep electron-builder's derived icons; the macOS freestanding `icon.png`/`icon.icns` set arrives with the macOS packaging branch.

`tests/tray-icon.spec.ts` pins the ICO directory shape, the entry size roster, and the reject paths of `packIco`/`unpackIco`; `tests/main-startup.spec.ts` mocks `nativeImage` and asserts every created window carries the icon option.

## Alternatives considered

**Let electron-builder convert the PNG alone.** Builder can derive ICOs, but conversion quality and size rosters vary by builder version and nothing renders crisp 16 px tray bitmaps. It lost to committing the generator output that `tray-icon.spec.ts` pins byte-for-byte.

**Reuse the web `favicon.svg` (white mark, transparent background).** It loses on light taskbars and window chrome where the tab strip's dark backdrop does not exist. It lost to the blue tile, which reads on both schemes.

**Wait for a design-tool export of a desktop icon.** The sidebar mark is already the sanctioned DigitalOcean asset in this product, so composing the tile from the same path keeps one geometry everywhere. It lost to derivation from the existing primitive.

## Consequences

Every Windows-facing surface of the packaged app — window caption, taskbar, Alt-Tab, installer, executable — shows the DigitalOcean mark instead of the DeepSeek whale or the Electron default, and development runs show it too. The price is two committed binary artifacts that must be regenerated through `render:tray-icon` when the SVG changes (the spec catches a missing regeneration only as a review miss, not a gate), a sharp devDependency used only by that script, and a `nativeImage` mock the desktop startup suite now requires.
