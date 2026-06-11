#!/usr/bin/env bash
# Build the three Android assets the shell extracts on first run. NOT yet implemented —
# this is the spec for the release pipeline. Producing a working proot-distro rootfs
# with the official claude/codex installed needs a real aarch64 environment (a device,
# an emulator, or an arm64 Linux CI runner with proot), so it's a pipeline step, not a
# laptop one-liner. Filling this in is the next concrete task after the shell skeleton.
#
# Outputs (placed in app/src/main/assets/, gitignored):
#   proot-arm64            Bionic-native proot binary that runs on Android directly.
#                          Source: termux proot build, or proot-distro's bundled proot.
#   rootfs-arm64.tar       proot-distro Ubuntu (glibc) rootfs, plain tar (TarExtractor
#                          reads .tar; do the xz/gz decompression here, not on device),
#                          containing:
#                            - node (installed in the guest)
#                            - the official `claude` and `codex` CLIs (their normal
#                              install path — NOT the leaked forks)
#                            - ripgrep (rg)
#                            - guest/AGENTS.md copied to /root/AGENTS.md
#   agentnet-server.tar    The `surfaces/localhost` build output (pnpm --filter
#                          agentnet-localhost build → dist/), tarred, unpacked to
#                          /root/agentnet-server in the guest.
#
# Steps to implement:
#   1. Fetch/build proot-arm64 (Bionic).
#   2. Create the rootfs: proot-distro install ubuntu (or unpack its rootfs), then
#      inside it: install node, install official claude + codex, install ripgrep,
#      drop guest/AGENTS.md at /root/. Export the rootfs dir as a plain tar.
#   3. Build the server: (cd ../../.. && pnpm --filter agentnet-localhost build), then
#      tar surfaces/localhost/dist → agentnet-server.tar.
#   4. Copy all three into app/src/main/assets/.
#
# Until this exists, the APK builds but has no runtime to extract (the installer will
# throw on the missing assets) — intended: the shell skeleton lands first, the heavy
# artifacts come with the pipeline.

set -euo pipefail
echo "build-assets.sh is a spec stub — see comments. Not implemented yet." >&2
exit 1
