#!/bin/sh
# Build the self-contained AgentNet.app: stage the portable node + her built
# server/webview into bundle-resources, then tauri-build with the operator's
# home dir remapped out of embedded rustc path metadata (no username leaks).
set -e
cd "$(dirname "$0")"
./stage-resources.sh
RUSTFLAGS="--remap-path-prefix=$HOME=~" npx --yes @tauri-apps/cli@^2 build
echo "app: $(pwd)/src-tauri/target/release/bundle/macos/AgentNet.app"
