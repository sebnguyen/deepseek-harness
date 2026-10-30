# Agent Note: The Present row adopts the PCE chrome

Status: implemented

## Problem

The `present` tool row rendered its own `DisclosureRow` plus a `StateDot`, so it did not share the chrome of every other tool and chat row: no kind mark, no fixed identity/description line, and a second disclosure implementation. Its status word and delivered path were packed into one collapsed line, while the shared PCE row already owns the kind mark, the state mark, the identity column, and the description ellipsis.

## Decision

`present` is a `PceKind`. `PresentRow` renders `PceRow` with `glyph="folder-open"`, `t('row.title')` as the identity, the declared file paths as the description, the running/delivered/failed/interrupted outcome as the PCE state and state label, and the recorded result plus the Inspect action inside the body. The row honors the owner's `rowMarks` flag like every other tool view. The kind colour joins the blue group, and the glyph coverage map records `present -> folder-open`.

## Alternatives considered

**Keep `DisclosureRow` and restyle it.** Two disclosure implementations would remain, and the row would still lack the shared mark/identity rhythm; the next PCE change would have to be made twice.

**Reuse the `inbox` kind.** `inbox` already owns `folder-open`, but it names a different surface; a future inbox row would share the present row's kind class and `data-pce` value.

**Show the status word in the description.** It would duplicate the state mark and break the "kind · description" grammar the other rows follow.

## Consequences

The status word is no longer visible: the check, loader, or close mark carries the outcome, and the localized word stays in the PCE state label for assistive technology. The row gains the shared kind mark, the 10ch identity column, description truncation, and the same disclosure interaction as the other rows. The `PceKind` union grows by one member, so every exhaustive kind map must record it; the coverage test maps `present` to the existing `folder-open` glyph, so no new artwork is added.

## Testing

`present-row.client.spec.tsx` covers the PCE shape, the running/delivered/failed/interrupted outcomes, partial arguments, and the result disclosure; `pce-glyph-coverage.client.spec.tsx` covers the new kind's glyph.
