# ui-layout-mode

The generic layout-mode host. `ui-layout` owns the shell and the single
`layout.mode` seat; it holds no mode state, no mode id, and no switcher. This
package owns the mutable mode state, the one-time chooser, and both rosters:

- `layout.mode.option` — a `list` roster. Each mode registers a raw React card
  that presents the mode and calls `choose(modeId)`. The host registers the
  built-in `default` card here too, ordered first, so the chooser renders one
  roster and the default shell is not a special case.
- `layout.mode.entry` — a `keyed` roster. The pinned choice selects the entry
  whose key matches the pinned mode id.

The chooser appears on every window load. A choice is immutable for that
window: there is no in-app exit or switch. A new mode means a new window.

The host also owns the generic fallback: if the pinned entry disappears, it
returns the window to `default` rather than leaving an empty layer.

## Model Experience

One host, many modes. A mode is a presentation plugin, not a second layout
shell. The host has no product copy beyond the chooser, no mode-specific CSS,
and no knowledge of Turbo, grids, or sidebars.

## No invariant

Browser presentation only; no host-plane or independent runtime relationship.
