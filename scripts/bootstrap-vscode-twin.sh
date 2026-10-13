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
#   $DSH_HOME/cache/vscode-source/<repo>/  fork checkout — cloned by
#     `pnpm install` (postinstall, --fetch-only) and refreshed when the
#     root `postbuild` hook runs this script after `pnpm run build`
#   $DSH_HOME/cache/vscode-source/<lane>/  gulp lane output (sibling of the
#     fork checkout — same layout as ../vscode-reh-web-* beside a dev clone)
#   $DSH_HOME/cache/vscode-twin/
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
# Server-web posture: the fork's root .npmrc has no Electron target and
# root allowScripts is false, so npm ci does not node-gyp the desktop tree.
# This script still forces those root entries false (and remote deviceid)
# without rewriting the rest of the file. ELECTRON_SKIP_BINARY_DOWNLOAD
# empties the desktop runtime fetch. The REH server loads remote/node_modules
# (node-pty, spdlog, sqlite3, kerberos, ripgrep, watchdog, fs-copyfile,
# policy-watcher), and that tree still builds. npm ci runs only when the
# lockfiles, npmrc files, or Node version differ from
# $DSH_HOME/cache/vscode-twin/install-stamp; out/ is left in place so
# `npm run compile` is incremental.
#
# Usage: scripts/bootstrap-vscode-twin.sh [--clean] [--force] [--fetch-only]
#   --clean       delete the source checkout and logs/ and re-clone
#   --force       rebuild even when dist/ already carries the wanted commit
#   --fetch-only  clone/refresh the source checkout only, no build — the
#                 mode `pnpm install`'s postinstall runs; skips the
#                 build-only prerequisites (toolchain, node pin, 15GB disk)
# Env overrides: DSH_VSCODE_TWIN_{REPO,REF,HOME,LANE} replace the fork URL,
# the ref (branch tip or commit sha), the dist/logs cache root, and the gulp
# lane name; DSH_VSCODE_SOURCE_DIR relocates the source checkout root.
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
REPO_NAME="${REPO##*/}"
REPO_NAME="${REPO_NAME%.git}"
SRC="${DSH_VSCODE_SOURCE_DIR:-$dsh_home/cache/vscode-source/$REPO_NAME}"
DIST="$BASE/dist"
# Gulp writes the lane beside the fork checkout (../<lane> from repo root).
LANE_OUT="$(dirname "$SRC")/$LANE"
LOGS="$BASE/logs"
MARKER="$DIST/.dsh-source.json"

CLEAN=0
FORCE=0
FETCH_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --clean) CLEAN=1 ;;
    --force) FORCE=1 ;;
    --fetch-only) FETCH_ONLY=1 ;;
    -h|--help) sed -n '2,51p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "error: unknown argument '$arg' (try --clean, --force, --fetch-only)" >&2; exit 2 ;;
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

# Fetch needs only git + node (the strip step runs a node one-liner); the
# toolchain, node-pin, krb5, and disk gates bind builds only, so install-time
# fetch works on machines that never compile the twin.
missing=()
case "$PLATFORM" in
  linux) needed=(git node gcc g++ make python3) ;;
  darwin) needed=(git node clang++ make python3) ;;
esac
for tool in "${needed[@]}"; do
  command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
done
((${#missing[@]} == 0)) || die "missing tools: ${missing[*]}"
if (( ! FETCH_ONLY )); then
  # Linux native deps (native-keymap's gyp): pkg-config metadata for X11/XKBFile.
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
fi
mkdir -p "$(dirname "$SRC")"

(( CLEAN )) && rm -rf "$SRC" "$LOGS" && mkdir -p "$(dirname "$SRC")"

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
git -C "$SRC" checkout -- package.json remote/package.json || true
git -C "$SRC" checkout --detach FETCH_HEAD
COMMIT=$(git -C "$SRC" rev-parse HEAD)
log "$COMMIT ready (${REPO##*/} @$REF, lane $LANE)"

# Materialize whatever the fork checks out as submodules (today: none; the
# twin lane must still self-heal when the fork grows one, so pnpm install's
# postinstall fetch-only run and the root postbuild run arrive at the same
# fully-populated tree either way). `--init` is idempotent and never fetches
# beyond the superproject's pinned commits.
retry git -C "$SRC" submodule update --init || die "git submodule update --init failed repeatedly"

# --- server-web strip: root natives never compile ---------------------------
# Root allowScripts is already false on dsh-build. Rewrite only the matching
# booleans so a checkout that still has them true is stripped without
# reformatting package.json (a full JSON.stringify dirties the tree and
# busts the install stamp).
log "strip root native allowScripts (remote deviceid too)"
node - "$SRC" <<'EOF'
const fs = require('node:fs')
const path = require('node:path')
const SRC = process.argv[2]
const TARGETS = [
  ['package.json', () => true],
  ['remote/package.json', (name) => name.startsWith('@vscode/deviceid@')],
]
for (const [rel, match] of TARGETS) {
  const file = path.join(SRC, rel)
  if (!fs.existsSync(file)) continue
  const original = fs.readFileSync(file, 'utf8')
  const keyAt = original.indexOf('"allowScripts"')
  if (keyAt < 0) continue
  const brace = original.indexOf('{', keyAt)
  let depth = 0
  let end = -1
  for (let i = brace; i < original.length; i += 1) {
    if (original[i] === '{') depth += 1
    else if (original[i] === '}') {
      depth -= 1
      if (depth === 0) { end = i; break }
    }
  }
  if (end < 0) continue
  let flipped = 0
  const block = original.slice(brace, end + 1).replace(/"([^"]+)"(\s*:\s*)true/g, (entry, name, sep) => {
    if (!match(name)) return entry
    flipped += 1
    return `"${name}"${sep}false`
  })
  if (flipped === 0) {
    console.log(`${rel}: allowScripts already off`)
    continue
  }
  fs.writeFileSync(file, original.slice(0, brace) + block + original.slice(end + 1))
  console.log(`${rel}: allowScripts ${flipped} entries disabled`)
}
EOF

if (( FETCH_ONLY )); then
  log "source cached: $SRC ($COMMIT)"
  exit 0
fi

# Skip when dist already carries exactly this commit.
if (( ! FORCE )) && [[ -x "$DIST/bin/code-server-oss" && -f "$MARKER" ]] && grep -q "\"commit\": \"$COMMIT\"" "$MARKER"; then
  log "dist/ already carries $COMMIT — nothing to do (use --force to rebuild)"
  log "dist: $DIST"
  exit 0
fi

cd "$SRC"
if [[ $PLATFORM == linux ]]; then
  export CC=gcc CXX=g++
  # postinstall.ts clears CC/CXX for remote/ unless these are set. Without
  # them, make uses its built-in CXX (g++-11 on this image), which is absent;
  # @parcel/watcher then fails while compiling the server native.
  export VSCODE_REMOTE_CC=gcc VSCODE_REMOTE_CXX=g++
fi
export npm_config_devdir="$SRC/.node-gyp-cache"
export npm_config_fetch_retries=5 npm_config_fetch_retry_mintimeout=8000 npm_config_fetch_retry_maxtimeout=90000
# gyp races: parallel npm-ci lifecycle rebuilds of the repo's many native
# modules share one npm_config_devdir and intermittently crash node-gyp
# (ENOENT lstat build/node_gyp_bins). Serial installs avoid the class;
# the env var reaches the subdir npm ci processes postinstall.ts spawns too.
export npm_config_foreground_scripts=true
# Desktop runtime binaries are download-cost without paying for the server-web twin.
export ELECTRON_SKIP_BINARY_DOWNLOAD=1

# --- dependencies ---------------------------------------------------------
# Hash the lockfiles, npmrc files, and Node version. A match plus the four
# node_modules trees means npm ci would only delete and rebuild what is
# already installed; compile below still sees out/ and is incremental.
INSTALL_STAMP="$BASE/install-stamp"
INSTALL_HASH="$(node - "$SRC" <<'EOF'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const src = process.argv[2]
const files = [
  'package.json', 'package-lock.json', '.npmrc', '.nvmrc',
  'remote/package.json', 'remote/package-lock.json', 'remote/.npmrc',
  'build/package.json', 'build/package-lock.json', 'build/.npmrc',
  'extensions/package.json', 'extensions/package-lock.json',
]
const hash = crypto.createHash('sha256')
hash.update(process.version + '\n')
for (const rel of files) {
  const file = path.join(src, rel)
  hash.update(rel + '\n')
  if (fs.existsSync(file)) hash.update(fs.readFileSync(file))
  hash.update('\n')
}
process.stdout.write(hash.digest('hex'))
EOF
)"
deps_ready=0
if [[ -d node_modules && -d build/node_modules && -d extensions/node_modules && -d remote/node_modules && -f "$INSTALL_STAMP" ]] \
  && [[ "$(<"$INSTALL_STAMP")" == "$INSTALL_HASH" ]]; then
  deps_ready=1
fi
if (( deps_ready )); then
  log "dependencies match lockfiles and node $(node -p process.versions.node) — skipping npm ci"
else
  log "npm ci (log: $LOGS/npm-ci.log)"
  retry npm ci --cache "$SRC/.npm-cache" --no-audit --no-fund \
    >>"$LOGS/npm-ci.log" 2>&1 \
    || { tail -20 "$LOGS/npm-ci.log" >&2; die "npm ci failed — see $LOGS/npm-ci.log"; }
  if [[ ! -d build/node_modules || ! -d extensions/node_modules || ! -d remote/node_modules ]]; then
    log "postinstall subdirs missing; rerunning build/npm/postinstall.js"
    retry node build/npm/postinstall.js >>"$LOGS/npm-ci.log" 2>&1 \
      || { tail -20 "$LOGS/npm-ci.log" >&2; die "subdir postinstall failed — see $LOGS/npm-ci.log"; }
  fi
  printf '%s\n' "$INSTALL_HASH" >"$INSTALL_STAMP"
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
log "pnpm run dev (pnpm dsh web) discovers this slot automatically — no restart or var needed"
