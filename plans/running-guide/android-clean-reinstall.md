# Refresh & Clean-Reinstall the AgentNet Android App

How to pull a fresh, known-good build from CI and reinstall it on the phone — including a
**full clean reinstall** when the on-device state is stale or broken.

Use the main [android.md](android.md) for first-time setup (Android Studio, USB debugging,
OAuth). This file is the **refresh runbook** for when the app is already installed.

> `adb` below is `~/Library/Android/sdk/platform-tools/adb` on macOS
> (`%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe` on Windows). `gh` is the GitHub CLI.

- [When to use this](#when-to-use-this)
- [What a reinstall refreshes (and what it does not)](#what-a-reinstall-refreshes-and-what-it-does-not)
- [Step 1 — Get a fresh payload from CI](#step-1--get-a-fresh-payload-from-ci)
- [Step 2 — Drop the payload into the source tree](#step-2--drop-the-payload-into-the-source-tree)
- [Step 3 — Build the APK](#step-3--build-the-apk)
- [Step 4 — Reinstall (quick vs. full clean)](#step-4--reinstall-quick-vs-full-clean)
- [Step 5 — Launch and verify](#step-5--launch-and-verify)
- [Troubleshooting the refresh](#troubleshooting-the-refresh)

---

## When to use this

- The bundled server crashes / the UI never loads (e.g. a stale `agentnet-server.tar`, or a
  bundle built without deps so it dies with `Cannot find module 'ws'`).
- Google Drive login shows **"Use secure browsers"** / "Access blocked" — a stale server
  bundle that still uses the web-OAuth path instead of the native one.
- You want everyone on the **same canonical build** (the CI artifact).
- The `proot` / `rootfs` runtime assets changed and you need them on the device.

---

## What a reinstall refreshes (and what it does not)

This is the single most important thing to understand, because a plain `install -r` silently
leaves the heavy rootfs untouched:

| Asset | Where it lives | Refreshed by `adb install -r`? |
|---|---|---|
| **proot** (`jniLibs/.../lib*.so`) | extracted to `nativeLibraryDir` by the OS at install | **Yes** — always, on any install |
| **server bundle** (`agentnet-server.tar`) | extracted to app storage by the installer | **Yes** — re-extracted when its content hash changes |
| **rootfs** (`rootfs-arm64.tar`, ~1 GB) | extracted to app storage on first run only | **No** — gated by the `.installed-v2` marker |

So if you changed **server/UI/proot only**, `install -r` is enough. If you changed the
**rootfs** (new Ubuntu / node / claude / codex), you must force a first-run extraction with
`pm clear` or `adb uninstall` — and that **wipes onboarding** (wallet, Claude/Codex login,
Drive connection). See [Step 4](#step-4--reinstall-quick-vs-full-clean).

---

## Step 1 — Get a fresh payload from CI

CI builds the runtime payload (`rootfs`, `agentnet-server.tar`, and the `proot` jniLibs). It
does **not** build the APK — you do that locally in [Step 3](#step-3--build-the-apk).

```bash
# trigger the build (~10-15 min; builds the arm64 rootfs under emulation)
gh workflow run android-assets.yml -f abi=arm64

# find the run id, then watch it to completion
gh run list --workflow=android-assets.yml -L 1
gh run watch <run-id> --exit-status

# download + unzip the artifact (contains assets/ and jniLibs/ at the top level)
gh run download <run-id> -n android-assets-arm64 -D ./ci-artifact
```

No `gh`? Use the Actions tab in GitHub: **android-assets** → **Run workflow** → ABI `arm64`,
then download **android-assets-arm64** from the finished run's **Artifacts** and unzip it.

> If a build fails, read the failing step: `gh run view <run-id> --log-failed | tail -40`.

---

## Step 2 — Drop the payload into the source tree

From the **repo root**, copy the artifact's two folders into
`surfaces/android/app/src/main/` (these paths are gitignored and never committed):

```bash
rm -rf surfaces/android/app/src/main/jniLibs
cp -R ci-artifact/jniLibs                       surfaces/android/app/src/main/jniLibs
cp    ci-artifact/assets/rootfs-arm64.tar        surfaces/android/app/src/main/assets/
cp    ci-artifact/assets/agentnet-server.tar     surfaces/android/app/src/main/assets/
```

Sanity check — `assets/` holds the two tars, `jniLibs/arm64-v8a/` holds the `lib*.so`:

```bash
ls -la surfaces/android/app/src/main/assets/ surfaces/android/app/src/main/jniLibs/arm64-v8a/
```

---

## Step 3 — Build the APK

```bash
cd surfaces/android
./gradlew assembleDebug          # macOS / Linux
gradlew.bat assembleDebug        # Windows
```

The APK lands at `app/build/outputs/apk/debug/app-debug.apk` (~480 MB; it carries the rootfs).

---

## Step 4 — Reinstall (quick vs. full clean)

### A. Quick refresh — keeps onboarding

Refreshes the **server bundle + proot** but **not** the rootfs. Use when you only changed
server/UI/proot code.

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### B. Full clean reinstall — fresh rootfs, re-onboard

Forces a first-run extraction so the **new rootfs** is unpacked. **This wipes the app's data**
(wallet, Claude/Codex login, Drive connection) — you will re-onboard.

```bash
adb shell pm clear com.iqlabs.agentnet            # drop all app data + the install marker
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

(Equivalent: `adb uninstall com.iqlabs.agentnet && adb install app/build/outputs/apk/debug/app-debug.apk`.)

---

## Step 5 — Launch and verify

```bash
adb logcat -c
adb shell monkey -p com.iqlabs.agentnet -c android.intent.category.LAUNCHER 1
# After a full clean reinstall the first launch unpacks the ~1 GB rootfs — give it a
# few minutes before checking.
adb logcat -d | grep -E "server ready \(HTTP 200\)|CANNOT LINK|Cannot find module|ERR_MODULE"
```

Healthy output is a single `server ready (HTTP 200)` and **no** `CANNOT LINK` /
`Cannot find module`. You can also confirm the guest is alive:

```bash
adb shell 'ps -A | grep -E "libproot.so|node"'   # expect libproot.so with a node child
```

Optional — check native Google Drive auth without touching the UI (loopback bridge on 4318):

```bash
adb forward tcp:4318 tcp:4318
curl -s http://127.0.0.1:4318/google-drive/status   # {"connected":true} when working
adb forward --remove tcp:4318
```

---

## Troubleshooting the refresh

- **`Cannot find module 'ws'` (or any module) / server crash on boot:** the server bundle was
  built without its dependencies installed, so deps weren't inlined. Rebuild from a proper CI
  artifact (CI runs `pnpm install --frozen-lockfile` first), or locally run `pnpm install`
  then rebuild the bundle before packing `agentnet-server.tar`.
- **`CANNOT LINK EXECUTABLE ... libtalloc.so.2 not found`:** the proot soname symlink is stale
  (it points at the previous install's native dir). The app recreates it on launch; if it
  persists, do a [full clean reinstall](#b-full-clean-reinstall--fresh-rootfs-re-onboard).
- **Google Drive: "Use secure browsers" / "Access blocked" / `Error 403: disallowed_useragent`:**
  the server bundle is old and falls back to the **web** OAuth flow (`flowName=GeneralOAuthFlow`)
  inside the WebView, which Google blocks. Refresh to a current server bundle — it uses the
  **native** Android flow (no WebView) and the error disappears. (Tell-tale: the error's
  `client_id=` is the web client from `local.properties`, not the Android OAuth client.)
- **Google Drive: "not registered for this Android build":** the APK's signing SHA-1 is not
  registered for `com.iqlabs.agentnet` in Google Cloud Console. Get this build's SHA-1 with
  `cd surfaces/android && ./gradlew signingReport`, then add an **Android** OAuth client for
  that package + SHA-1. Note that each machine's debug keystore has a **different** SHA-1, so
  each developer must register their own — unless the project pins a shared debug
  `signingConfig` so every build shares one SHA-1.
- **Stuck on the splash after a clean reinstall:** the first run is unpacking the rootfs (a
  few minutes). Watch `adb logcat -d | grep -E "AgentNet/|\[server\]"`.
