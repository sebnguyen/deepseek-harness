# Agent Note: Bound one history page by serialized bytes, not just event count

Status: implemented

## Problem

Opening a large Session could fail before the client received any history. The
client asks for one 200-event tail page. The host serializes that whole page into
one WebSocket text frame (`packages/api/gateway/src/stream-server.ts:183-185`),
and `JSON.stringify` throws `RangeError: Invalid string length` past V8's
~512 MiB string ceiling. The catch wraps it as `api gateway: Remote stream item
is not JSON serializable`, and the client renders `Failed to load history: …
(gateway/internal)`.

The event budget does not bound payload size. A real 6.7 GB, 4,292-event Session
measured on this machine has a newest-200-event page of 546,528,115 serialized
bytes — over the ceiling — and its largest single event is 18 MB. Turbo makes
the failure easy to hit because several full conversation windows stay mounted
and retained at once.

## Decision

`paginate` in the host Session history controller cuts a page on both
`maxEvents` (still 200 by default) and `DEFAULT_MAX_PAGE_BYTES` (32 MiB of
serialized JSON). The walk starts at the newest event and stops before the next
event would cross the budget; it always includes at least one record, so a
single oversized event is still delivered when the transport can encode it.
`hasMore` remains `start > 0`, so the released prefix stays pageable. Both
`session/page` and the `session/follow` opening snapshot use the same cut.

The budget is headroom for the transport, not a Session format limit. 32 MiB
stays 28× under the V8 ceiling, includes one ordinary large tool result (the
measured Session's 18 MB event), and does not change normal Sessions, where the
200-event cap binds first.

## Alternatives considered

- **A smaller 8 MiB budget.** On the measured Session it returned 3 trivial
events (7 KB) and excluded an 18 MB tool result that alone fits the transport,
starving the first paint.
- **Lower `maxEvents` globally.** An event count cannot bound bytes; one tool
result can carry a whole file, and a smaller count would shrink every normal
Session's window for no reason.
- **Split the snapshot into one frame per event.** This removes the aggregate
ceiling but changes the stream protocol, the generated codecs, and the client
assembly path; the byte budget fixes the failure without a wire change.
- **Guard in the gateway before `JSON.stringify`.** The gateway holds the
encoded value, not the log; it cannot shrink a page it did not build.
- **Reject the Session as too large.** The history is valid and the tail is
loadable; only one frame construction was wrong.

## Consequences

The measured Session's opening page drops from 546 MB to 18 MB (10 events) and
now encodes. A page can carry fewer events than `maxEvents`; the client already
derives `baseSeq` from the first record and `hasMore` from the frame, so no
client change was needed. A single event larger than V8's string ceiling is
still not transportable; that belongs to the transport and needs chunked-event
frames, not a page budget. The host still materializes the whole stored log for
a cold page
(`packages/session-query/session-query/src/cold-read.ts:37-40`), and the client
still bounds its retained window by row count, not bytes, so a multi-gigabyte
Session remains expensive to open and scroll; this note fixes the frame
construction that made it fail outright.

## Testing

- `pnpm exec vitest run packages/api/session-controller/tests/session-history-journal.host.spec.ts` — 22 passed, including a new case where three ~12 MB messages yield a two-event page whose serialized bytes stay under 32 MiB.
- `pnpm exec tsc -p packages/api/session-controller/tsconfig.host.json --noEmit` — clean.
- Real Session measurement (`~/.dsh/sessions/--home-snguyen-dev-digitalocean-PR_review_playground--/session-8f508a9e-4348-4b38-b028-f376c51bd35b/session.v3.jsonl.zstd`, 4.18 GB compressed, 4,292 events, 6.7 GB of JSON): newest 200 events = 546,528,115 bytes; the 32 MiB walk selects 10 events / 17,988,972 bytes.

## Related

- [Release the history window the reader scrolled past](../simplification/2026-10-27-window-eviction.md)
