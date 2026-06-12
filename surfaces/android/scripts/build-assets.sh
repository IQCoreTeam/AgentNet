#!/usr/bin/env bash
# Build the three Android assets the shell extracts on first run:
#   app/src/main/assets/proot-<abi>            Android-native proot binary
#   app/src/main/assets/loader-<abi>           proot's ELF loader helper
#   app/src/main/assets/rootfs-<abi>.tar       Ubuntu (glibc) rootfs with node +
#                                              official claude/codex + ripgrep + AGENTS.md
#   app/src/main/assets/agentnet-server.tar    our surfaces/localhost build output
#
# WHERE TO RUN THIS: the rootfs must be built FOR the target arch (aarch64). Easiest is
# to run the rootfs step ON an aarch64 Linux host (a CI arm64 runner, an arm64 VM/cloud
# box, or inside the target proot itself). On an x86 dev machine you can build everything
# except the in-rootfs `apt/install` steps, which need to run under the target arch — use
# `qemu-user-static` + binfmt, or an arm64 runner. The script detects and warns.
#
# This is a real, runnable script (was a stub before). It still depends on external
# downloads (proot binary, Ubuntu rootfs, the CLIs' installers), so a network + the
# right arch are required; it does NOT silently fake anything.

set -euo pipefail

ABI="${ABI:-arm64}"          # arm64 | x86_64
case "$ABI" in
  arm64)  PROOT_ARCH="aarch64"; UBUNTU_ARCH="arm64" ;;
  x86_64) PROOT_ARCH="x86_64"; UBUNTU_ARCH="amd64" ;;
  *) echo "unsupported ABI: $ABI (use arm64 or x86_64)" >&2; exit 1 ;;
esac

HERE="$(cd "$(dirname "$0")" && pwd)"
ANDROID_DIR="$(cd "$HERE/.." && pwd)"
REPO_ROOT="$(cd "$ANDROID_DIR/../.." && pwd)"
ASSETS="$ANDROID_DIR/app/src/main/assets"
WORK="${WORK:-$ANDROID_DIR/.assets-build}"
mkdir -p "$ASSETS" "$WORK"

echo "==> ABI=$ABI  proot=$PROOT_ARCH  ubuntu=$UBUNTU_ARCH"
echo "==> assets -> $ASSETS"
echo "==> work   -> $WORK"

# 1) proot binary + loader (Android-native, relocatable loader). green-green-avk has NO
#    GitHub releases — the prebuilt binaries are committed as tar.gz under /packages on
#    master (proot dyn-linked vs Bionic /system/bin/linker64 = present on every Android;
#    loader ships inside the SAME archive, found via the relative ../libexec path or the
#    PROOT_LOADER env we set in ServerManager). Pin a commit via PROOT_REF for repro CI.
PROOT_REF="${PROOT_REF:-master}"
PROOT_PKG="proot-android-$PROOT_ARCH.tar.gz"
PROOT_URL="https://raw.githubusercontent.com/green-green-avk/build-proot-android/$PROOT_REF/packages/$PROOT_PKG"
echo "==> [1/3] fetching proot ($PROOT_PKG @ $PROOT_REF)"
PROOT_STAGE="$WORK/proot"
rm -rf "$PROOT_STAGE"; mkdir -p "$PROOT_STAGE"
# --strip-components=1 drops the archive's leading "root/" so we get bin/ + libexec/.
curl -fsSL "$PROOT_URL" | tar -xz -C "$PROOT_STAGE" --strip-components=1
# Lay out under assets to match Paths.kt: proot at proot/bin/proot, loader at
# proot/libexec/proot/loader (ServerManager points PROOT_LOADER there).
rm -rf "$ASSETS/proot-$ABI"
mkdir -p "$ASSETS/proot-$ABI"
cp -R "$PROOT_STAGE/bin" "$PROOT_STAGE/libexec" "$ASSETS/proot-$ABI/"
chmod +x "$ASSETS/proot-$ABI/bin/proot" "$ASSETS/proot-$ABI/libexec/proot/loader"* 2>/dev/null || true

# 2) Ubuntu rootfs with the engine installed. We start from proot-distro's published
#    Ubuntu rootfs, unpack it, then install node + the OFFICIAL claude/codex CLIs +
#    ripgrep INSIDE it (so they're real glibc Linux binaries), and drop our guest
#    AGENTS.md at /root/. The in-rootfs steps run under the target arch (see header).
ROOTFS_DIR="$WORK/rootfs"
echo "==> [2/3] building rootfs at $ROOTFS_DIR"
if [ "$PROOT_ARCH" != "$(uname -m)" ] && [ -z "${ALLOW_CROSS:-}" ]; then
  echo "!! host arch $(uname -m) != target $PROOT_ARCH." >&2
  echo "!! The in-rootfs install steps need the target arch (qemu-user-static + binfmt," >&2
  echo "!! or run on an aarch64 runner). Re-run with ALLOW_CROSS=1 once that's set up." >&2
  exit 1
fi
rm -rf "$ROOTFS_DIR"; mkdir -p "$ROOTFS_DIR"
# proot-distro Ubuntu rootfs tarball (xz). Pin via PROOT_DISTRO_UBUNTU_URL if needed.
UBUNTU_URL="${PROOT_DISTRO_UBUNTU_URL:-https://github.com/termux/proot-distro/releases/latest/download/ubuntu-${UBUNTU_ARCH}-pd-v4.x.tar.xz}"
echo "    fetching ubuntu rootfs: $UBUNTU_URL"
curl -fSL "$UBUNTU_URL" -o "$WORK/ubuntu.tar.xz"
tar -xJf "$WORK/ubuntu.tar.xz" -C "$ROOTFS_DIR" --strip-components=0

# Run a setup script inside the rootfs via chroot (needs root/qemu) — installs the engine.
cat > "$ROOTFS_DIR/root/setup.sh" <<'SETUP'
#!/bin/sh
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y curl ca-certificates git ripgrep
# node (NodeSource LTS)
curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
apt-get install -y nodejs
# official CLIs — their normal installers (NOT the leaked forks)
npm install -g @anthropic-ai/claude-code @openai/codex
apt-get clean && rm -rf /var/lib/apt/lists/*
SETUP
chmod +x "$ROOTFS_DIR/root/setup.sh"
echo "    running in-rootfs setup (chroot; needs root or qemu binfmt)"
if command -v chroot >/dev/null && [ "$(id -u)" = "0" ]; then
  cp /etc/resolv.conf "$ROOTFS_DIR/etc/resolv.conf" 2>/dev/null || true
  chroot "$ROOTFS_DIR" /root/setup.sh
else
  echo "!! need root chroot (or a proot/qemu wrapper) to run setup.sh inside the rootfs." >&2
  echo "!! Run this script as root on an aarch64 host, or adapt to 'proot-distro login'." >&2
  exit 1
fi
rm -f "$ROOTFS_DIR/root/setup.sh"
# ship the agent environment guidance into the guest
cp "$ANDROID_DIR/guest/AGENTS.md" "$ROOTFS_DIR/root/AGENTS.md"
echo "    packing rootfs tar (plain tar; TarExtractor reads .tar)"
tar -cf "$ASSETS/rootfs-$ABI.tar" -C "$ROOTFS_DIR" .

# 3) The server bundle = the localhost node server AND the React webview build it
# serves. Both are arch-independent JS, so a host build is fine to reuse (CI builds them
# before entering the arm64 container, which has no pnpm). We pack them into one tar
# laid out as:  ./index.js (+ chunks)   and   ./webview/  (the SPA dist)
# The shell extracts this to /root/agentnet-server and runs node ./index.js with
# AGENTNET_WEBVIEW_DIR=/root/agentnet-server/webview (set in ServerManager).
echo "==> [3/3] packing agentnet-server bundle (localhost server + webview SPA)"
LH_DIST="$REPO_ROOT/surfaces/localhost/dist"
WV_DIST="$REPO_ROOT/surfaces/webview/dist"
if [ ! -f "$LH_DIST/index.js" ]; then
  echo "    localhost dist not found; building with pnpm"
  ( cd "$REPO_ROOT" && pnpm --filter agentnet-localhost build )
fi
if [ ! -f "$WV_DIST/index.html" ]; then
  echo "    webview dist not found; building with pnpm"
  ( cd "$REPO_ROOT" && pnpm --filter agentnet-webview build )
fi
STAGE="$WORK/server-bundle"
rm -rf "$STAGE"; mkdir -p "$STAGE/webview"
cp -R "$LH_DIST/." "$STAGE/"
cp -R "$WV_DIST/." "$STAGE/webview/"
tar -cf "$ASSETS/agentnet-server.tar" -C "$STAGE" .

echo "==> done. assets:"
ls -lh "$ASSETS"
