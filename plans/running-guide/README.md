# Running AgentNet on a Phone — Setup Guide

This guide walks a **first-timer** through building the AgentNet Android app and running
it on a real phone. No prior Android experience needed — just follow the steps.

Read in order:

1. **[01-install-android-studio.md](01-install-android-studio.md)** — install Android
   Studio (Mac & Windows) and the Android SDK.
2. **[02-open-and-run.md](02-open-and-run.md)** — open this project, enable USB debugging
   on the phone, and launch the app.

---

## First, clear up one confusion

There are **two different "Claude/Codex" things** and they are unrelated. Don't mix them up.

| | What it is | Runs where |
|---|---|---|
| **Android Studio** | The tool that **builds and installs the AgentNet app (APK)**. | Your computer. |
| **claude / codex CLI** | The agent that runs **inside the AgentNet app**, in a Linux (proot) sandbox on the phone. The app installs and signs into it on-device. | The phone, inside the app. |

So:

- **"If I use Android Studio, does it use the claude on my computer?"** → **No.** Android
  Studio just compiles the app. The app carries its *own* claude/codex inside it and runs
  them on the phone. Your computer's claude (if any) is never involved.
- Android Studio is just the factory that produces the app. The app is its own self-
  contained world once it's on the phone.

## Two ways to build & install

You'll see two paths in the next docs. They do the **same thing** — pick whichever you're
comfortable with:

- **Android Studio (GUI, clicking)** — easiest for a first-timer. The whole guide is
  written around this.
- **Terminal (`adb` / `./gradlew`)** — faster once you know it. This is actually how the
  app was built and tested during development. Shown as a "⚡ Faster: terminal" note in
  each step.

## What you need (checklist)

- A computer (macOS or Windows).
- An **Android phone with a Snapdragon chip** (e.g. Samsung Galaxy S/Z series). ⚠️ Some
  MediaTek phones have a kernel defect that prevents the sandbox from running — see the
  note in [02-open-and-run.md](02-open-and-run.md).
- A USB cable to connect the phone.
- ~10 GB free disk space (Android Studio + SDK + the app's bundled Linux image).

## One thing to know up front: the big asset files

The app ships a ~1 GB Linux image (the sandbox the agent runs in). Those files are **not
in git** (too large), so a fresh clone is missing them. Before the app will build, you
need to drop three files into `surfaces/android/app/src/main/assets/`:

```
proot-arm64/            (a folder)
rootfs-arm64.tar        (~1 GB)
agentnet-server.tar
```

How to get them is covered in **[02-open-and-run.md → "Get the asset files"](02-open-and-run.md#get-the-asset-files)**.
(If you got this project folder from someone who already built it, these files may already
be there — check first.)
