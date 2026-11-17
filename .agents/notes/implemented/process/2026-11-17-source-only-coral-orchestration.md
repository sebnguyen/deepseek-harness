# Agent Note: Source-only Coral and Orchestration packages

Status: implemented

## Problem

Coral and the Orchestration projection need continued development without exposing unfinished behavior. The Web composition mounted Orchestration, the root Client build produced its artifacts, and the release family selected both packages. The npm baseline also packed workspace packages independently of the release family's private-package filter.

## Decision

The `packages/coral` group and `packages/client/ui-orchestration` are source-only packages. Their manifests are private, and a shared directory policy excludes them from tsdown, publication linting, and npm baseline discovery and packing. Workspace constraints recognize the same policy instead of requiring public release metadata.

The Web app composition has no Orchestration loader row or package dependency. The Client TypeScript aggregate excludes its project, source, and tests. Coral remains outside the Host TypeScript aggregate. The source trees and package-local development entry points remain in the workspace. The [single-root orchestration proposal](../../proposed/architecture/2026-10-31-single-root-agent-orchestration.md) retains the projection design without making it a shipped default.

## Alternatives considered

**Revert the Coral and Orchestration sources.** This removes working development code and tests instead of changing only their exposure.

**Disable only the Orchestration loader row.** This prevents runtime mounting but leaves root build artifacts, npm release membership, and baseline packing intact.

**Move both features under `packages/experimental`.** This mixes them with the public experimental exception policy and requires package and path renames. The source-only policy expresses their actual build and release status without moving the implementations.

## Consequences

`pnpm run build` produces no Coral or Orchestration artifacts, the default Web app does not mount Orchestration, and normal and baseline npm publication paths exclude all 15 packages. Publication linting spends no checks on packages that have no publication artifact. Developers can still run package-local builds and tests explicitly.
