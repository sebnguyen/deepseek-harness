#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT"

pnpm exec tsc -b \
  packages/coral/coral \
  packages/coral/host-registry \
  packages/coral/host-discovery \
  packages/coral/transport-registry \
  packages/coral/transport-inproc \
  packages/coral/transport-stdio \
  packages/coral/transport-socket \
  packages/coral/client-standard-registry \
  packages/coral/client-registry \
  packages/coral/standard-acp \
  packages/coral/server-standard-registry \
  packages/coral/server-registry \
  packages/coral/cluster \
  >/dev/null

pnpm exec tsx packages/coral/coral/examples/multi-cluster-acp.ts
