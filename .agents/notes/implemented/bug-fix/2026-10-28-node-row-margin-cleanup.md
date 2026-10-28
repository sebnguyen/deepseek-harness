# Agent Note: transcript node rows keep one gap and two deliberate margins

Status: implemented

## Problem

The transcript's flow gap is the shared rhythm, but the gap had been tightened
to 4px and the first cleanup pass removed every node's outer margin at once. The result read
as too tightly packed: consecutive pce rows, the assistant answer and the
prompt/steering rows all sat on the same 4px line, and the answer and prompt
bodies lost the small inset that separated them from their neighbours.

## Decision

- The flow array's gap is 8px; it is the shared space between rows.
- The assistant message body keeps a deliberate 6px top and bottom margin; the
  Think/reasoning row stays flush.
- The user and steering prompt stack keeps a deliberate 6px top and bottom
  margin.
- The pce head, an unknown-block root and the turn-tail actions stay flush; the
  plain pce rows do not get the old 8px head padding back.

Content spacing inside a row is unchanged: the assistant body keeps its 16px
block gap, the answer's action footer keeps its 16px top margin, and the prompt
row keeps its deliberate atlas 20px top inset.

## Alternatives considered

- **One 6px gap with no node margins.** That is the first cleanup; it read too
  tightly packed because the answer and prompt lost their own breathing room.
- **Give every node a top and bottom margin.** That restores the uneven
  per-kind rhythm the cleanup removed; only the assistant message body and
  prompt stack asked for the extra space.
- **Stay at 6px.** That was the first request after the cleanup, but the 6px
  transcript still read tight; the shipped gap is 8px with the two deliberate
  margins sitting inside it.

## Consequences

With the bench's 20px pce head line, pce rows stay 20px (16px for the
single-line notices), the prompt row is 76px of content plus 12px of margins,
the Think/reasoning row stays 20px, the answer is 50px plus 12px, the always-open
command is 40px and the turn tail is 28px. The flow gap is 8px everywhere; the
assistant and prompt rows read as separate bands while the plain work rows stay
flush. The cost is two deliberate per-kind exceptions in a rhythm that is
otherwise one gap.

## Testing

- `packages/client/ui-chat/tests/node-row-margins.client.spec.ts` pins the 6px
  prompt/assistant-message margins and the flush Think row, pce head,
  unknown-block root and turn-tail actions.
- `packages/client/ui-chat/tests/chat-flow-row-styles.client.spec.ts` pins the
  8px column gap.
- The live ChatView bench measured flow gap 8px; prompt and assistant-message
  rows 12px taller than their content, the Think row 20px; pce heads 20px,
  unknown-surface rows 24px and turn tail 28px. Expanded pce bodies kept only
  the 8px inset.
