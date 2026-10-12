#!/usr/bin/env bash
# Build the VS Code twin from source and cache it for `pnpm dsh web`.
#
# The twin lives in the dsh fork of the OpenVSCode Server. One checkout is
# kept inside the harness cache and rebuilt in place; the output of the
# host's `vscode-reh-web-<platform>-<arch>` gulp lane (linux-x64/arm64,
# darwin-x64/arm64 — Windows hosts run inside WSL2 as linux-x64) is swapped
# atomically into the machine-wide cache slot that findTwinDist
# (@deepseek-ai/dsh-api-ide) discovers last:
#
#   $DSH_HOME/cache/vscode-twin/
#     src/   fork checkout, kept (and git-fetch-refreshed) between runs
#     logs/  per-step build logs (npm-ci.log, compile.log, gulp.log)
#     dist/  the discovered slot — default ~/.dsh/cache/vscode-twin/dist
#
# Agent note
# .agents/notes/implemented/process/2026-10-12-vscode-twin-source-build-cache.md
# records why a prebuilt artifact is deliberately not fetched here.
#
# Machine prerequisites (checked up front with named errors): git, node
# 24.18.0+ (nvm's 24.18.0 is selected automatically when installed), a C/C++
# toolchain (gcc/g++ on Linux, Xcode CLT clang on macOS), make, python3,
# libkrb5 headers on Linux, and ~15GB free at the cache root. Transient
# network steps (clone, fetch, npm ci, compile, gulp) retry
# RETRY_LIMIT times before failing (default 3; set RETRY_LIMIT to change).
#
# Server-web posture: desktop-only natives never compile here. After every
# checkout the root package.json allowScripts junk flips them to false
# (native-keymap, native-is-elevated — electron-main-only upstream,
# verified by grep before this was wired; Playwright's chromium download),
# ELECTRON_SKIP_BINARY_DOWNLOAD empties the desktop runtime fetch, and
# `dsnSource` keeps their types for `npm run compile` untouched. More is
# never stripped: everything the REH server actually loads (node-pty,
# spdlog, sqlite3, kerberos, ripgrep, watchdog) still builds normally.
#
# Usage: scripts/bootstrap-vscode-twin.sh [--clean] [--force]
#   --clean  delete src/ and logs/ and re-clone from scratch
#   --force  rebuild even when dist/ already carries the wanted commit
# Env overrides: DSH_VSCODE_TWIN_{REPO,REF,HOME,LANE} replace the fork URL,
# the ref (branch tip or commit sha), the cache root, and the gulp lane name.
set -euo pipefail

REPO="${DSH_VSCODE_TWIN_REPO:-git@github.com:sebnguyen/openvscode-server.git}"
REF="${DSH_VSCODE_TWIN_REF:-dsh-build}"
WANT_NODE="24.18.0"
WANT_DISK_KB=$((15 * 1024 * 1024))

UNAME_S=$(uname -s)
UNAME_M=$(uname -m)
case "$UNAME_S" in
  Linux) PLATFORM=linux ;;
  Darwin) PLATFORM=darwin ;;
  CYGWIN*|MINGW*|MSYS*)
    echo "error: Windows is not supported directly; run inside WSL2 (the lane is linux-x64 there)" >&2
    exit 1
    ;;
  *) echo "error: unsupported host OS: $UNAME_S" >&2; exit 1 ;;
esac
case "$UNAME_M" in
  x86_64|amd64) ARCH=x64 ;;
  arm64|aarch64) ARCH=arm64 ;;
  *) echo "error: unsupported host architecture: $UNAME_M" >&2; exit 1 ;;
esac
LANE="${DSH_VSCODE_TWIN_LANE:-vscode-reh-web-$PLATFORM-$ARCH}"

dsh_home="${DSH_HOME:-$HOME/.dsh}"
if [[ -z "${dsh_home//[[:space:]]/}" ]]; then dsh_home="$HOME/.dsh"; fi
BASE="${DSH_VSCODE_TWIN_HOME:-$dsh_home/cache/vscode-twin}"
SRC="$BASE/src"
DIST="$BASE/dist"
LANE_OUT="$BASE/$LANE"
LOGS="$BASE/logs"
MARKER="$DIST/.dsh-source.json"

CLEAN=0
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --clean) CLEAN=1 ;;
    --force) FORCE=1 ;;
    -h|--help) sed -n '2,31p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "error: unknown argument '$arg' (try --clean, --force)" >&2; exit 2 ;;
  esac
done

log() { printf '[vscode-twin] %s\n' "$*"; }
die() { echo "error: $*" >&2; exit 1; }

# Retry transient-failure steps (npm/gyp/gulp network fetches) a few times.
retry() {
  local limit=$(( ${RETRY_LIMIT:-3} - 1 )) i rc
  for ((i = 1; i <= limit; i += 1)); do
    "$@" && return 0
    rc=$?
    log "retry $i/$limit in 15s — $*"
    sleep 15
  done
  return $rc
}

# node 24.18.0 via nvm when installed (the lane pins it); otherwise require
# whatever `node` resolves to be new enough. pnpm-run parents export
# NVM_DIR, which must not count as "nvm loaded": source when the function
# itself is still missing.
if ! command -v nvm >/dev/null 2>&1 && [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh"
fi
if command -v nvm >/dev/null 2>&1 && nvm ls "$WANT_NODE" 2>/dev/null | grep -q "$WANT_NODE"; then
  nvm use "$WANT_NODE" >/dev/null
fi

missing=()
case "$PLATFORM" in
  linux) needed=(git node gcc g++ make python3) ;;
  darwin) needed=(git node clang++ make python3) ;;
esac
for tool in "${needed[@]}"; do
  command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
done
# Linux native deps (native-keymap's gyp): pkg-config metadata for X11/XKBFile.
((${#missing[@]} == 0)) || die "missing build tools: ${missing[*]}"
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>24||(a===24&&b>=18)?0:1)' \
  || die "node $(node -p process.versions.node) found; the twin lane pins $WANT_NODE+"
if [[ $PLATFORM == linux ]] \
  && ! { pkg-config --exists mit-krb5 2>/dev/null || ls /usr/include/krb5/krb5.h >/dev/null 2>&1 || ls /usr/include/*/krb5/krb5.h >/dev/null 2>&1; }; then
  die "libkrb5 headers not found (apt install libkrb5-dev / dnf install krb5-devel)"
fi

mkdir -p "$BASE" "$LOGS"
avail_kb=$(df -kP "$BASE" | awk 'NR==2 {print $4}')
[[ "$avail_kb" =~ ^[0-9]+$ ]] || die "cannot read free space at $BASE"
(( avail_kb >= WANT_DISK_KB )) || die "only $((avail_kb/1024/1024))GB free under $BASE; the source build wants ~15GB"

(( CLEAN )) && rm -rf "$SRC" "$LOGS" && mkdir -p "$LOGS"

# --- source tree ----------------------------------------------------------
if [[ ! -d "$SRC/.git" ]]; then
  clone_src() {
    local attempt
    for attempt in 1 2 3; do
      git clone --filter=blob:none --no-checkout "$REPO" "$SRC" && return 0
      rm -rf "$SRC"
      log "clone attempt $attempt failed; retry in 15s"
      sleep 15
    done
    die "git clone $REPO failed repeatedly"
  }
  log "clone $REPO → $SRC (blobless, then fetch $REF)"
  clone_src
fi
git -C "$SRC" remote set-url origin "$REPO"
log "fetch $REF from $REPO"
retry git -C "$SRC" fetch --filter=blob:none origin "$REF" || die "git fetch failed repeatedly"
git -C "$SRC" checkout -- package.json || true
git -C "$SRC" checkout --detach FETCH_HEAD
COMMIT=$(git -C "$SRC" rev-parse HEAD)
log "building $COMMIT (${REPO##*/} @$REF, lane $LANE)"

# --- server-web strip: desktop natives never compile ------------------------
log "strip desktop natives from allowScripts (native-keymap, native-is-elevated, browser-chromium)"
node - "$SRC/package.json" <<'EOF'
const path = process.argv[2]
const pkg = require(path)
const STRIP_PREFIXES = ['native-keymap@', 'native-is-elevated@', '@playwright/browser-chromium@']
let flipped = 0
for (const name of Object.keys(pkg.allowScripts ?? {})) {
  if (STRIP_PREFIXES.some((p) => name.startsWith(p))) {
    pkg.allowScripts[name] = false
    flipped += 1
  }
}
require('node:fs').writeFileSync(path, JSON.stringify(pkg, null, '\t') + '\n')
console.log(`allowScripts ${flipped} entries disabled`)
EOF

# Skip when dist already carries exactly this commit.
if (( ! FORCE )) && [[ -x "$DIST/bin/code-server-oss" && -f "$MARKER" ]] && grep -q "\"commit\": \"$COMMIT\"" "$MARKER"; then
  log "dist/ already carries $COMMIT — nothing to do (use --force to rebuild)"
  log "dist: $DIST"
  exit 0
fi

cd "$SRC"
if [[ $PLATFORM == linux ]]; then export CC=gcc CXX=g++; fi
export npm_config_devdir="$SRC/.node-gyp-cache"
export npm_config_fetch_retries=5 npm_config_fetch_retry_mintimeout=8000 npm_config_fetch_retry_maxtimeout=90000
# Desktop runtime binaries are download-cost without paying for the server-web twin.
export ELECTRON_SKIP_BINARY_DOWNLOAD=1

# --- dependencies ---------------------------------------------------------
log "npm ci (log: $LOGS/npm-ci.log)"
retry npm ci --cache "$SRC/.npm-cache" --no-audit --no-fund \
  >>"$LOGS/npm-ci.log" 2>&1 \
  || { tail -20 "$LOGS/npm-ci.log" >&2; die "npm ci failed — see $LOGS/npm-ci.log"; }
if [[ ! -d build/node_modules || ! -d extensions/node_modules || ! -d remote/node_modules ]]; then
  log "postinstall subdirs missing; rerunning build/npm/postinstall.js"
  retry node build/npm/postinstall.js >>"$LOGS/npm-ci.log" 2>&1 \
    || { tail -20 "$LOGS/npm-ci.log" >&2; die "subdir postinstall failed — see $LOGS/npm-ci.log"; }
fi

# --- build ----------------------------------------------------------------
log "npm run compile (log: $LOGS/compile.log)"
retry npm run compile >>"$LOGS/compile.log" 2>&1 \
  || { tail -20 "$LOGS/compile.log" >&2; die "npm run compile failed — see $LOGS/compile.log"; }

rm -rf "$LANE_OUT"
log "gulp $LANE (log: $LOGS/gulp.log)"
retry node --experimental-strip-types --max-old-space-size=8192 \
  ./node_modules/gulp/bin/gulp.js "$LANE" >>"$LOGS/gulp.log" 2>&1 \
  || { tail -20 "$LOGS/gulp.log" >&2; die "gulp lane failed — see $LOGS/gulp.log"; }

[[ -x "$LANE_OUT/bin/code-server-oss" ]] || die "lane produced no bin/code-server-oss"
[[ -f "$LANE_OUT/out/vs/code/browser/workbench/workbench.js" ]] \
  || die "lane produced no out/vs/code/browser/workbench/workbench.js (rebuild)"

# --- cache swap ------------------------------------------------------------
tmp="$BASE/dist.new"; prev="$BASE/dist.old"
rm -rf "$tmp" "$prev"
mv "$LANE_OUT" "$tmp"
[[ -d "$DIST" ]] && mv "$DIST" "$prev"
mv "$tmp" "$DIST"
rm -rf "$prev"

cat >"$MARKER" <<EOF
{
  "repo": "$REPO",
  "ref": "$REF",
  "commit": "$COMMIT",
  "lane": "$LANE",
  "host": "$PLATFORM-$ARCH",
  "builtAt": "$(date -u +%FT%TZ)"
}
EOF

log "twin cached: $DIST (commit $COMMIT)"
log "pnpm dsh web discovers this slot automatically — no restart or var needed"
