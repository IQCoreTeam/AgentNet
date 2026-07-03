# Running AgentNet on a Phone

A step-by-step guide for a **first-timer** to build the AgentNet Android app and run it on
a real phone. No prior Android experience needed.

- [How the pieces fit (where things build vs. run)](#how-the-pieces-fit-where-things-build-vs-run)
- [What you need](#what-you-need)
- [Step 1 — Install Android Studio](#step-1--install-android-studio)
- [Step 2 — Get the runtime assets (one time)](#step-2--get-the-runtime-assets-one-time)
- [Step 3 — Open the project](#step-3--open-the-project)
- [Step 4 — Enable USB debugging](#step-4--enable-usb-debugging)
- [Step 5 — Build and run on the phone](#step-5--build-and-run-on-the-phone)
- [Day-to-day: rebuild after a code change](#day-to-day-rebuild-after-a-code-change)
- [What happens on first launch](#what-happens-on-first-launch)
- [Troubleshooting](#troubleshooting)

---

## How the pieces fit (where things build vs. run)

This is the one thing to get straight, and it's also the thing people most often get wrong:

> **The app is built on your computer and installed onto the phone. Nothing is compiled on
> the phone.**

There are **two different "Claude/Codex" things** and they are unrelated. Don't mix them up.

| | What it is | Runs where |
|---|---|---|
| **Android Studio / Gradle** | The tool that **compiles the AgentNet app (APK)** on your machine and installs it over USB. | Your computer. |
| **claude / codex CLI** | The agent that runs **inside the AgentNet app**, in a Linux (proot) sandbox on the phone. The app installs and signs into it on-device. | The phone, inside the app. |

So, to answer the usual questions directly:

- **"Does Android Studio use the claude on my computer?"** → **No.** Android Studio just
  compiles the app. The app carries its *own* claude/codex inside it and runs them on the
  phone. Your computer's claude (if any) is never involved.
- **"Do we build the app in GitHub Actions / on the phone?"** → **No.** The **APK is built
  locally** with Gradle (`./gradlew assembleDebug`, which is what the green ▶ button runs)
  and pushed to the phone with `adb install`. The phone never compiles anything. GitHub
  Actions is used for **one narrow thing only**: pre-building the heavy Linux rootfs asset
  (see [Step 2](#step-2--get-the-runtime-assets-one-time)), because that part needs an
  arm64 Linux machine. That asset changes rarely.

**Two ways to build & install the APK** — they do the same thing, pick whichever you like:

- **Android Studio (GUI, clicking)** — easiest for a first-timer; this guide is written
  around it.
- **Terminal (`adb` / `./gradlew`)** — faster once you know it, and how the app is actually
  built and tested during development. Shown as a "⚡ Faster: terminal" note.

---

## What you need

- A computer (macOS or Windows).
- An **Android phone**, arm64 (virtually all are). Both older phones (Snapdragon / Android
  9–13) and recent ones that enable **arm64 heap pointer tagging (TBI)** are supported. The
  **Solana Seeker** (MediaTek MT6878 / Android 16) is the primary on-device test target and
  runs cleanly. (Tagging used to break the sandbox; we now ship a proot build that handles
  it — see [Troubleshooting](#troubleshooting).)
- A USB cable to connect the phone.
- ~12 GB free disk space (Android Studio + SDK, the app's bundled ~1 GB Linux image, plus a
  debug APK that lands around ~480 MB because it carries that image).

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

## Step 2 — Get the runtime assets (one time)

The app bundles a small Linux world inside the APK. Two things go under
`surfaces/android/app/src/main/assets/` (paths from the repo root):

```
rootfs-arm64.tar        (~1 GB: an Ubuntu/glibc rootfs with node + claude/codex installed)
agentnet-server.tar     (small: our localhost node server + the React web UI it serves)
```

…and the proot runtime goes under `surfaces/android/app/src/main/jniLibs/arm64-v8a/` as
native libraries:

```
libproot.so             (the Android-native proot binary)
libloader.so            (proot's ELF loader; libloader32.so for 32-bit)
libtalloc.so            (proot's libtalloc dependency)
libandroid-shmem.so     (proot's shmem shim)
```

> **Why jniLibs and not assets/?** proot's files are executable ELF. Bundling them loosely
> under `assets/` made **Google Play Protect REJECT the install** on some devices. Shipping
> them under `jniLibs/` (named `lib*.so`) makes the OS extract them into the app's native
> library dir, where ELF is expected and stays executable, which clears the rejection. The
> on-device behavior is identical. (The versioned `libtalloc.so.2` ships as `libtalloc.so`
> because `jniLibs` only packages `lib*.so`; the app recreates the `libtalloc.so.2` soname
> with a symlink at runtime.)

These are **not in git** (too large — `.gitignore` excludes them). **Check if they're
already there first** — if you got this folder from someone who already built it, you can
skip this step.

```bash
# from the repo root
ls -la surfaces/android/app/src/main/assets/ surfaces/android/app/src/main/jniLibs/arm64-v8a/
```
If both are populated, jump to [Step 3](#step-3--open-the-project). Otherwise build them.

> Only **`rootfs-arm64.tar`** truly needs an arm64 Linux machine (it installs glibc
> binaries for the phone's architecture). The rest are cheap and arch-independent. In
> practice you build the rootfs **once** and then almost never touch it again — day-to-day
> you only rebuild `agentnet-server.tar` (see
> [Day-to-day](#day-to-day-rebuild-after-a-code-change)).

### Option A — download from GitHub Actions (easiest)

Builds the assets in the cloud; you just download the result. No build tools needed locally.

1. Repo on GitHub → **Actions** tab.
2. **android-assets** workflow → **Run workflow** → ABI = `arm64` → **Run**.
3. Wait ~10–15 min (it builds the Linux image under arm64 emulation).
4. When green, open the run → **Artifacts** → download **android-assets-arm64** (`.zip`).
5. Unzip. It contains `assets/` and `jniLibs/` at the top level — copy both into
   `surfaces/android/app/src/main/` (so the tars land in `.../main/assets/` and the
   `lib*.so` files in `.../main/jniLibs/arm64-v8a/`).

> **Old artifact?** If the zip has a `proot-arm64/` folder (instead of `jniLibs/`), it was
> built before proot moved to jniLibs. Don't hand-rename it — copy that `proot-arm64/`
> folder into `surfaces/android/app/src/main/assets/` and run
> `bash surfaces/android/scripts/relayout-proot.sh`, which converts it to the layout the app
> expects (and removes the loose ELF from assets). The proot bytes are identical, so no
> rebuild is needed. Re-running the workflow also produces a current-format artifact.

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
This writes the tars into `assets/` and the proot `lib*.so` files into `jniLibs/arm64-v8a/`.
(Note: it rebuilds the ~1 GB rootfs every time, ~10–15 min. If all you changed is app/web
code, you don't need this — use the lighter server-bundle refresh in
[Day-to-day](#day-to-day-rebuild-after-a-code-change).)

---

## Step 3 — Open the project

⚠️ **Important:** open the **`surfaces/android`** folder inside the repo, **not** the
repo root, or Android Studio won't recognize it.

1. Open **Android Studio** → **Open** (not "New Project").
2. Select the **`surfaces/android`** folder:
   - macOS: `/Users/<you>/.../AgentNet/surfaces/android`
   - Windows: `C:\Users\<you>\...\AgentNet\surfaces\android`
3. Click **Open**. If asked, click **Trust Project**.
4. Android Studio runs a **Gradle sync** (bottom status bar). First time it downloads
   Gradle + dependencies — **let it finish** (a few minutes, needs internet). Wait for
   "Gradle sync finished."

The package id is `com.iqlabs.agentnet`. The build pins `targetSdk = 28` on purpose (the
legacy W^X exemption that lets the app execute node and the proot guest's binaries from
app storage — see the [pointer-tagging note](#troubleshooting)). `minSdk = 24`,
`compileSdk = 35`.

### Optional — configure Google Drive OAuth for testing

Android-native Drive login does not need a client secret or a hardcoded client ID in the
APK. In Google Cloud Console, create/register an **Android** OAuth client for package
`com.iqlabs.agentnet` and the signing certificate SHA-1 for the build you install.

For the debug APK, Android Studio can show the SHA-1 under Gradle `signingReport`, or run:

```bash
cd surfaces/android
./gradlew signingReport
```

If Google returns `UNREGISTERED_ON_API_CONSOLE`, that package name + SHA-1 pair is missing
from Google Cloud Console.

Only the desktop/browser fallback path needs a public OAuth client ID, supplied via
`surfaces/android/local.properties` (or the `GOOGLE_CLIENT_ID` env var; the build reads
either):

```properties
googleOAuthClientId=YOUR_PUBLIC_CLIENT_ID
```

Do **not** put a Google OAuth client secret in `local.properties`, `BuildConfig`, app
assets, or Kotlin/TypeScript source. APK contents are visible to anyone who installs the
app. If Google returns `client_secret is missing`, the configured client ID belongs to a
secret-required desktop/web flow and Android login will not complete without changing to a
no-secret mobile/native OAuth path.

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
SM02G4061961289     device
```
- `unauthorized` → re-check the "Allow USB debugging?" dialog on the phone.
- Nothing listed → try another cable/port (some are charge-only).

---

## Step 5 — Build and run on the phone

### Android Studio (GUI — recommended for first time)

1. Top toolbar: in the **device dropdown** (next to the green ▶ Run button), select your
   phone. The dropdown next to it should say **app**.
2. Click the green **▶ Run** button (Mac: **Ctrl+R**, Windows: **Shift+F10**).
3. It builds the APK and installs it. **The first build is slow** (it packages the ~1 GB
   Linux image into a ~480 MB APK) — give it a few minutes.
4. The app launches on the phone automatically.

### ⚡ Faster: terminal (how it's actually built and tested)

From the `surfaces/android` folder:

```bash
# build the APK
./gradlew assembleDebug          # macOS / Linux
gradlew.bat assembleDebug        # Windows

# install it (-r reinstalls over the existing app, keeping its data;
#  -s <serial> picks a specific device if more than one is plugged in)
~/Library/Android/sdk/platform-tools/adb install -r app/build/outputs/apk/debug/app-debug.apk

# launch it
~/Library/Android/sdk/platform-tools/adb shell monkey -p com.iqlabs.agentnet -c android.intent.category.LAUNCHER 1
```

The APK lands at `app/build/outputs/apk/debug/app-debug.apk`.

---

## Day-to-day: rebuild after a code change

You almost never rebuild the 1 GB rootfs. The two things that change while developing are
the **node server** (`surfaces/localhost`) and the **web UI** (`surfaces/webview`) — both
are plain JavaScript, so they build on macOS/Windows in seconds with no Docker and no
arm64. They're shipped together as `agentnet-server.tar`.

The app is built to make this cheap: the installer re-extracts **only** the server bundle
when the APK ships a changed one (it fingerprints the bundle), and leaves the heavy rootfs
untouched. So after editing surface code, the loop is:

```bash
# from the repo root — rebuild + repack just the server bundle
pnpm --filter agentnet-localhost build
pnpm --filter agentnet-webview build

STAGE=surfaces/android/.assets-build/server-bundle
rm -rf "$STAGE" && mkdir -p "$STAGE/webview"
cp -R surfaces/localhost/dist/. "$STAGE/"
cp -R surfaces/webview/dist/.   "$STAGE/webview/"
tar -cf surfaces/android/app/src/main/assets/agentnet-server.tar -C "$STAGE" .

# then rebuild + reinstall the APK (or just hit ▶ in Android Studio)
cd surfaces/android
./gradlew assembleDebug
~/Library/Android/sdk/platform-tools/adb install -r app/build/outputs/apk/debug/app-debug.apk
```

(This is exactly step 3 of `surfaces/android/scripts/build-assets.sh`, run on its own. If
you only changed **Kotlin** shell code, skip the repack entirely and just rebuild the APK.)

---

## What happens on first launch

1. A splash with the IQ logo appears (it gently pulses while booting). The first run
   **unpacks the Linux image** ("Setting up your environment… first launch only") — a few
   minutes. Later launches are quick.
2. **Connect your wallet** — tap Connect, approve in your wallet app (e.g. Phantom) via the
   Solana Mobile Wallet Adapter. The wallet is remembered for silent reconnect on later
   launches.
3. **Connect your agent** — connect Claude (or Codex). The login link opens in your
   external browser; sign into your subscription, then paste the code back into the app.
4. You're in the chat — message the agent and it runs on **your** subscription, on the
   phone.

A couple of things you'll meet the first time you use the agent in the background:

- **Battery optimization prompt** — when you first enable background execution, the app
  asks to be exempted from battery optimization so Android doesn't kill the server
  mid-session. Allow it for long runs. (Asked once.)
- **Notifications** — Android 13+ asks for notification permission. It's used for the
  "approval needed" alert when the app is backgrounded (approve/reject right from the
  notification).

---

## Troubleshooting

- **Stuck on the splash / "Taking longer than usual":** check the logs —
  ```bash
  ~/Library/Android/sdk/platform-tools/adb logcat -d | grep -E "AgentNet/|\[server\]"
  ```
- **`proot error: ptrace(PEEKDATA): I/O error` / `Bad address` (sandbox never starts):**
  This is **arm64 pointer tagging (TBI)**, *not* a kernel/SoC defect. Root cause proven
  on-device (Solana Seeker, MediaTek MT6878, Android 16):
  - bionic tags heap pointers with a top-byte tag (e.g. `0xb4...`). proot reads/writes the
    guest's memory with `PTRACE_PEEKDATA`/`POKEDATA`, and the kernel **rejects a tagged
    address with `EIO`** (`process_vm_readv` strips the tag, ptrace does not). proot's
    first `execve` then fails with `EFAULT` → server never comes up.
  - Verified: the *identical* address reads fine untagged but returns `EIO` with a `0xb4`
    top byte. Older phones (Snapdragon / Android 9) never tagged → they worked.
  - **Not the fix:** `android:allowNativeHeapPointerTagging="false"` (tried — only affects
    the app's own process; the fork+exec'd proot re-enables tagging, and targetSdk=28 may
    ignore it anyway; targetSdk is pinned at 28 for the W^X execve exemption).
  - **The fix (shipped):** we bundle the **Termux proot** built with the `process_vm`
    accelerator (`process_vm_readv`/`writev`), which **strips the top-byte tag** and so never
    hits the tagged-`PEEKDATA` path. `build-assets.sh` fetches it (plus `libtalloc.so.2` +
    `libandroid-shmem.so`, which it dynamically links), and `ServerManager.kt` points
    `LD_LIBRARY_PATH` at those libs. Verified on-device: the Seeker reaches
    `server ready (HTTP 200)`.
  - Full investigation notes live in the comment in
    `surfaces/android/app/src/main/AndroidManifest.xml`.
- **`ENOSYS: uv_cwd` / `getcwd() failed` (node dies right after proot starts):** do **not**
  set `PROOT_NO_SECCOMP`. With seccomp acceleration on (the default), `getcwd` runs in the
  kernel and never touches the SELinux-restricted `/proc`; turning it off forces proot to
  translate every syscall and breaks `getcwd`. `ServerManager.kt` already keeps seccomp on
  and `cd`s into a readable dir before exec'ing proot. (If a guide or older README tells you
  to set `PROOT_NO_SECCOMP=1`, that advice is stale.)
- **App "doesn't recognize me" / `EADDRINUSE` after backgrounding and reopening:** an older
  build orphaned the guest `node` so a zombie kept the port. Fixed — rebuild/reinstall the
  current APK if you still see it.
- **Phone not detected (`adb devices` empty):** different USB cable/port; re-accept the
  "Allow USB debugging" prompt; toggle USB debugging off/on.
- **Gradle sync fails on Open:** make sure you opened **`surfaces/android`**, not the repo
  root.
- **Build fails on missing assets / `rootfs-arm64.tar`:** you skipped
  [Step 2](#step-2--get-the-runtime-assets-one-time).
- **Reset the app to a clean state** (re-do onboarding, re-unpack the Linux image):
  ```bash
  ~/Library/Android/sdk/platform-tools/adb shell pm clear com.iqlabs.agentnet
  ```
