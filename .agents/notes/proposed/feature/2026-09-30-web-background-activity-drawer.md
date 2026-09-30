# Agent Note: Web background-activity drawer

Status: proposed

English | [中文](2026-09-30-web-background-activity-drawer.zh.md)

## Problem

The Web client answers "what is running in the background?" across four disconnected surfaces. The transcript's `run_in_background` and delegation cards record the start of a background task and never update again. The session header's job popover, since replaced by this note's chip and drawer, listed live jobs with an output tail but closed on any outside click. The header's subagent catalog ([dsh-client-ui-subagent](../../../../packages/client/ui-subagent/README.md)) navigates the durable descendant tree but shows only running/inactive activity. The left sidebar chip counts running subagents and says nothing about jobs. Each surface uses its own vocabulary and lifetime, none correlates an agent with the background processes that agent owns, and none can stay open while the user reads or writes in the conversation: watching a long build means pinning a popover over the header.

Two pieces of this were consciously deferred by [Web background-job display](../../implemented/feature/2026-08-08-web-background-job-display.md): a single surface uniting jobs and agents, and a host-wide view. This note proposes the unified half, per-session and read-only, leaving the host-wide view and human-initiated cancellation exactly where that note left them.

## Proposal

One chip docked above the composer, and one drawer that opens beneath the composer by lifting it. The chip is an entry in the existing `conversation.input.dock` list slot, the same slot that carries the claim chip, goal bar, and todo panel under the [slot type chain](../../implemented/architecture/2026-07-22-slot-type-chain-implementation.md). The drawer renders inside the sticky composer stack below the input bar, so opening it animates the whole stack upward with a height transition (honoring `prefers-reduced-motion`) and the transcript's visible area shrinks rather than the drawer covering content.

### The chip

The chip appears only when the session owns at least one background item, mirroring the quiet-entry rule of the current job trigger. Its badge counts live work — running jobs plus running subagents — with a spinner glyph while the count is positive, and the badge is omitted at zero once only settled rows remain. Clicking the chip, or a keyboard shortcut, toggles the drawer; the chip carries the open/closed affordance.

### The drawer

The left pane is an ownership tree with two sections. The Live section lists running and stopping jobs together with running subagents, ordered by start time; a job whose owner is a descendant session nests under that subagent's node, so an agent's background processes read as children of the agent. The Archive section, collapsed by default with a count in its header, holds settled jobs — completed, killed, failed, with the failure detail legible, per the rationale that a failed job's detail is the only place its failure reads — and inactive subagents, ordered by finish time. An "alive only" filter toggle hides the Archive entirely. After a host restart the registry mirror is empty while the transcript keeps its start cards, so the drawer hydrates archived rows from the session's `run_in_background` and delegation cards and marks them state-unknown until a live mirror entry revives them.

The right pane renders the selected node. A subagent shows its status and an "open as session" affordance that performs the existing exact-address navigation; follow-up submission and the independent Stop stay with the full session view, as specified by [Web subagent conversations](../../implemented/feature/2026-07-27-web-subagent-conversations.md) and [current-turn interrupt](../../implemented/feature/2026-08-06-continuable-subagent-interrupt.md). A job shows its outcome text — the producer's detail where one exists, the status word otherwise — keeping a failed job's failure legible. The terminal-style tail of raw output moves with the job-output channel under construction beside this work: once the client mirror for output frames lands, the detail pane gains the retained most-recent lines with the dropped-lines notice and autoscroll while live. Keyboard: ArrowUp/ArrowDown walk the tree, Enter selects into the detail pane, Escape closes the drawer and returns focus to the chip.

### Data flow and packaging

A new client package owns the chip, the drawer, and a `useSessionActivity` projection that merges the mirrors the Session Controller already folds — `jobsBySession`, `jobOutputBySession`, `subagentsByParent`, and catalog activity — into one row model with one status vocabulary over the committed mirrors. The flat view needs no new wire surface; the terminal tail rides the job-output channel in the second phase, not the first. The ownership nesting needs one addition: job frames are pushed per attached session, so a child's jobs never reach the parent's mirror; the Session Controller additionally pushes `jobs` frames for descendant sessions whose branches the drawer has reported as visible, reusing the catalog's existing branch-interest signal. Until that addition lands, the first phase shows the parent's jobs flat beside the agent tree.

### Retirement and scope

The header job popover retires with this surface: its row contract, status markers, and duration vocabulary move into the drawer, and the [background job list scenario](../../implemented/feature/2026-08-08-web-background-job-display.md) is rewritten against the chip and drawer in the same change. The header subagent catalog trigger stays for the first phase and retires when the drawer tree gains the catalog's contracts: the traversal's mechanical duplication is cheap, but its lazy descartes-branch loading plus the `conversation.composer` read-only election that ships beside the catalog are the migration's real cost, and deferring them keeps the drawer's first phase read-only by construction. The left sidebar's running-subagent chip stays: it answers "which session is busy", a different question from "what is this session running". The transcript cards are untouched by this proposal; live status chips on them are a later enhancement. The drawer is read-only: no kill, no stop, no follow-up inside it; a subagent row offers "open as session", which routes through the existing exact-address navigation whose full composer stays the continuation seat. The scope is per-session; a host-wide activity view remains deferred behind the registry's per-owner authorization fence, as in the 2026-08-08 note.

Phasing: P1 ships the chip and the drawer with the flat tree — the parent's jobs plus direct subagent children from the catalog mirror — outcome detail, the alive-only filter, and the job popover retirement. P2 ships the terminal output tail over the job-output channel, the embedded subagent transcript, the drawer tree's lazy-descendant loading taking over the catalog's keyboard contract, and the descendant job frames that enable nesting. P3, optional, is actions (human kill with its model-visible interrupt decision, subagent outcomes), which the row-as-control structure leaves room for without redesign.

## Alternatives considered

**A right-bar Activity tab.** A resident tab in the dockkit right bar reuses an existing tab registry, but the right bar is the document-viewer seat: watching activity while chatting costs a tab context switch, and the tab competes with files and previews for one pane. The drawer keeps activity adjacent to the input bar, where attention returns on every message, and follows the input-dock precedent the claim chip already set.

**A true bottom dock as a second dockkit edge.** A VS Code terminal-style drawer below the transcript has the same geometry as the composer-stack drawer but requires building a second dock edge; the composer stack is already sticky at the floor, so growing it downward beneath the input bar reaches the same layout with existing machinery.

**One unified popover instead of a drawer.** Cheapest to build, but a popover is transient by nature — it closes on outside click and cannot be kept open beside the conversation, which is the central complaint this note answers.

**Folding jobs into the subagent catalog.** The 2026-08-08 note rejected this because the catalog is a durable session-lineage tree with lazily expanded branches, durations, and token contracts, while process-scoped jobs are a second data model. That analysis still holds for the catalog component; the drawer instead merges both mirrors at a client projection layer, leaving each source model untouched.

**A host-wide activity center.** The registry's authorization fence is per-owner session; a global list needs a new access rule and a home outside the session header. Deferred, not foreclosed, per the 2026-08-08 note.

## Acceptance criteria

- A keyless Web e2e, extending the existing background-job-list scenario: a real `run_in_background` call makes the chip appear with a live count and no user interaction; opening the drawer lifts the composer; the Live rows tick; selecting the live row surfaces its status; killing the job through the registry settles it into the Archive with its failure detail legible.
- A running one-shot background subagent appears once under Live. With P2, the jobs it owns nest beneath its node, the embedded transcript streams while it runs, and the drawer tree carries the catalog's keyboard contract in place of the header trigger, whose read-only composer is unaffected.
- The header job trigger is gone in the same change that ships the drawer; the header catalog trigger retires with the P2 tree.

## Risks

- The drawer and the transcript compete for vertical space on short viewports. The drawer caps its height at a fraction of the viewport and closes with one Escape, keeping the transcript usable.
- Embedding a second transcript renderer inside the drawer doubles conversation rendering cost while both are visible. The detail pane mounts one child session at a time and reuses the existing virtualized trajectory renderer, which bounds the cost.
- Descendant job frames widen the control stream. Frames stay whole-snapshot per session and are pushed only for branches the drawer has reported as visible, so an idle drawer costs nothing.
- Retiring the header job trigger removes its stable aria landmarks from e2e goldens: the background-job-list scenario is rewritten against the chip and drawer aria names in the same change, in refresh mode.
- The header catalog stays beside the drawer through P1, so two surfaces answer the same question until the P2 tree ships: accepted as temporary duplication to keep the drawer's first phase free of the catalog's migration cost.
