#!/usr/bin/env bash
# stage-resources.sh - assemble src-tauri/bundle-resources/ for a self-contained
# AgentNet.app. Idempotent: safe to re-run; it refreshes the staged dists every
# time and only re-downloads node when the staged copy is missing.
#
# Layout produced (mirrors what the server expects relative to itself -
# dist/index.js resolves the webview at ../../webview/dist):
#
#   src-tauri/bundle-resources/
#     nodebin/node                      portable node binary (official nodejs.org build)
#     surfaces/localhost/dist/**        built localhost server (byte-for-byte copy)
#     surfaces/webview/dist/**          built webview SPA (byte-for-byte copy)
#
# Prereqs: the localhost + webview dists must already be built
# (pnpm --filter agentnet-localhost build / --filter agentnet-webview build).
#
# NODE_VERSION can be overridden: NODE_VERSION=v22.18.0 ./stage-resources.sh
set -euo pipefail

DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SURFACES_DIR="$(cd "$DESKTOP_DIR/.." && pwd)"
RES_DIR="$DESKTOP_DIR/src-tauri/bundle-resources"

NODE_VERSION="${NODE_VERSION:-}"
case "$(uname -m)" in
  arm64)  NODE_ARCH="darwin-arm64" ;;
  x86_64) NODE_ARCH="darwin-x64" ;;
  *) echo "unsupported arch $(uname -m); set NODE_ARCH manually" >&2; exit 1 ;;
esac

# --- 1. sanity: the built artifacts must exist -------------------------------
LOCALHOST_DIST="$SURFACES_DIR/localhost/dist"
WEBVIEW_DIST="$SURFACES_DIR/webview/dist"
[ -f "$LOCALHOST_DIST/index.js" ] || { echo "missing $LOCALHOST_DIST/index.js - build the localhost surface first" >&2; exit 1; }
[ -f "$WEBVIEW_DIST/index.html" ] || { echo "missing $WEBVIEW_DIST/index.html - build the webview first" >&2; exit 1; }

mkdir -p "$RES_DIR/nodebin"

# --- 2. portable node (official nodejs.org tarball, NOT homebrew) ------------
if [ ! -x "$RES_DIR/nodebin/node" ]; then
  if [ -z "$NODE_VERSION" ]; then
    # resolve latest v22.x
    NODE_VERSION="$(curl -fsSL https://nodejs.org/dist/latest-v22.x/ \
      | grep -oE "node-v22\.[0-9]+\.[0-9]+-$NODE_ARCH\.tar\.gz" | head -1 \
      | sed -E 's/node-(v22\.[0-9]+\.[0-9]+).*/\1/')"
    [ -n "$NODE_VERSION" ] || { echo "could not resolve latest v22.x node version" >&2; exit 1; }
  fi
  TARBALL="node-$NODE_VERSION-$NODE_ARCH.tar.gz"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  echo "downloading $TARBALL from nodejs.org ..."
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/$TARBALL" -o "$TMP/$TARBALL"
  tar -xzf "$TMP/$TARBALL" -C "$TMP" "node-$NODE_VERSION-$NODE_ARCH/bin/node"
  install -m 755 "$TMP/node-$NODE_VERSION-$NODE_ARCH/bin/node" "$RES_DIR/nodebin/node"
  echo "staged node $NODE_VERSION -> $RES_DIR/nodebin/node"
else
  echo "node already staged at $RES_DIR/nodebin/node ($("$RES_DIR/nodebin/node" --version)) - keeping it"
fi

# portability check: only /usr/lib + /System frameworks may be linked
BAD_LINKS="$(otool -L "$RES_DIR/nodebin/node" | tail -n +2 | awk '{print $1}' \
  | grep -vE '^(/usr/lib/|/System/)' || true)"
if [ -n "$BAD_LINKS" ]; then
  echo "staged node links non-system dylibs - NOT portable:" >&2
  echo "$BAD_LINKS" >&2
  exit 1
fi
echo "node dylib check OK (only /usr/lib + /System)"

# --- 3. server + webview dists (byte-for-byte, layout preserved) -------------
mkdir -p "$RES_DIR/surfaces/localhost" "$RES_DIR/surfaces/webview"
rsync -a --delete "$LOCALHOST_DIST/" "$RES_DIR/surfaces/localhost/dist/"
rsync -a --delete "$WEBVIEW_DIST/"   "$RES_DIR/surfaces/webview/dist/"
echo "staged localhost dist ($(find "$RES_DIR/surfaces/localhost/dist" -type f | wc -l | tr -d ' ') files)"
echo "staged webview dist ($(find "$RES_DIR/surfaces/webview/dist" -type f | wc -l | tr -d ' ') files)"

echo "done: $RES_DIR"
