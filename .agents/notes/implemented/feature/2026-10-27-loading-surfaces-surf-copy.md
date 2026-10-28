# Agent Note: Loading surfaces with rotating DigitalOcean stack copy

Status: implemented

## Problem

Opening a Session that has history rendered an empty transcript with a single
static "Loading history…" line. The web boot page had the same problem at app
scale: a twinkling mark, the wordmark, and one static "Loading plugins…" line.
The VS Code tab's boot cover repeated the twinkle and a single state line. None
of these surfaces said anything useful while the user waited, and the earlier
per-character wave kept repeating one sentence while competing with the sweep.

## Decision

`ConversationSession` renders `HistoryCurtain` over its view area while
`SessionSnapshot.openState === 'loading'` — the same snapshot field `ChatView`
and `TrajectoryView` already gate on. `doOpen` sets the field to `loading`
synchronously and to `open` after `events.open()` resolves
(`packages/api/session-controller/src/client/sessions/session.ts:620,636`), so
the trigger is an existing snapshot subscription, not a new event or readiness
probe.

The curtain holds for 140 ms before painting, so a history window already in
memory never flashes it. It centers the 128 px `PixelLoader` sweep (the
DigitalOcean pixel mark), the 26/32 wt500 wordmark, and a `SurfText` run that
rotates thirty short DigitalOcean stack tips — Droplets, App Platform, Spaces,
DOKS, Floating IPs, VPC, Volumes, Load Balancers, Functions, managed databases,
Container Registry, Monitoring, Uptime, Projects, tags, Terraform, and
cloud-init — every 3.2 s. The tips are bare sentences; there is no `Tip:`
prefix. Each arriving line rides the existing `surf-up` keyframe from
`motion.css`; the departing line runs the new `surf-out` keyframe (fade plus
sink). Both lines share one grid cell, so the copy swaps in place without
reflowing the mark.

The wordmark and tip lines are `aria-hidden`; the status keeps the stable
`conversation` namespace's `session.loadingHistory` label. Screen readers and
the e2e `captureStableAria` helper therefore see one stable status while the
visible tip changes — a rotating live region would otherwise make the ARIA
snapshot unstable and chatter every 3.2 s.

`SurfText` in `ui-primitives` takes `messages`, `font`, `interval`, and
`className`. It owns the step state and re-keys each line so both animations
restart on every swap. React owns the timing; the keyframes own the motion, so
there is no motion dependency. `prefers-reduced-motion` removes the entrance
and hides the departing line, so the copy still rotates but snaps instead of
fading.

The same treatment covers the two web loading surfaces. The framework-free
`BootPage` renders the sweep and a vanilla copy of the rotation (`BOOT_TIPS` in
`boot-page.ts`, English because the boot page runs before the locale service);
its visible hint becomes the stable `Loading plugins…` status label, and the
boot e2e waiters target `[data-dsh-boot-tips]` instead of the old text. The
VS Code twin's `BootHero` swaps its twinkle for the sweep and `SurfText` with
the `vscode` namespace's `boot.tip.*` lines while spinning; the unavailable
and failed states keep their literal status line.

Both loading surfaces use the new-session hero's brand stack — the mark above
the 26/32 wt500 wordmark, tips below — so the boot page no longer flips the
name above the mark before the empty hero paints. All web loading surfaces
now render the sweep mark at 128 px: the history curtain's mark was the last
104 px holdout.

The curtain is absolute in `.viewArea` (now `position: relative`), which covers
the transcript for both Chat and Trajectory. It shares the sticky composer
seat's z-index so the later sibling (the seat) still wins and the input card
stays live. The ChatView's inline hint is deleted; the curtain owns the loading
copy now.

## Deferred

The Electron startup splash still uses its generated SMIL twinkle. It is a
separate app surface under `style-src 'self'`, and matching it needs the
pixel-loader generator plus the Electron locale; it is intentionally outside
this change.

## Alternatives considered

**`WavyText` (per-character sine).** Rejected after review: it spent a
per-character DOM and a constant wave on one static sentence, and the wave
fought the sweep for attention instead of telling the user something.

**Framer Motion / GSAP / react-spring.** Rejected: the repository has no motion
runtime, the swap is one keyframe pair on two lines, and a dependency would add
a bundle, a provider, and a second reduced-motion policy. The CSS keyframes also
compose with the existing `--a-*` motion tokens and the transcript's own
`surf-up` without a bridge.

**A pure-CSS stacked cycle (one infinite keyframe per line).** Rejected: the
visible window would be baked into each line's keyframe, the list length and
hold time would be duplicated in CSS, and a locale change would need a new
animation per line. React timers keep one source of truth for an ordered,
localized list.

**Curtain in `ConversationRoot` over `.body`.** Rejected: `.body` also owns the
composer seat, so the curtain would cover the input card that the settling
rule deliberately keeps live for a non-blank Session. `.viewArea` is the
transcript box and the right boundary.

## Consequences

The history round-trip, the app boot, and the VS Code cover now share the flat
sweep, the 26/32 wt500 wordmark, and the thirty-line rotating stack copy, and
every literal status stays on an accessible label. The bought side: per-host
locale ownership duplicates the tip copy (the pre-locale boot page carries its
English array; the conversation and vscode namespaces carry their own
dictionaries), so each deck change is a three-file edit; a fast open shows
nothing at all, and the rotating lines are not announced (by design). `SurfText`
stays reusable wherever an ordered list of short lines should swap in place.

## Testing

- `pnpm exec vitest run packages/client/web/tests/boot-page.client.spec.ts packages/client/ui-conversation/tests/history-curtain.client.spec.tsx packages/client/ui-conversation/tests/skeleton.client.spec.tsx packages/client/ui-vscode/tests/vscode-twin.client.spec.tsx` — 43 tests pass; the boot deck wraps after thirty lines, the curtain carries the wordmark and rotates through `session.surf.29`, and the twin keeps its `boot.tip.0` line.
- `pnpm run typecheck:contracts-ready` — the typed conversation and vscode dictionaries accept all thirty keys in both locales, and the curtain/twin key arrays resolve to the same set.
- A deck cross-check reads `BOOT_TIPS`, `session.surf.*`, and `boot.tip.*`: all three surfaces carry the same 30 bare lines, and each key set runs 0..29 without a gap.
- `pnpm exec tsx scripts/verify-client-ui-i18n.ts` still reports the pre-existing hard-coded strings in other client files (including the twin's wordmark and iframe title); the new curtain wordmark goes through `hero.headline`, and the new tip copy lives only in the dictionaries.
