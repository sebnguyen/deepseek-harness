# Agent Note: Ocean scene renders through a layered WebGL2 instanced engine

Status: implemented

## Problem

The ocean background's first GPU move replaced the DOM opacity-writes with a single per-fragment WebGL1 shader (previous `ocean-shader.ts`): every ray angle, sway, halo and dot was evaluated per pixel per frame, the boost overlay was blended into the ray loop, and the source baked a per-pixel seed hash for every layout parameter. The layer still flickered in review, the boost read as a nested band inside each ray, and the pose knobs (ray count/width/glow/blur) were compile-baked where the DOM mock had made them tunable.

## Decision

The ocean renderer is rebuilt as a **layered WebGL2 instanced engine** (`packages/client/ui-layout/src/client/ocean-shader.ts`), ported verbatim from the tuned mock at `mockups/ocean-instanced-mock.html`:

- **Layers.** Sea gradient and the lights (god-ray fan + boosts + halo blobs) render into a quarter-resolution FBO; a fullscreen blit brings them to the canvas; a device-px dot lattice draws on top at full resolution. The grid previously lived in the same fragment pass and moiréd when the FBO downscaled; it now stays on the backbuffer where it is crisp.
- **Instancing.** All lights ride one geometry stream (16 floats per instance: hinge, size, sway, breath, palette index, gradient window) through `twgl.createBufferInfoFromArrays` with `divisor: 1`; one instanced draw issues every ray shaft, the single boost bell, and the halo blobs per frame. 4 draw calls per frame total, zero per-frame buffer uploads.
- **Palette via theme resolution.** Uniform values are computed once per theme read (token overrides from `--dsh-ocean-*` CSS vars, with the `DEFAULT_PALETTES` fallbacks) and staged as `ThemeUniforms`; theme attribute flips re-resolve without touching the instance buffer. The hue lives on the instance as a palette slot, not as a re-uploaded color field.
- **twgl.js** is adopted as the GL helper (<https://github.com/greggman/twgl.js>) — the hand-rolled program/buffer/resize-uniform plumbing goes away, and shader sources become module-level template strings.
- **Locked pose.** After mock tuning the pose is baked as a constant `POSE` block: 12 rays wide / 6 under 900px, 1.75× shaft width, 0.75× glow, full breathing, 0.6 edge blur, dome radius 1.0 at 0.1 strength, quarter-res scale. The boost is one Gaussian bell spanning the fan horizontally (not a per-ray inner shaft) and is shine-gated quadratically so it only appears during inference.

## Alternatives considered

- **Keep the one-pixel-at-a-time WebGL1 shader**, pruning per-pixel work incrementally. Rejected: the per-ray geometry math (angle / sway / breathing) is per-instance data, and the per-pixel approach burns raster cost on recomputing what 17 instances encode; the mock showed one instanced draw with cached buffers is qualitatively shorter.
- **Per-instance hue in the attribute stream.** Works, but every theme toggle would need a buffer re-upload; a 3-entry uniform palette swap is cheaper and the mock's palette switch already proved it at 60fps. Hue-on-instance stays an option if per-ray live hues are wanted later.
- **Half-res FBO.** The mock's toggle showed half-res visual fidelity; quarter-res hides the FBO quantization under the same positional coverage and buys another ~4× fragment-work cut. Full-res is one constant flip away if moiré ever surfaces.

## Consequences

- `ui-layout` gains `twgl.js` as a regular dependency — the first runtime library in that package beyond cordis peers. Its UMD→ESM interop (`import * as twgl`) is settled inside `ocean-shader.ts`.
- The single experimental 8-ray per-fragment shader is deleted along with `VERTEX_SRC`/`FRAGMENT_SRC`, which nothing imported.
- Reduced-motion still renders one static frame via the same frame function at a fixed time; theme and size observers redraw it on change.
- Tuning is done against the mock (`mockups/ocean-instanced-mock.html`), which doubles as a fixture for future pose edits — change `POSE`, not scattered defaults.
