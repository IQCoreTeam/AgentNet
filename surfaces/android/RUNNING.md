# Running AgentNet on a Phone

A step-by-step guide for a **first-timer** to build the AgentNet Android app and run it on
a real phone. No prior Android experience needed.

- [First, clear up one confusion](#first-clear-up-one-confusion)
- [What you need](#what-you-need)
- [Step 1 — Install Android Studio](#step-1--install-android-studio)
- [Step 2 — Get the asset files](#step-2--get-the-asset-files)
- [Step 3 — Open the project](#step-3--open-the-project)
- [Step 4 — Enable USB debugging](#step-4--enable-usb-debugging)
- [Step 5 — Run the app](#step-5--run-the-app)
- [What happens on first launch](#what-happens-on-first-launch)
- [Troubleshooting](#troubleshooting)

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

**Two ways to build & install** — they do the same thing, pick whichever you like:

- **Android Studio (GUI, clicking)** — easiest for a first-timer; this guide is written
  around it.
- **Terminal (`adb` / `./gradlew`)** — faster once you know it, and how the app was
  actually built and tested during development. Shown as a "⚡ Faster: terminal" note.

---

## What you need

- A computer (macOS or Windows).
- An **Android phone with a Snapdragon chip** (e.g. Samsung Galaxy S/Z series). ⚠️ Some
  MediaTek phones have a kernel defect that stops the sandbox from running — see
  [Troubleshooting](#troubleshooting).
- A USB cable to connect the phone.
- ~10 GB free disk space (Android Studio + SDK + the app's bundled Linux image).

---

## Step 1 — Install Android Studio

Android Studio is the official tool for building Android apps. It also brings the **Android
SDK** (which includes `adb`, the tool that talks to your phone). You do this **once**.

### macOS

1. Go to **https://developer.android.com/studio** → **Download Android Studio**.
2. Accept the terms, download the `.dmg`.
3. Open the `.dmg` and **drag Android Studio into Applications**.
4. Open **Android Studio** (if macOS warns, right-click → Open the first time).
5. The **Setup Wizard** runs: choose **Standard** install, accept the SDK licenses, let it
   download the SDK (a few minutes).
6. You land on the **Welcome to Android Studio** screen.

`adb` lives at: `~/Library/Android/sdk/platform-tools/adb`

### Windows

1. Go to **https://developer.android.com/studio** → **Download Android Studio**.
2. Accept the terms, download the `.exe`, run the installer, click **Next** through the
   defaults.
3. Launch **Android Studio**.
4. The **Setup Wizard** runs: choose **Standard** install, accept the SDK licenses, let it
   download the SDK (a few minutes).
5. You land on the **Welcome to Android Studio** screen.

`adb` lives at: `C:\Users\<YourName>\AppData\Local\Android\Sdk\platform-tools\adb.exe`

### Sanity check (optional)

```bash
# macOS
~/Library/Android/sdk/platform-tools/adb version
# Windows (PowerShell)
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" version
```
If it prints `Android Debug Bridge version ...`, you're set.

> 💡 To type just `adb`, add platform-tools to your PATH. Optional — this guide always
> shows the full path so you don't have to.

---

## Step 2 — Get the asset files

The app needs three files in `app/src/main/assets/` (relative to this `surfaces/android`
folder):

```
proot-arm64/            (a folder)
rootfs-arm64.tar        (~1 GB)
agentnet-server.tar
```

These are **not in git** (too large). **Check if they're already there first** — if you
got this folder from someone who built it, you can skip this step.

```bash
ls -la app/src/main/assets/
```
If you see all three, jump to [Step 3](#step-3--open-the-project). Otherwise:

### Option A — download from GitHub Actions (easiest)

Builds the assets in the cloud; you just download the result. No build tools needed locally.

1. Repo on GitHub → **Actions** tab.
2. **android-assets** workflow → **Run workflow** → ABI = `arm64` → **Run**.
3. Wait ~10–15 min (it builds the Linux image under emulation).
4. When green, open the run → **Artifacts** → download **android-assets-arm64** (`.zip`).
5. Unzip; copy `proot-arm64/`, `rootfs-arm64.tar`, `agentnet-server.tar` into
   `app/src/main/assets/`.

### Option B — build locally with Docker (advanced)

Requires **Docker Desktop** with arm64 emulation. From the **repo root**:

```bash
pnpm install
pnpm --filter agentnet-localhost build
pnpm --filter agentnet-webview build

docker run --rm --platform linux/arm64 \
  -v "$(pwd):/work" -w /work \
  -e ABI=arm64 -e ALLOW_CROSS=1 \
  ubuntu:24.04 \
  bash -c 'apt-get update -qq && apt-get install -y -qq curl ca-certificates xz-utils tar coreutils && bash surfaces/android/scripts/build-assets.sh'
```
This writes the three files straight into the assets folder.

---

## Step 3 — Open the project

⚠️ **Important:** open the **`surfaces/android`** folder (where this file is), **not** the
repo root, or Android Studio won't recognize it.

1. Open **Android Studio** → **Open** (not "New Project").
2. Select the **`surfaces/android`** folder:
   - macOS: `/Users/<you>/.../AgentNet/surfaces/android`
   - Windows: `C:\Users\<you>\...\AgentNet\surfaces\android`
3. Click **Open**. If asked, click **Trust Project**.
4. Android Studio runs a **Gradle sync** (bottom status bar). First time it downloads
   Gradle + dependencies — **let it finish** (a few minutes, needs internet). Wait for
   "Gradle sync finished."

---

## Step 4 — Enable USB debugging

One-time setup on the **phone**, so your computer can install and run apps over USB.

1. **Turn on Developer options:** Settings → **About phone** (Samsung: → Software
   information) → find **Build number** → **tap it 7 times** ("You are now a developer").
2. **Turn on USB debugging:** Settings → **Developer options** → toggle **USB debugging** ON.
3. **Plug the phone into the computer** with a USB cable.
4. On the phone: **"Allow USB debugging?"** → check "Always allow from this computer" →
   **Allow**.

Confirm the computer sees it:

```bash
# macOS
~/Library/Android/sdk/platform-tools/adb devices
# Windows (PowerShell)
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices
```
You should see your phone with `device` next to it:
```
List of devices attached
R3CT20DGGEW     device
```
- `unauthorized` → re-check the "Allow USB debugging?" dialog on the phone.
- Nothing listed → try another cable/port (some are charge-only).

---

## Step 5 — Run the app

### Android Studio (GUI — recommended for first time)

1. Top toolbar: in the **device dropdown** (next to the green ▶ Run button), select your
   phone. The dropdown next to it should say **app**.
2. Click the green **▶ Run** button (Mac: **Ctrl+R**, Windows: **Shift+F10**).
3. It builds the APK and installs it. **The first build is slow** (it packages the ~1 GB
   Linux image) — give it a few minutes.
4. The app launches on the phone automatically.

### ⚡ Faster: terminal (how it was actually built & tested)

From this `surfaces/android` folder:

```bash
# build the APK
./gradlew assembleDebug          # macOS / Linux
gradlew.bat assembleDebug        # Windows

# install it (-s picks the device if more than one is plugged in)
~/Library/Android/sdk/platform-tools/adb install -r app/build/outputs/apk/debug/app-debug.apk

# launch it
~/Library/Android/sdk/platform-tools/adb shell monkey -p com.iqlabs.agentnet -c android.intent.category.LAUNCHER 1
```

---

## What happens on first launch

1. A splash with the IQ logo appears. The first run **unpacks the Linux image** ("Setting
   up your environment… first launch only") — a few minutes. Later launches are instant.
2. **Connect your wallet** — tap Connect, approve in your wallet app (e.g. Phantom).
3. **Connect Claude** — tap Connect Claude, open the link to sign into your Claude
   subscription, paste the code back. ("Copy link" lets you sign in on another device.)
4. You're in the chat — message Claude and it runs on **your** subscription, on the phone.

---

## Troubleshooting

- **Stuck on the splash / "Server did not come up":** check the logs —
  ```bash
  ~/Library/Android/sdk/platform-tools/adb logcat -d | grep -E "AgentNet/|\[server\]"
  ```
- **`proot error: ptrace(PEEKDATA): I/O error` / `Bad address`:** that phone's kernel
  can't run the sandbox (seen on some MediaTek chips). **Use a Snapdragon phone.**
- **Phone not detected (`adb devices` empty):** different USB cable/port; re-accept the
  "Allow USB debugging" prompt; toggle USB debugging off/on.
- **Gradle sync fails on Open:** make sure you opened **`surfaces/android`**, not the repo
  root.
- **Build fails on missing assets / `rootfs-arm64.tar`:** you skipped
  [Step 2](#step-2--get-the-asset-files).
- **Reset the app to a clean state** (re-do onboarding, re-unpack):
  ```bash
  ~/Library/Android/sdk/platform-tools/adb shell pm clear com.iqlabs.agentnet
  ```
