# Agent Note: Web boot waits for Host data; the hero is the plain product headline

Status: implemented

## Problem

The boot kernel handed the mount point to the UI renderer the moment React mounted, so the boot overlay flipped while the Workspace and Session baselines were still in flight and the first paint was an empty sidebar and hero. Separately, the hero carried the DeepSeek fish — a second brand surface beside the sidebar's DigitalOcean mark and wordmark.

## Decision

The boot kernel hands the mount point to the UI renderer only after `awaitDataReady` observes the Connection `state` source at `connected` and both the Workspace (`ctx.workspaces.list`) and Session (`ctx.sessions.list`) snapshot sources at `phase: 'ready'`. Baseline pulls start at plugin activation (`control.start()` in the Session controller client, the Workspace follow stream at apply), so awaiting their arrival before mount cannot stall the pulls themselves. Services absent from a composed boot graph are skipped, and a fixed 15 s timeout releases a Host that never delivers, handing the shell's own empty and error states the screen instead of holding the boot page forever. Future boot-stage work extends the gate's source list in `src/data-ready.ts` rather than adding readiness flags to feature packages.

Kind: feature. Packages: `dsh-client-web`, `dsh-client-ui-conversation`, `dsh-client-ui-brand-official`.

The blank-session hero renders the locale-owned product headline (`hero.headline`, `DigitalOcean Harness` in both locales) with its preview badge and no mark. The DeepSeek fish, its hover swim morph, and the `conversation.hero.brand.mark` slot are deleted end to end: SlotMap row, runtime declaration, owner props, generated catalog entry, docs hierarchy, and the official brand package's hero exemption. The sidebar keeps the DigitalOcean mark as the sole brand surface, and any brand reintroduction goes through the sidebar slots, not the hero. The same sweep removes the DeepSeek identity from every web app logo surface: favicon, manifest, and document title carry the DigitalOcean mark and name, and the `official` build profile — previously the fish sidebar mark, the DeepSeek wordmark artwork, and a baked `DSH_CLIENT_TITLE` of 'DeepSeek Harness' — now registers `DigitalOceanLogo` at `sidebar.brand.mark` and bakes 'DigitalOcean Harness'. `FishLogo` and `BrandWordmark` leave `dsh-client-ui-primitives` with their benches; the sidebar name is the shell's localized product label in every profile. Because the wordmark equals the hero headline text, e2e suites address the headline inside `div[data-phase="hero"]` rather than page-wide text queries.

## Alternatives considered

**Flip the overlay at activation.** The first behavior: the renderer mounted as soon as React was up. It lost because mounting precedes the baselines, so the first paint was an empty chrome reading as a crash.

**Per-feature readiness flags.** Feature packages could each export a ready signal the boot kernel awaits. It lost to one gate source list in `src/data-ready.ts`: readiness knowledge stays with the kernel, and a new baseline source is one line there instead of a protocol across feature packages.

**Skeleton hero while data is in flight.** A blurred fish-and-headline placeholder could have masked the wait. It lost with the debrand: the hero's only job is the product headline, and the sidebar carries the brand.

**Unbounded wait for a silent Host.** It lost because a Host that never delivers would pin the boot page forever; the fixed 15 s timeout hands the screen to the shell's own empty and error states.

## Consequences

The first paint the user sees is a populated shell, and a non-delivering Host degrades to the shell's empty/error states instead of an eternal boot page — bought at a bounded longer boot page on slow Hosts (up to the 15 s release) and a single extension point: new baseline sources must be added to `src/data-ready.ts` or they will mount under a still-empty shell list. The brand surface is exactly one — the sidebar mark and the localized product label; the hero slot, the fish, its morph, the wordmark artwork, and every DeepSeek title constant are gone from runtime, catalog, and docs, and e2e now targets `div[data-phase="hero"]` deterministically because the sidebar label and the hero headline are the same string. Running-activity indicators use the same DigitalOcean pixel loader as the boot page: `StateDot` itself renders the pixel sweep for the `ongoing` state behind a `data-state="ongoing"` wrapper, so every live-activity surface — sidebar session rows, the activity dock, subagent lineage, present rows, plugin inventory, terminal exits — shows the DigitalOcean loader; in-progress todos and running tool, bash, command, and reasoning rows lead with it instead of the shimmer sweep, and the chat turn spinner keeps it. The generic pixel-chase ring left with the sweep, along with the dead composer pending-dot rule.
