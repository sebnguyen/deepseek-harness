# Agent Note: Explore toolFilter names the lane's tool spellings

Status: implemented

## Problem

Every `explore` delegation in a live session failed at spawn with `tools.restrict() names unknown global tools "read", "bash"`. The `standard` and `wind-up-wind-down` presets configured the explorer's `toolFilter.allow` with both the legacy (`read`, `bash`) and batch (`multi_read`, `multi_bash`) spellings, on the assumption that unmounted names resolve harmlessly. The scoped restriction's contract (`packages/core/tools/src/index.ts`) is the opposite: unknown names, empty filters, scope-local names, and reserved transport names all fail loud. Live sessions register only the `multi_*` batch faces — `tool-bash`'s `legacyName` and tool-fs's `legacyFaces` mount the legacy spellings solely under `VITEST === 'true'` for recorded-corpus replay — so live child spawn died before the explorer's first step. Test-lane boots masked the defect: there the same list fails on the `multi_*` half, but no coverage exercised explorer delegation there either.

## Decision

The allow list names exactly the spellings the lane mounts, through the same `!!js` interpolation the presets already use for `legacyName: !!js process.env.VITEST === 'true'` (`vendor/loader` evaluates `!!js` anywhere inside an entry's `config`). Both presets' `toolFilter.allow` is `!!js` concatenating the lane-invariant names with `[read, bash]` under VITEST and `[multi_read, multi_bash]` live, so the restriction resolves in every deployment. The explorer's own confinement surface (schema, depth, step budget, sandbox mode) is unchanged. The staged-escalation plugin keeps both spellings in its stage ladder: it gates by tool name on `tools/pre-execute`, never calls `restrict()`, and names the recorded corpus's replay-visible faces, so unknown names there are inert by design.

## Alternatives considered

- **Soften `tools.restrict()` to skip unknown allow entries.** Rejected: the fail-loud contract is deliberate (misconfiguration fails at the earliest resolvable point) and an existing test pins unknown-name rejection; one preset's convenience does not justify losing typo detection for every scoped restriction.
- **Register both spellings in test lane and name only `multi_*` in the lists.** Rejected for this fix: test-lane boot time and tool catalog contents change, and snapshot/expected-output surfaces keyed to the registered set would churn, while the defect is the static list's false assumption.
- **Fix in the cordis patch or staged-escalation plugin.** Disqualified: `packages/bundle/base/cordis.patch.yml` defines no `explore` row, and the escalation gate never calls `restrict()`.

## Consequences

Explorer children boot in live sessions again; the `explore` tool regains its read-only catalog in both lanes. The presets' comment blocks now state the lane rule next to the list so the assumption cannot silently return. The recorded corpus still needs its legacy spellings until re-recorded; when `legacyName`/`legacyFaces` retire, these two entries retire with them and the lists become plain literals.
