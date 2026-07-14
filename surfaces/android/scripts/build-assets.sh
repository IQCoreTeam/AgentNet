#!/usr/bin/env bash
# Build the Android runtime payload:
#   app/src/main/jniLibs/<abi>/lib*.so         Android-native proot + loader + libs.
#                                              Ship here (NOT as loose ELF in assets/) so the
#                                              OS extracts them to nativeLibraryDir and Play
#                                              Protect doesn't REJECT "executable ELF in assets".
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
  arm64)  PROOT_ARCH="aarch64" ;;
  x86_64) PROOT_ARCH="x86_64" ;;
  *) echo "unsupported ABI: $ABI (use arm64 or x86_64)" >&2; exit 1 ;;
esac

HERE="$(cd "$(dirname "$0")" && pwd)"
ANDROID_DIR="$(cd "$HERE/.." && pwd)"
REPO_ROOT="$(cd "$ANDROID_DIR/../.." && pwd)"
ASSETS="$ANDROID_DIR/app/src/main/assets"
WORK="${WORK:-$ANDROID_DIR/.assets-build}"
mkdir -p "$ASSETS" "$WORK"

echo "==> ABI=$ABI  proot=$PROOT_ARCH"
echo "==> assets -> $ASSETS"
echo "==> work   -> $WORK"

# 1) proot binary + loader + its shared libs. We use our patched TERMUX proot build, NOT
#    green-green-avk. Why: this proot is compiled with the process_vm accelerator
#    (process_vm_readv/writev) for guest-memory access. process_vm_readv strips arm64
#    top-byte pointer tags, so it avoids the `ptrace(PEEKDATA): I/O error` on tagged
#    addresses that breaks the sandbox on tag-enabled devices (Solana Seeker / Android
#    16). The green-green-avk build is process_vm=no (PEEKDATA only) and fails there.
#    See plans/running-guide/android.md for the full root cause.
#
#    Trade-off: the Termux proot is dynamically linked against libtalloc.so.2 +
#    libandroid-shmem.so (and bionic libc, present on every device). We ship those two
#    libs under proot/lib and point LD_LIBRARY_PATH at them in ServerManager. The loader
#    ships in the SAME proot .deb so it always version-matches the binary.
TERMUX_POOL="${TERMUX_POOL:-https://packages.termux.dev/apt/termux-main/pool/main}"
# Discover the newest aarch64 .deb in each pool dir (override with *_DEB env for repro CI).
termux_latest_deb() {  # $1 = pool subdir (e.g. p/proot) ; echoes full URL
  local dir="$TERMUX_POOL/$1/"
  local file
  # NOTE: `_` MUST be in the character class. Termux filenames are <pkg>_<ver>_<arch>.deb
  # (e.g. proot_5.1.107.81_aarch64.deb); without `_` the regex drops the <pkg>_ prefix and
  # yields "5.1.107.81_aarch64.deb", whose URL 404s — which is exactly what broke CI.
  file=$(curl -fsSL "$dir" | grep -oE "[a-z0-9._+-]+_${PROOT_ARCH}\.deb" | sort -V | tail -1)
  [ -n "$file" ] || { echo "!! no $PROOT_ARCH .deb under $dir" >&2; return 1; }
  echo "$dir$file"
}
# Extract a .deb's data tree into $2 (portable: dpkg-deb if present, else ar + tar).
deb_extract() {  # $1 = deb file, $2 = dest dir
  mkdir -p "$2"
  if command -v dpkg-deb >/dev/null 2>&1; then dpkg-deb -x "$1" "$2"; return; fi
  local tmp; tmp=$(mktemp -d); ( cd "$tmp" && ar x "$1" )
  local data; data=$(ls "$tmp"/data.tar.* | head -1)
  case "$data" in
    *.zst) zstd -dc "$data" | tar -x -C "$2" ;;
    *.xz)  tar -xJf "$data" -C "$2" ;;
    *.gz)  tar -xzf "$data" -C "$2" ;;
    *)     tar -xf "$data" -C "$2" ;;
  esac
  rm -rf "$tmp"
}
# Accept the source-built package path from android-assets.yml as well as the
# repository URLs used for the two runtime libraries.
fetch_deb() {  # $1 = URL or local path, $2 = destination
  case "$1" in
    http://*|https://*) curl -fsSL "$1" -o "$2" ;;
    file://*) cp "${1#file://}" "$2" ;;
    *) cp "$1" "$2" ;;
  esac
}
# Release CI always sets PROOT_DEB to the package built from the pinned Termux
# source recipe plus surfaces/android/proot/patches/0001-copy-on-link.patch.
# The URL fallback keeps this script independently runnable for development.
PROOT_DEB="${PROOT_DEB:-$(termux_latest_deb p/proot)}"
TALLOC_DEB="${TALLOC_DEB:-$(termux_latest_deb libt/libtalloc)}"
SHMEM_DEB="${SHMEM_DEB:-$(termux_latest_deb liba/libandroid-shmem)}"
echo "==> [1/3] fetching termux proot + libs"
echo "    proot:  $PROOT_DEB"
echo "    talloc: $TALLOC_DEB"
echo "    shmem:  $SHMEM_DEB"
PROOT_STAGE="$WORK/proot"
rm -rf "$PROOT_STAGE"; mkdir -p "$PROOT_STAGE"
fetch_deb "$PROOT_DEB"  "$WORK/proot.deb"  && deb_extract "$WORK/proot.deb"  "$PROOT_STAGE/proot"
fetch_deb "$TALLOC_DEB" "$WORK/talloc.deb" && deb_extract "$WORK/talloc.deb" "$PROOT_STAGE/talloc"
fetch_deb "$SHMEM_DEB"  "$WORK/shmem.deb"  && deb_extract "$WORK/shmem.deb"  "$PROOT_STAGE/shmem"
# Termux installs under data/data/com.termux/files/usr — pull the bits we need out of there.
TUSR="data/data/com.termux/files/usr"
# Ship proot + loader + libs under jniLibs/<android-abi> as lib*.so (NOT as loose ELF in
# assets/). The OS extracts jniLibs into nativeLibraryDir at install — an app-owned dir that
# stays executable on any targetSdk — and ELF under lib/ is what Play Protect expects, so
# this avoids the "executable ELF in assets" REJECT. jniLibs ONLY packages files named
# lib*.so, hence the renames (Paths.kt / ServerManager.kt expect these exact names):
#   proot           -> libproot.so      (ServerManager runs this)
#   loader/loader32 -> libloader.so / libloader32.so   (PROOT_LOADER / PROOT_LOADER_32)
#   libtalloc.so.2  -> libtalloc.so     (versioned name isn't lib*.so; ServerManager hangs a
#                                         libtalloc.so.2 soname symlink at runtime to resolve it)
#   libandroid-shmem.so                 (already lib*.so)
# proot-userland is unused by the shell, so it's dropped — one fewer ELF in the APK.
case "$ABI" in
  arm64)  JNI_ABI="arm64-v8a" ;;
  x86_64) JNI_ABI="x86_64" ;;
esac
JNIDIR="$ANDROID_DIR/app/src/main/jniLibs/$JNI_ABI"
rm -rf "$JNIDIR"; mkdir -p "$JNIDIR"
cp "$PROOT_STAGE/proot/$TUSR/bin/proot"               "$JNIDIR/libproot.so"
cp "$PROOT_STAGE/proot/$TUSR/libexec/proot/loader"    "$JNIDIR/libloader.so"
cp "$PROOT_STAGE/proot/$TUSR/libexec/proot/loader32"  "$JNIDIR/libloader32.so" 2>/dev/null || true
# cp -L: the versioned .so.2 is a symlink in the .deb — copy the real bytes.
cp -L "$PROOT_STAGE/talloc/$TUSR/lib/libtalloc.so.2"     "$JNIDIR/libtalloc.so"
cp -L "$PROOT_STAGE/shmem/$TUSR/lib/libandroid-shmem.so" "$JNIDIR/libandroid-shmem.so"
# The talloc/shmem .debs ship their .so as 0700 (owner-only). In CI this script runs as
# root inside the arm64 container, so 0700 files are unreadable to the non-root runner that
# later zips them for upload-artifact (EACCES → "zip creation" failure). Make them
# world-readable; 0755 is the normal mode for native libs and the OS resets perms on-device.
chmod 0755 "$JNIDIR"/*.so

# 2) Ubuntu rootfs with the engine installed. KEY: we don't download a rootfs — this
#    script runs INSIDE an arm64 ubuntu container (see the workflow), so the container's
#    own "/" IS the rootfs. We install node + the OFFICIAL claude/codex CLIs + ripgrep
#    right here, drop the guest AGENTS.md at /root/, then tar "/" (minus virtual fs) as
#    the rootfs. No download = no 404, and the bits exactly match the pinned base image.
#    (Requires running as root inside that arm64 container; the workflow does both.)
echo "==> [2/3] installing engine into this container's rootfs"
if [ "$PROOT_ARCH" != "$(uname -m)" ] && [ -z "${ALLOW_CROSS:-}" ]; then
  echo "!! host arch $(uname -m) != target $PROOT_ARCH — run this inside an arm64" >&2
  echo "!! container (the CI does). Set ALLOW_CROSS=1 only if you know what you're doing." >&2
  exit 1
fi
if [ "$(id -u)" != "0" ]; then
  echo "!! must run as root (this writes into / and installs packages)." >&2
  exit 1
fi
export DEBIAN_FRONTEND=noninteractive
apt-get update
# python3-dulwich backs the git-clone shim (issue #112): native git clone is corrupted
# under proot on Android's targetSdk-35 untrusted_app domain; dulwich clones in one process.
apt-get install -y curl ca-certificates git ripgrep xz-utils python3 python3-dulwich
# node (NodeSource LTS)
curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
apt-get install -y nodejs
# official CLIs — their normal installers (NOT the leaked forks); installed but
# logged-out, so no credentials end up in the image. The user logs in on-device.
#
# claude-code is a NATIVE binary: the meta package's postinstall pulls a per-platform
# optionalDep (@anthropic-ai/claude-code-linux-<arch>) holding the real `claude.exe`.
# Under QEMU-emulated arm64 that download can silently fail (the postinstall just prints
# a fallback note and exits 0), leaving claude.exe -> a missing target. So we install the
# arch-specific native package EXPLICITLY and then HARD-ASSERT the binary exists — better
# a failed build than an APK whose `claude` is a dangling symlink.
case "$ABI" in
  arm64)  CLAUDE_NATIVE="@anthropic-ai/claude-code-linux-arm64" ;;
  x86_64) CLAUDE_NATIVE="@anthropic-ai/claude-code-linux-x64" ;;
esac
npm install -g @anthropic-ai/claude-code @openai/codex "$CLAUDE_NATIVE"
# Resolve the claude symlink and confirm it points at a real, executable file.
CLAUDE_BIN="$(command -v claude || true)"
if [ -z "$CLAUDE_BIN" ] || [ ! -e "$(readlink -f "$CLAUDE_BIN")" ]; then
  echo "!! claude native binary missing after install ($CLAUDE_NATIVE not resolved)." >&2
  echo "!! claude -> $(readlink -f "$CLAUDE_BIN" 2>/dev/null || echo '?')" >&2
  exit 1
fi
echo "    claude OK: $CLAUDE_BIN -> $(readlink -f "$CLAUDE_BIN")"
apt-get clean && rm -rf /var/lib/apt/lists/*
# ship the agent environment guidance into the guest
cp "$ANDROID_DIR/guest/AGENTS.md" /root/AGENTS.md

# issue #112: install the git-clone shim ahead of /usr/bin/git on PATH. It routes `git clone`
# through dulwich (single-process, works under targetSdk-35 proot) and passes everything else
# to the real git. /usr/local/bin is first in the guest PATH (see ServerManager.buildGuestEnv).
cp "$ANDROID_DIR/guest/agentnet-git-clone.py" /usr/local/bin/agentnet-git-clone.py
cp "$ANDROID_DIR/guest/git-clone-shim.sh" /usr/local/bin/git
chmod +x /usr/local/bin/agentnet-git-clone.py /usr/local/bin/git

# Keep rseq disabled for login shells. Not the fix for #112 (that's the clone shim above —
# the app-domain transport corruption survives rseq-off), but rseq-under-ptrace is a real,
# separately-measured corruption vector, so this stays as a low-cost guard. The app covers
# node + children via guest env; this profile.d covers adb/manual proot entry too.
cat > /etc/profile.d/00-agentnet-rseq.sh <<'RSEQ'
export GLIBC_TUNABLES=glibc.pthread.rseq=0
RSEQ

echo "    packing this container's / as the rootfs tar (plain tar; TarExtractor reads .tar)"
# Write the tar OUTSIDE the tree we're taring (/var/tmp is on the container's own fs and
# is excluded below), then move it into assets — so the archive never contains itself.
# -p/--numeric-owner/--xattrs preserve perms+ownership. The repo (REPO_ROOT, a -v mount)
# is excluded via --one-file-system since it's a separate mount, but we also name it
# explicitly. Virtual filesystems and tmp dirs are excluded too.
ROOTFS_TAR="/var/tmp/rootfs-$ABI.tar"
REPO_REL="./${REPO_ROOT#/}"   # /work -> ./work, for the exclude pattern
# -p + --numeric-owner: preserve perms, store raw uid/gid (proot fakes root anyway).
# NO --xattrs: an Ubuntu base has no SELinux labels worth keeping, and security xattrs
# only cause "permission denied" noise under proot.
#
# NO --one-file-system: under Docker/QEMU the container fs is an overlay and parts of the
# tree (or NodeSource's /usr/lib/node_modules) can sit on a different st_dev, so
# --one-file-system silently DROPS files at the boundary — that's what left npm's
# @sigstore/.../__generated__ out of the rootfs and broke `npm`/claude on-device. We
# instead exclude only the virtual filesystems and tmp/work dirs explicitly, so the whole
# real tree (incl. all of node_modules) is captured. Docker's runtime /etc/resolv.conf +
# /etc/hosts may still be skipped, but Installer.kt rewrites them on the phone.
tar -cpf "$ROOTFS_TAR" \
  --numeric-owner \
  --exclude="./proc" --exclude="./sys" --exclude="./dev" --exclude="./run" \
  --exclude="./tmp" --exclude="./var/tmp" --exclude="./var/cache/apt" \
  --exclude="$REPO_REL" \
  -C / .
mkdir -p "$ASSETS"
mv "$ROOTFS_TAR" "$ASSETS/rootfs-$ABI.tar"

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
echo "==> jniLibs ($JNI_ABI):"
ls -lh "$JNIDIR"
