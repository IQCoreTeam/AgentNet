#!/usr/bin/env bash
# Convert a PRE-jniLibs Android artifact into the layout the current app expects.
#
# Older android-assets artifacts (and any build made before proot moved to jniLibs) put
# proot as a loose ELF tree under app/src/main/assets/proot-<abi>/. The app now reads proot
# from jniLibs/<android-abi>/lib*.so so Google Play Protect doesn't REJECT the install over
# loose executable ELF in assets/. This script moves an old proot-<abi> tree into the new
# jniLibs layout with the EXACT renames the app expects, and deletes the loose ELF from
# assets/. Idempotent and safe to re-run.
#
# Use it when you downloaded an old artifact (it contains proot-<abi>/ instead of jniLibs/)
# and don't want to rebuild the ~1 GB rootfs just to fix the proot layout. The proot bytes
# are identical, so a relayout is all that's needed.
#
# Usage:  bash surfaces/android/scripts/relayout-proot.sh [arm64|x86_64]   (default arm64)
#         (run after copying the artifact's proot-<abi>/ folder into assets/)
set -euo pipefail

ABI="${1:-arm64}"
case "$ABI" in
  arm64)  JNI_ABI="arm64-v8a" ;;
  x86_64) JNI_ABI="x86_64" ;;
  *) echo "unsupported ABI: $ABI (use arm64 or x86_64)" >&2; exit 1 ;;
esac

HERE="$(cd "$(dirname "$0")" && pwd)"
ANDROID_DIR="$(cd "$HERE/.." && pwd)"
ASSETS="$ANDROID_DIR/app/src/main/assets"
SRC="$ASSETS/proot-$ABI"
JNIDIR="$ANDROID_DIR/app/src/main/jniLibs/$JNI_ABI"

if [ ! -d "$SRC" ]; then
  if [ -f "$JNIDIR/libproot.so" ]; then
    echo "==> already in jniLibs layout ($JNIDIR/libproot.so present); nothing to do."
    exit 0
  fi
  echo "!! no old proot tree at $SRC and no $JNIDIR/libproot.so." >&2
  echo "!! Copy the artifact's proot-$ABI/ folder into $ASSETS/ first," >&2
  echo "!! or just re-run the android-assets workflow for a current-format artifact." >&2
  exit 1
fi

echo "==> converting $SRC"
echo "          -> $JNIDIR"
mkdir -p "$JNIDIR"
# jniLibs only packages files named lib*.so, so each binary is renamed to that form. The
# app (Paths.kt / ServerManager.kt) expects these exact names.
cp "$SRC/bin/proot"               "$JNIDIR/libproot.so"
cp "$SRC/libexec/proot/loader"    "$JNIDIR/libloader.so"
cp "$SRC/libexec/proot/loader32"  "$JNIDIR/libloader32.so" 2>/dev/null || true
# The versioned .so.2 isn't lib*.so, so it can't ride in jniLibs — ship it as libtalloc.so;
# the app recreates the "libtalloc.so.2" soname with a symlink at runtime (ServerManager),
# so proot's DT_NEEDED still resolves. Missing this rename is the #1 way a hand-relayout
# breaks ("CANNOT LINK ... libtalloc.so.2 not found").
cp "$SRC/lib/libtalloc.so.2"      "$JNIDIR/libtalloc.so"
cp "$SRC/lib/libandroid-shmem.so" "$JNIDIR/libandroid-shmem.so"

# Remove the loose ELF from assets — leaving it would re-trigger the Play Protect reject
# (the whole reason proot moved out of assets).
rm -rf "$SRC"

echo "==> done. jniLibs/$JNI_ABI:"
ls -lh "$JNIDIR"
echo "    assets/ now (no proot tree, just the tars):"
ls -lh "$ASSETS"
