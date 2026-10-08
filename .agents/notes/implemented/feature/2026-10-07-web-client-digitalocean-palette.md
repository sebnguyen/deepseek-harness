# Agent Note: Web client palette — DigitalOcean design tokens

Status: implemented

## Problem

The web client's `--dsw-*` static scale carried the values a Chat front-end Figma export supplied: a Tailwind-shaped blue/amber/green/red ramp plus a `deepseek` hue for the brand accent. Nothing in the token system named a palette owner beyond that export, so every deployment rendered DeepSeek's identity — including the deployments running dsh against DigitalOcean infrastructure, which the shipped `do-standard` profile already covers by wiring DO serverless inference and DO model pricing while the UI stayed another vendor's blue.

DigitalOcean publishes its palette as OKLCH in `digitalocean/walrus` at `src/tokens/palette.ts`, with the semantic layer in `src/tokens/themes/light-theme.ts` and `dark-theme.ts`. That file supersedes `src/style/colorsV2.ts`, which now carries a `@deprecated` tag. An earlier pass at this recolor read `colorsV2` and produced the wrong appearance: it is the older, bluer scale, not the Silt/marine palette the current product ships.

## Decision

`packages/client/ui-theme/src/styles/design-platform.css` stays the single palette authority. Values move to the OKLCH palettes in `src/tokens/palette.ts`; the file stores their sRGB equivalents, because every consumer reads `--dsw-*` as `rgb()` and the theme service treats the values as opaque strings. The conversion is the standard OKLCH→linear-sRGB→sRGB chain and is verified against DO's own source comments, which carry the sRGB for several steps: `oklch(96.98% 0.0057 264.5)` → `rgb(243, 245, 249)` and `oklch(24.34% 0.0990 261.9)` → `rgb(3, 27, 78)` both reproduce exactly.

| `--dsw-static-*` hue | DigitalOcean palette (50→950) |
|---|---|
| `amber` | TENTACLE |
| `blue` | CERULEAN |
| `deepseek` | FOAM — the brand/link family |
| `green` | KELP |
| `neutral`, `neutral-bluish` | SILT, plus the dark surface ladder below |
| `red` | CORAL, with DO's danger-theme values on the aliases |
| `violet` | VIOLET — new; carries the accent |

The alias layer follows DO's two semantic themes rather than reusing one token per role: light `--dsw-alias-brand-primary` is `color-primary` `rgb(0, 99, 248)`, dark is `color-primary` `rgb(123, 180, 188)`, light `--dsw-alias-link` is `color-link` `rgb(30, 122, 216)`, dark is FOAM-300 `rgb(148, 198, 204)`, and the label ladder takes DO's `color-text-heading` / `color-link-secondary` / `color-text-muted` / `color-text-subtle` per theme. Label roles keep one static token each only where DO's two themes agree on the step.

### The accent is a new family, not a value swap

DO's accent is VIOLET and appears in an alias family the harness had no equivalent for, so the recolor adds one: eleven `--dsw-static-violet-*` tokens and `--dsw-alias-accent-bg` / `-text` / `-border`, mirroring DO's `color-accent-*`. The roles that already carried a second highlight move onto it — `--dsw-specific-bubble`, `--dsw-specific-bubble-highlight`, and `--dsw-specific-sidebar-nav-item-active-accent` — so the accent is visible as the user's own message surface and the selected sidebar row rather than only as an unused token.

That move is observable to the scrollbar contract. `elevatedRungs()` in `scrollbar-styles.client.spec.ts` collects every `--dsw-(alias-bg-|specific-)` token resolving to the dark `bg-layer-2`/`-3` values; the bubble and the sidebar active accent were two members and are no longer elevated, so the set drops from ten to eight. Removing members can only relax that assertion, never fail it. No new surface-pattern token resolves onto either rung. `--dsw-alias-accent-*` does not match the pattern (`^--dsw-(?:alias-bg-|specific-)`), so it cannot join.

### Dark is the product default

`DEFAULT_PREFERENCE` moves from `'system'` to `'dark'`, which is what the settings schema, the boot script, and `createAppearanceRowStore`'s pre-sync placeholder all read. `'system'` remains a selectable preference and still resolves through `matchMedia`; it is simply no longer what an unset document means.

### The label ladder follows DO's text ramp

DO's text roles are `color-text-heading`, `color-text`, `color-text-muted`, and `color-text-subtle`/`color-text-disabled`, so the five harness label roles map onto them one-for-one. DO states two of them as alphas — light `color-text` is the heading ink at 78%, dark `color-text`/`-muted`/`-disabled` are white at 60/48/36 percent over `color-app-bg` — and this file stores solids, so each is resolved against the surface its theme paints text on.

The first cut of this recolor resolved label roles by picking nearby static steps instead, and the result read badly in dark: `--dsw-alias-label-secondary` landed on SILT-600, giving 3.32:1 against `bg-base` and 2.85:1 on layer 2, where the palette it replaced had 12.11:1. Every step of both ladders now clears its predecessor, and the tail is deliberately one step stronger than DO's own muted/subtle steps, which sit at 3.92:1 and 2.74:1 on white:

| role | light | dark |
|---|---|---|
| `label-primary` | 19.34 | 17.11 |
| `label-secondary` | 10.15 (was 5.80 at HEAD, 5.49 shipped) | 7.10 (was 3.32 shipped) |
| `label-tertiary` | 5.49 | 6.64 |
| `label-caption` | 3.92 | 4.98 |
| `label-dimmed` | 2.74 | 4.65 |

`--dsw-alias-link` also moves one cerulean step past DO's `color-link` in light (CERULEAN-800, 6.21:1). DO's own light link is CERULEAN-700 at 4.35:1, which fails AA, and `MarkdownText` paints link text with this token — DO's next step up is `color-link-hover`, so the value is still DO's. Dark keeps DO's FOAM-300 at 9.72:1. Ratios are against `bg-base`: white in light, `rgb(18, 22, 24)` in dark.

### Selection surfaces take DO's `color-surface-selected`

DO selects with colour rather than grey: `color-surface-selected` is WAVE-100 in light and FOAM-900 in dark. `--dsw-specific-sidebar-nav-item-active` and `--dsw-alias-bg-multi-select` take that pair, so the selected sidebar row and a multi-selected row carry the palette's blue/teal cast. Both are surface-pattern tokens, and neither value can equal the dark `bg-layer-2`/`-3` rungs, so `elevatedRungs()` is unaffected.

### The dark ladder keeps its rungs

DO's dark surfaces are white-alpha overlays on `color-app-bg`; its dark borders and separators are SILT-50 at 0.08–0.36 alpha (`oklch(96.94% 0.0011 197.1 / x)`), not pure white. The harness alias layer is a static scale, not a compositor, so each surface overlay is composited over `color-app-bg` `rgb(18, 22, 24)` and stored as a solid, while the border alphas keep DO's silt-50 base.

Light borders run the other way. DO states them as solid SILT steps, and this file carries them as alphas, so the base colour decides the weight. The first cut reused the light SILT steps as that base, and light SILT over a light surface composites to almost nothing: 4% of SILT-100 over white is `rgb(254, 254, 254)`, a separator that is not there, and the whole light ramp came in 10–20 shades weaker than the black-based one it replaced. They now take DO's heading ink `rgb(0, 12, 42)` at the original alphas, which restores the weight the ramp had — 245→245, 230→230, 224→224, 214→214 composited over white, with DO's ink tint as the only difference — and that tint is the same characteristic DO realises in its own light borders. The dark neutral-bluish ladder takes 0%, 2%, 4%, 6%, 8%, and 12% white and closes on SILT-800, keeping every rung distinct and monotonic: `-950` `rgb(18, 22, 24)`, `-900` `rgb(23, 27, 29)`, `-875` `rgb(27, 31, 33)`, `-850` `rgb(32, 36, 38)`, `-800` `rgb(37, 41, 42)`, `-750` `rgb(46, 50, 52)`, `-700` `rgb(65, 74, 75)`.

Distinctness is load-bearing: the scrollbar spec derives `elevatedRungs()` from `-850` and `-800`, and requires every sheet that scrolls on one of those surfaces to rebind the thumb indirection.

The pure `--dsw-static-neutral-*` ramp is a second ladder with its own trap. Feature CSS consumes it directly rather than through an alias — `ui-deliverables` paints its delivered-file chip with `-850` and the chip's hover with `-800` — so the ramp has to stay monotonic in dark, each higher step darker than the one below. An earlier cut set `-850` to 28% white purely to hold it clear of the two protected rungs, which made it the *lightest* step in the dark ramp: the chip rendered as a pale grey block, its hover inverted to darker, and its 10px description sat at 2.65:1. The dark ramp now runs `-550` `rgb(80, 83, 84)`, `-600` `rgb(70, 73, 75)`, `-700` `rgb(56, 59, 61)`, `-800` `rgb(49, 52, 54)`, `-850` `rgb(42, 45, 47)`, `-900` `rgb(35, 38, 40)`: monotonic, none equal to either protected rung, and the chip's description clears AA at 5.05:1. The `-550`/`-600`/`-700` steps keep the separate white percentages the scrollbar roles resolve to.

### Sheets and literals outside the palette file

- `shiki.css` maps its syntax tokens onto the same hues: CERULEAN constants and links, FOAM strings, TENTACLE keywords, CORAL parameters, VIOLET functions, SILT comments and punctuation, light on `:root` and dark on the body attribute as before.
- `gradient-shadow-text.css` retints the two think-fade gradients to the new base surfaces (`rgb(247, 248, 248)` light, `rgb(18, 22, 24)` and `rgb(27, 31, 33)` dark). Shadow, mask, and `TurnNavigator` fade-stop alphas stay black: they carry transparency, not palette.
- `boot-page.module.css` and `web/src/base.css` mirror the new values in the pre-plugin fallbacks; the boot spinner's brand arm is DO's primary blue in light and its soft teal in dark.
- Literals that cannot resolve a variable carry the palette's sRGB: `JsonTree`'s JSON tree palette, `HoverCard`'s fixed dark surface `rgb(32, 36, 38)`, `FileTypeIcon`'s violet `rgb(177, 126, 164)`, `ModelsSection`'s chevron data-URI grey, and the `var()` fallbacks in `FileCard`, `Rows`, `ModelSelect`, `AppearanceRow`, and `SettingsRoot`. Comments citing the retired hexes moved with them.

## Alternatives considered

**Keep the `colorsV2` recolor.** It renders, but it is the deprecated scale: bluer neutrals, no accent family, and DO's current dark appearance is a teal-cast Silt that `colorsV2` cannot express. Reusing it would have shipped a palette DigitalOcean itself has moved off.

**Rename the `deepseek` hue to `brand`.** The rename would touch the hue's 11 static tokens plus every alias referencing them, for a label the alias layer already abstracts: feature CSS consumes `--dsw-alias-*`, so no consumer sees the hue name. Renaming would also collide with the primary work in flight on these sheets. The hue name is a Figma-export artifact, not a public contract.

**Interpolate the neutral steps SILT lacks.** Blending two adjacent DO steps would hit every rung exactly, but it puts invented colors under `--dsw-static-*` names, so a later "which DO value is this?" audit has no answer. Compositing DO's own white-alpha overlays keeps every value attributable — each is a real DO recipe, resolved.

**Emit the accent only as tokens.** Adding `--dsw-alias-accent-*` without moving any consumer leaves a family nothing reads, which the repository's "require a current consumer" rule rejects. Wiring the highlight roles is what makes the accent answerable to a rendered surface.

**Adopt DO's accent recipe for the highlight roles.** DO's dark `color-accent-bg` is VIOLET-600 at 12% and its `color-accent-border` is VIOLET-400 at 30%, which composite to `rgb(35, 32, 38)` and `rgb(72, 63, 74)` over `color-app-bg` — both weaker than the VIOLET-950 and VIOLET-800 solids used here. DO applies the accent to badges and inline highlights; this UI uses it for the user's message bubble and the selected sidebar row, where a surface that resolves within a few percent of `bg-layer-1` stops reading as a distinct surface. The stronger steps are kept, and the deviation is stated rather than hidden.

**Tint the light shadows with the heading ink.** DO's light `shadow-*` values are `oklch(16.54% 0.0657 259.5 / x)` rather than black. At the 2–5% alphas these tokens carry, the difference is below perception, and expressing it means redeclaring every derived elevation value a second time under the dark attribute, because those values are declared per element so a stroke rebind can reach them. The complexity does not buy a visible change, so the shadows stay black.

**Leave the feature-CSS `var()` fallbacks on the old palette.** They render only before `ui-theme` mounts, so the argument for leaving them is real. They are also the colors a failed theme delivery paints, and a half-recolored failure state is worse than a slightly larger diff.

**Hand-edit the recorded scrollbar geometry snapshot.** `snapshots/web/sidebar-scrollbar/geometry.expected.md` records computed thumb colors, so the recolor invalidates it. The values here were derived from the resolved tokens because the replay lane cannot run in this environment — Playwright's chromium fails to launch without `libnspr4.so`, so `DSH_SNAPSHOT=refresh pnpm run test:web` writes nothing trustworthy. The four values are a token resolution, not a measurement, and the next machine that can run the lane should confirm them.

## Consequences

The GUI is DigitalOcean-branded in both appearances with no change to the token system's structure beyond the added accent family, so feature CSS, the slots/props layer, and locale dictionaries are otherwise untouched. Two specs moved with the values: `file-type-icon-styles.client.spec.ts` pins the violet literal and now expects `rgb(177, 126, 164)`, and the recorded `sidebar-scrollbar` geometry expects the new light thumb `rgb(217, 222, 222)` / hover `rgb(197, 205, 205)` and dark thumb `rgb(70, 73, 75)` / hover `rgb(80, 83, 84)`. Those four values survive the contrast pass, which does not touch the `--dsw-alias-scrollbar-*` roles.

The dark default moved five spec files. `theme.client.spec.ts`, `boot-theme.client.spec.ts`, `host.client.spec.ts`, and `ui-layout/tests/apply.client.spec.ts` assert the value an unset document resolves to, so those expectations became `'dark'`; the matchMedia case in `theme.client.spec.ts` now pins `'system'` through a Host section it adopts at construction, because `'system'` is no longer the default, and the layout presenter case switches to `'light'` and back so both directions of the follow still land. `settings-store.client.spec.ts` pins the store's init shape as a literal, so a future default change stays deliberate rather than tautological.

The palette is now a second brand commitment alongside the DeepSeek one: `BRAND_GUIDELINES.md` governs the DeepSeek Harness *name*, and nothing in the repository yet states that the shipped tokens are DigitalOcean's. A deployment that wants the DeepSeek appearance back has to replace `design-platform.css`; the alias layer is the seam that makes that a one-file change, and the theme service's `tokens` override remains available for runtime aliases.

Two pre-existing failures in the client suite are unrelated to this change and were confirmed by stashing it: `packages/client/ui-file-history/src/client/views.module.css` uses an undefined `--dsw-alias-border-secondary` at a 1px border and puts `--dsw-alias-bg-layer-2` on a scrolling surface without rebinding the scrollbar indirection, failing the elevation and scrollbar specs. `packages/host/open-in-app/tests/resolver.spec.ts` fails on this host's desktop-session detection.
