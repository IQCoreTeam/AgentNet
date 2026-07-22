# Install Guide

How to install and run each AgentNet surface (app). Pick the one you want.

| Surface | What it is | Install |
|---|---|---|
| **Android app** | The phone app — runs the agent on your subscription, on-device. | [Download the latest APK](https://github.com/IQCoreTeam/AgentNet/releases/tag/android-latest) |
| **VS Code extension** | The desktop extension — the agent inside your editor. | [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=IQLabs.agentnet-vscode) ([guide](vscode.md)) |
| **CLI** | The terminal surface. | `npm install -g @iqlabs-official/agentnet-cli` ([guide](cli.md)) |

## Android — most users

Install the app straight from the release: **[android-latest](https://github.com/IQCoreTeam/AgentNet/releases/tag/android-latest)**. Download the APK to your phone and open it. No build tools, no Android Studio.

Building from source instead (developers): see [android.md](android.md) — the dev / debugging build guide.

> The VS Code extension is on the [Marketplace](https://marketplace.visualstudio.com/items?itemName=IQLabs.agentnet-vscode)
> and the CLI installs from npm (`@iqlabs-official/agentnet-cli`). Android currently ships as
> the APK release above; store listings (Seeker store, Google Play) are in progress.

> AgentNet is **one codebase, many surfaces** (Android, VS Code, a local web server). They
> share the same core; each guide here is just how to install and launch that one surface.
