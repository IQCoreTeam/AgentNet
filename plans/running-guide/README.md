# Running Guide

How to install and run each AgentNet surface (app). Pick the one you want.

| Surface | What it is | Guide |
|---|---|---|
| **Android app** | The phone app — runs the agent on your subscription, on-device. | [android.md](android.md) |
| **VS Code extension** | The desktop extension — the agent inside your editor. | [vscode.md](vscode.md) |

Already have the Android app installed and need to update it or fix a stale/broken build?
See [android-clean-reinstall.md](android-clean-reinstall.md) — pull a fresh build from CI and
reinstall (quick refresh vs. full clean reinstall).

For Android debug builds, do not install APKs from unknown or stale sources. Build from
current `main` with the fresh `android-assets-arm64` artifact and the team-shared debug
keystore, or verify the handoff APK's commit, CI run, and signing SHA-1 first.

> AgentNet is **one codebase, many surfaces** (Android, VS Code, a local web server). They
> share the same core; each guide here is just how to install and launch that one surface.
