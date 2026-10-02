# Agent Note: English-only documentation tree

Status: implemented

## Problem

Documentation churn doubles when every page, README, and Agent Note must be kept in lockstep with a translated counterpart, and a gate that enforces language correspondence spends CI on prose synchronization instead of correctness. The documentation tree serves contributors and operators who read the repository's working language; product UI copy is a different artifact with a different consumer.

## Decision

The documentation tree — `docs/`, package READMEs, and Agent Notes — is authored and gated in English only. There is no translated counterpart tree, no per-document language metadata, and no gate that pairs one document with another by language. Every documentation gate (`verify-md-links`, `verify-md-wrap`, `doc-typecheck`, `verify-type-equiv`, the doc-standard and budget gates, the VitePress projection) consumes the single English tree. Product UI copy localization stays separate and unaffected: it lives in typed dictionaries under `packages/client/locale`, is governed by `verify-client-ui-i18n` and the locale dictionary parity check, and follows [the locale-owned client UI copy decision](../architecture/2026-08-23-locale-owned-client-ui-copy.md).

## Alternatives considered

**Keep a translated documentation tree with a parity gate.** Lost: every documentation edit required a synchronized counterpart before merge, and stale translations failed a gate that said nothing about the English prose's correctness.

**Translate on release instead of per commit.** Lost: an unreviewed projection of reviewed prose drifts from the source of truth, and release tooling would own editorial judgment it cannot exercise.

## Consequences

Documentation edits carry one file's worth of review and one tree's worth of gates; the website projects the English sources with a single route tree. The cost is deliberate: readers who need another language consume the English documentation or an external translation the repository does not track. Product string dictionaries remain the one localized surface, so UI copy governance must never be mistaken for documentation translation.
