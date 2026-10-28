# Agent Note: transcript node rows keep no outer margin

Status: implemented

## Problem

The transcript's flow gap is the only space between rows, but several node roots
still carried the spacing of the old per-kind rhythm: every pce head reserved
8px under its line, the prompt stack carried 6px above and below, the
assistant/reasoning body carried 6px, an unknown-block root carried 4px, and the
turn-tail actions carried 4px. The app hid the pce head padding behind an atlas
override, so the bench and any consumer outside the shell saw taller rows, and
the other offsets applied everywhere. Rows read as having uneven leftover
margins even though the flow gap was one value.

## Decision

Each row owner is flush at its top and bottom; the flow gap is the only
inter-row space. The pce head's base padding is 0, and the prompt stack,
assistant/reasoning body, unknown-block root, and turn-tail actions carry no
vertical margin. Content spacing inside a row is unchanged: the assistant body
keeps its 16px block gap, the answer's action footer keeps its 16px top margin,
and the prompt row keeps its deliberate atlas 20px top inset.

## Alternatives considered

- **Keep the per-component margins and rely on atlas to override them.** atlas
  is scoped to `[data-dsh-shell]`; the bench and other consumers (a twin, a
  preview) do not get the override, so the same component renders different row
  geometry.
- **Add compensating negative margins to the flow item.** That keeps the old
  offsets in the component and makes the flow own knowledge of each node's
  interior; the next owner would have to know them too.
- **Move all outer spacing into the flow gap and drop the atlas prompt inset.**
  The 20px prompt inset is a deliberate turn boundary; the cleanup removes only
  the extra per-row margins around it.

## Consequences

Rows shrink to their content: pce rows are a 20px head line (16px for the
single-line notices), the prompt is bubble + 6px gap + actions, reasoning is its
head line, and the turn tail is its action strip. The 4px flow gap now reads
evenly across consecutive node kinds. The cost is that a row kind can no longer
tune its own outer breathing room; it must use an internal gap or ask the flow
owner.

## Testing

- `packages/client/ui-chat/tests/node-row-margins.client.spec.ts` pins the flush
  pce head, prompt stack, assistant body, unknown-block root, and turn-tail
  actions.
- The live ChatView bench measured every row: flow gap 4px, zero margin and
  padding on each flow item and node root; pce heads 20px, unknown-surface rows
  24px, reasoning 20px, answer 50px and turn tail 28px. Expanded pce bodies kept
  only the 8px inset, and no descendant carried a non-zero vertical margin.
