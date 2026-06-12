# 2. Open the Project and Run the App

By now you have Android Studio installed (see [01](01-install-android-studio.md)) and the
project folder on your computer. This doc takes you from "folder on disk" to "app running
on your phone."

Steps:
1. [Get the asset files](#get-the-asset-files) (the ~1 GB Linux image — one-time).
2. [Open the project in Android Studio](#open-the-project).
3. [Enable USB debugging on the phone](#enable-usb-debugging).
4. [Run the app](#run-the-app).

---

## Get the asset files

The app needs three files in `surfaces/android/app/src/main/assets/`:

```
proot-arm64/            (a folder)
rootfs-arm64.tar        (~1 GB)
agentnet-server.tar
```

These are **not in git** (too large). **Check if they're already there first** — if you
got the folder from someone who built it, you can skip this section.

```bash
# macOS — list the assets folder
ls -la surfaces/android/app/src/main/assets/
```
If you see all three, you're done — jump to [Open the project](#open-the-project).

If they're missing, get them one of two ways:

### Option A — download from GitHub Actions (easiest, recommended)

This builds the assets in the cloud; you just download the result. No build tools needed
on your machine.

1. Go to the repo on GitHub → **Actions** tab.
2. Pick the **android-assets** workflow → **Run workflow** → leave ABI = `arm64` → **Run**.
3. Wait ~10–15 min (it builds the Linux image under emulation).
4. When it's green, open the run → scroll to **Artifacts** → download
   **android-assets-arm64** (a `.zip`).
5. Unzip it. Inside you'll find `proot-arm64/`, `rootfs-arm64.tar`, `agentnet-server.tar`.
6. Copy all three into `surfaces/android/app/src/main/assets/`.

### Option B — build locally with Docker (advanced)

Requires **Docker Desktop** with arm64 emulation. Slower to set up, but fully local.

```bash
# from the repo root — build the JS bundles first
pnpm install
pnpm --filter agentnet-localhost build
pnpm --filter agentnet-webview build

# then build the rootfs inside an arm64 container (mirrors the CI step)
docker run --rm --platform linux/arm64 \
  -v "$(pwd):/work" -w /work \
  -e ABI=arm64 -e ALLOW_CROSS=1 \
  ubuntu:24.04 \
  bash -c 'apt-get update -qq && apt-get install -y -qq curl ca-certificates xz-utils tar coreutils && bash surfaces/android/scripts/build-assets.sh'
```
This writes the three files straight into the assets folder.

---

## Open the project

⚠️ **Important:** the Android project is **not** the repo root. It's the `surfaces/android`
subfolder. Open *that*, not the top folder, or Android Studio won't recognize it.

1. Open **Android Studio**.
2. On the Welcome screen click **Open** (not "New Project").
3. Navigate to the project and select the **`surfaces/android`** folder:
   - macOS example: `/Users/<you>/.../AgentNet/surfaces/android`
   - Windows example: `C:\Users\<you>\...\AgentNet\surfaces\android`
4. Click **Open**.
5. Android Studio loads the project and runs a **Gradle sync** (bottom status bar). First
   time it downloads Gradle + dependencies — **let it finish** (a few minutes; needs
   internet). When the bar says "Gradle sync finished," you're ready.

> If a popup asks to "Trust" the project, click **Trust Project**.

---

## Enable USB debugging

This lets your computer install and run apps on the phone over USB. One-time setup on the
**phone**.

1. **Turn on Developer options:**
   - Open **Settings → About phone** (on Samsung: Settings → About phone → Software
     information).
   - Find **Build number** and **tap it 7 times**. It'll say "You are now a developer."
2. **Turn on USB debugging:**
   - Go back to **Settings → Developer options** (usually under Settings, or
     Settings → System → Developer options).
   - Toggle **USB debugging** ON.
3. **Plug the phone into the computer** with a USB cable.
4. On the phone, a dialog pops up: **"Allow USB debugging?"** → check "Always allow from
   this computer" → **Allow**.

**Confirm the computer sees the phone:**

```bash
# macOS
~/Library/Android/sdk/platform-tools/adb devices

# Windows (PowerShell)
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices
```
You should see your phone listed with `device` next to it, e.g.:
```
List of devices attached
R3CT20DGGEW     device
```
If it says `unauthorized`, re-check the "Allow USB debugging?" dialog on the phone.
If nothing's listed, try a different cable/port (some cables are charge-only).

---

## Run the app

### Android Studio (GUI — recommended for first time)

1. At the top of Android Studio, find the **device dropdown** (next to the green ▶ Run
   button). Your phone should appear there — select it.
2. Make sure the dropdown next to it says **app**.
3. Click the green **▶ Run** button (or press **Ctrl+R** on Mac / **Shift+F10** on Windows).
4. Android Studio builds the APK and installs it. **The first build is slow** (it packages
   the ~1 GB Linux image) — give it a few minutes.
5. The app launches on the phone automatically.

### ⚡ Faster: terminal (how it was actually built & tested)

From the `surfaces/android` folder:

```bash
# build the APK
./gradlew assembleDebug          # macOS / Linux
gradlew.bat assembleDebug        # Windows

# install it (uses the adb full path; -s picks the device if more than one is plugged in)
~/Library/Android/sdk/platform-tools/adb install -r app/build/outputs/apk/debug/app-debug.apk

# launch it
~/Library/Android/sdk/platform-tools/adb shell monkey -p com.iqlabs.agentnet -c android.intent.category.LAUNCHER 1
```

---

## What happens on first launch

1. A splash screen with the IQ logo appears. The first run **unpacks the Linux image**
   ("Setting up your environment… first launch only") — this takes a few minutes. Later
   launches are instant.
2. **Connect your wallet** — tap Connect, approve in your wallet app (e.g. Phantom).
3. **Connect Claude** — tap Connect Claude, open the link to sign into your Claude
   subscription, paste the code back. (You can use the "Copy link" button to sign in on
   another device.)
4. You're in the chat — message Claude and it runs on **your** subscription, on the phone.

---

## Troubleshooting

- **App stays on the splash / "Server did not come up":** check the logs —
  ```bash
  ~/Library/Android/sdk/platform-tools/adb logcat -d | grep -E "AgentNet/|\[server\]"
  ```
- **`proot error: ptrace(PEEKDATA): I/O error` / `Bad address` in the logs:** that phone's
  kernel can't run the sandbox (seen on some MediaTek chips). **Use a Snapdragon phone.**
- **Phone not detected (`adb devices` empty):** different USB cable/port; re-accept the
  "Allow USB debugging" prompt; toggle USB debugging off/on.
- **Gradle sync fails on "Open project":** make sure you opened **`surfaces/android`**, not
  the repo root. Re-open the correct folder.
- **Build fails complaining about missing assets / `rootfs-arm64.tar`:** you skipped
  [Get the asset files](#get-the-asset-files).
- **To reset the app to a clean state** (re-do onboarding, re-unpack):
  ```bash
  ~/Library/Android/sdk/platform-tools/adb shell pm clear com.iqlabs.agentnet
  ```
