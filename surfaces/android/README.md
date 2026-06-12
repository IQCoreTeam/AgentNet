# AgentNet — Android shell

The on-device form of the vscode extension host. A thin Kotlin shell that runs our
`surfaces/localhost` node server **inside a proot-distro Ubuntu (glibc) guest**, then
points a WebView at `http://127.0.0.1:4317/`. From there it's the same React UI and the
same HTTP-RPC + SSE transport as the browser surface — one UI, one engine path.

## Why proot (and not a bundled binary)

The official `claude` / `codex` CLIs are native **glibc/musl** binaries with **no
Android build** — Android's Bionic kernel rejects them (`unexpected e_type: 2`). proot
emulates a glibc Linux over app storage so the **official, unmodified** binaries run.
We deliberately do NOT use the leaked-source "Claw Code/OpenClaude" rebuilds; we run the
official CLIs through Anthropic's/OpenAI's normal install path inside the guest. See the
project memory `project_agentnet_android` for the full decision + the measurements
behind it (no Android binary, ET_EXEC rejection, seccomp speed mitigation).

`seccomp-bpf` acceleration is left **on** (we never set `PROOT_NO_SECCOMP`), which keeps
the per-syscall overhead small — fine for the network-bound agent-chat workload.

## Layout

```
surfaces/android/
  settings.gradle.kts, build.gradle.kts, gradle.properties
  app/
    build.gradle.kts          targetSdk=28 (W^X exemption to exec from app storage)
    src/main/
      AndroidManifest.xml
      java/com/iqlabs/agentnet/
        MainActivity.kt        boot flow: install → service → server → WebView
        ServerManager.kt       runs `proot … node /root/agentnet-server/index.js`
        ServerService.kt       foreground service (keeps the server alive)
        Installer.kt           first-run extraction of proot + rootfs + server bundle
        TarExtractor.kt        minimal tar reader (symlinks for the glibc rootfs)
        Paths.kt               on-device layout
      res/...                  one WebView over a status line
  guest/
    AGENTS.md                  environment notes shipped INTO the rootfs for the agent
```

## Status — what's done vs. open

**Done (this commit):** the Kotlin shell skeleton — boot flow, proot invocation, server
readiness poll, foreground service, first-run installer, tar extractor, WebView wiring,
and the guest `AGENTS.md` environment guidance.

**Open:**
- **Running the asset build.** `scripts/build-assets.sh` is a real, runnable script
  (fetches an Android-native proot, builds a proot-distro Ubuntu rootfs, installs node +
  the official claude/codex CLIs + ripgrep inside it, drops the guest `AGENTS.md` at
  `/root/`, and packs `surfaces/localhost`'s build). It just hasn't been *run* — the
  rootfs step needs the **target arch (aarch64)**: a root chroot on an arm64 host, an
  arm64 CI runner, or qemu-user-static binfmt. The produced assets are gitignored
  (large binaries), so they're never committed — they're built per release.
- **On-device verification.** Nothing here has run on a real device yet. The proot
  invocation (`ServerManager`) is validated against UserLAnd + proot-distro, including
  `PROOT_NO_SECCOMP=1` (Android 12+/15 crash without it) and writing `/etc/resolv.conf`
  for DNS — but the seccomp-off-vs-speed tradeoff and `AGENTS.md`'s slow/forbidden lists
  still need real-device measurement.

## Attribution

The native-shell *mechanics* (WebView + ProcessBuilder + `targetSdk=28` + uncompressed
assets + foreground service + HTTP readiness poll) are adapted from **AnyClaw**
(`friuns2/openclaw-android-assistant`, MIT). None of AnyClaw's OpenClaw/Codex-specific
install logic is copied — our engine is the official CLIs inside a proot guest.
