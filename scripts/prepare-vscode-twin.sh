#!/usr/bin/env bash
# Stage the VS Code twin dist the harness mounts per session.
#
# The lane that both serves and runs the web workbench is
# vscode-reh-web-linux-x64 (esbuild target `server-web`): its out/ carries
# out/vs/code/browser/workbench/workbench.{js,css}, the bits a bare
# vscode-reh-linux-x64 (target `server`, headless) does not. Build with:
#
#   cd <vscode checkout> && node --experimental-strip-types \
#     --max-old-space-size=8192 ./node_modules/gulp/bin/gulp.js vscode-reh-web-linux-x64
#
# Default SRC is the sibling checkout and default DEST is the shared sibling
# slot, both overridable through the environment; @deepseek-ai/dsh-api-ide
# discovers the DEST slot automatically at boot (see packages/api/ide), so a
# plain `dsh web --no-open` mounts the tab once this script ran.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${DSH_VSCODE_TWIN_SRC:-$ROOT/../vscode-reh-web-linux-x64}"
DEST="${DSH_VSCODE_TWIN_STAGED:-$ROOT/../.vscode-twin/dist}"

[[ -x "$SRC/bin/code-server-oss" ]] || { echo "missing $SRC/bin/code-server-oss" >&2; exit 1; }
[[ -f "$SRC/out/vs/code/browser/workbench/workbench.js" ]] || {
  echo "missing $SRC/out/vs/code/browser/workbench/workbench.js (rebuild the lane)" >&2
  exit 1
}

rm -rf "$DEST"
cp -a "$SRC" "$DEST"
echo "Twin dist ready: $DEST"
echo "The ide roster row discovers this slot automatically; leave DSH_VSCODE_TWIN_DIST unset."
