# Install Guide

How to install and run each AgentNet surface (app). Pick the one you want.

| Surface | What it is | Install |
|---|---|---|
| **Android app** | The phone app — runs the agent on your subscription, on-device. | [Download the latest APK](https://github.com/IQCoreTeam/AgentNet/releases/tag/android-latest) |
| **VS Code extension** | The desktop extension — the agent inside your editor. | [vscode.md](vscode.md) |
| **CLI** | The terminal surface. | [cli.md](cli.md) |

## Android — most users

Install the app straight from the release: **[android-latest](https://github.com/IQCoreTeam/AgentNet/releases/tag/android-latest)**. Download the APK to your phone and open it. No build tools, no Android Studio.

Building from source instead (developers): see [android.md](android.md) — the dev / debugging build guide.

> ⚠️ Pre-release: Android, VS Code, and the CLI all currently run on **devnet** and are not
> published yet. Once released this guide switches to the shipped paths: `npm install` for the
> CLI, the VS Code Marketplace extension link, the app link, and the **Seeker store** for Android.

> AgentNet is **one codebase, many surfaces** (Android, VS Code, a local web server). They
> share the same core; each guide here is just how to install and launch that one surface.
