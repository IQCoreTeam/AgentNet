# Refresh & Clean-Reinstall the AgentNet Android App

How to pull a fresh, known-good build from CI and reinstall it on the phone — including a
**full clean reinstall** when the on-device state is stale or broken.

Use the main [android.md](android.md) for first-time setup (Android Studio, USB debugging,
OAuth). This file is the **refresh runbook** for when the app is already installed.

> `adb` below is `~/Library/Android/sdk/platform-tools/adb` on macOS
> (`%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe` on Windows). `gh` is the GitHub CLI.

- [Get a signed APK from CI (recommended)](#get-a-signed-apk-from-ci-recommended)
- [When to use this](#when-to-use-this)
- [What a reinstall refreshes (and what it does not)](#what-a-reinstall-refreshes-and-what-it-does-not)
- [Debug APK source policy](#debug-apk-source-policy)
- [Build the APK locally (alternative)](#build-the-apk-locally-alternative)
- [Step 1 — Get a fresh payload from CI](#step-1--get-a-fresh-payload-from-ci)
- [Step 2 — Drop the payload into the source tree](#step-2--drop-the-payload-into-the-source-tree)
- [Step 3 — Build the APK](#step-3--build-the-apk)
- [Step 4 — Reinstall (quick vs. full clean)](#step-4--reinstall-quick-vs-full-clean)
- [Step 5 — Launch and verify](#step-5--launch-and-verify)
- [Troubleshooting the refresh](#troubleshooting-the-refresh)

---

## Get a signed APK from CI (recommended)

This is the easiest, most reliable path and **needs no keystore and no local asset juggling**.
The `android-apk` workflow builds a **team-signed** APK from current `main`: it rebuilds the
server bundle fresh (so Google Drive uses the **native** flow — no "Use secure browsers" block)
and signs with the **team key** (so the SHA-1 is registered — no "not registered" error). It
reuses the heavy rootfs from the latest `android-assets` run, so a UI change builds in ~5 min
(no QEMU).

> One-time setup (a maintainer with the keystore, done once): add a repo secret
> `ANDROID_DEBUG_KEYSTORE_B64` = `base64 -i surfaces/android/agentnet-debug.keystore`. The
> signed APK never contains the private key, so the artifact is safe to share.

```bash
# 1) Trigger the build (needs a prior successful android-assets run for the rootfs;
#    run `gh workflow run android-assets.yml -f abi=arm64` once if there isn't one).
gh workflow run android-apk.yml -f abi=arm64

# 2) Watch it, then download the signed APK artifact.
gh run list --workflow=android-apk.yml -L 1
gh run watch <run-id> --exit-status
gh run download <run-id> -n agentnet-apk-arm64 -D ./apk

# 3) Install. If switching from a differently-signed build, uninstall first (re-onboards).
adb install -r ./apk/app-debug.apk
# or:  adb uninstall com.iqlabs.agentnet && adb install ./apk/app-debug.apk
```

No `gh`? Use the **Actions** tab: **android-apk** → **Run workflow** → ABI `arm64`, then
download **agentnet-apk-arm64** from the finished run.

**When to re-run what:**

- **UI / server / Kotlin change** → run **`android-apk`** only (fast, reuses the rootfs).
- **rootfs deps change** (Ubuntu / node / claude / codex) → run **`android-assets`** once, then
  `android-apk`.

Only build locally (below) if you specifically need to iterate without CI **and** you hold the
shared keystore.

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

## Debug APK source policy

Do **not** install random debug APKs from another chat, machine, or old local build when
testing AgentNet Android. Debug APKs are easy to rebuild, and stale ones are the source of
most confusing failures:

- A stale `agentnet-server.tar` can fall back to web OAuth and trigger Google's
  `Error 403: disallowed_useragent`.
- A bundle built without a complete `pnpm install` can boot-crash with
  `Cannot find module 'ws'`.
- An APK signed with a different debug keystore can fail Drive auth with
  `UNREGISTERED_ON_API_CONSOLE` unless that key's SHA-1 is registered.

Use one of these trusted sources instead:

1. **Download the signed APK from the `android-apk` CI workflow** — it's built from current
   `main`, server bundle fresh (native Drive flow), and signed with the team key. No local
   keystore needed. See [Get a signed APK from CI](#get-a-signed-apk-from-ci-recommended).
2. Build the APK yourself from current `main`, using the fresh `android-assets-arm64` CI
   artifact. Sign with the shared debug keystore **only if you were handed it out-of-band** —
   it is not in the repo (see [Google Drive sign-in & the shared debug key](#google-drive-sign-in--the-shared-debug-key-read-this)).
   Without it your build signs with your own key, which can't use the team Drive OAuth client.
3. If someone sends an APK directly, treat it as a team handoff artifact only if they also
   provide the git commit SHA, the `android-assets` run id, and the signing SHA-1. Verify the
   signing SHA-1 before installing:

```bash
cd surfaces/android
./gradlew :app:signingReport
# For a received APK, use Android SDK build-tools:
# ~/Library/Android/sdk/build-tools/<version>/apksigner verify --print-certs app-debug.apk
```

The Google Cloud Console registration covers the team only when everyone signs with the
same shared debug keystore. If the shared key is present, the debug SHA-1 should be the
team-registered value:

```text
4A:DD:0A:EC:AB:F5:55:CE:85:5C:DE:02:ED:08:82:8C:04:1A:EC:E6
```

If your build shows a different SHA-1, either install the shared keystore first or register
that SHA-1 separately as an Android OAuth client for `com.iqlabs.agentnet`.

---

## Build the APK locally (alternative)

Use this only if you need to iterate without CI **and** you hold the shared keystore (otherwise
your build signs with your own key and can't use the team Drive OAuth — see
[Google Drive sign-in](#google-drive-sign-in--the-shared-debug-key-read-this)). Most people
should use [Get a signed APK from CI](#get-a-signed-apk-from-ci-recommended) instead.

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

## Google Drive sign-in & the shared debug key (read this)

Native Google Drive login only works if the APK's signing SHA-1 is registered for
`com.iqlabs.agentnet` in Google Cloud Console. The team registered **one** shared debug
keystore's SHA-1 so a single registration covers everyone who signs with that key:

```text
4A:DD:0A:EC:AB:F5:55:CE:85:5C:DE:02:ED:08:82:8C:04:1A:EC:E6
```

**The shared keystore is NOT in this repo and cannot be.** This is a **public** repo, and the
keystore holds a **private signing key** — committing it would let anyone sign apps with the
team identity and abuse the team's Drive OAuth client. It is `.gitignore`'d
(`surfaces/android/agentnet-debug.keystore`), and the SHA-1 above is only a *fingerprint* —
you cannot rebuild the key from it. So `git clone` / `git pull` never brings the key.

What this means in practice:

- **Clone the repo and build locally → you CANNOT test the team Google Drive.** Without the
  shared keystore file, `build.gradle.kts` falls back to your machine's own
  `~/.android/debug.keystore`, so your APK has a *different* SHA-1 that isn't registered. Drive
  login fails ("not registered for this Android build" / `UNREGISTERED_ON_API_CONSOLE`).
  Everything else — wallet, Claude/Codex, chat — still works.
- **The distributed / production build works.** It's signed with the shared key (by whoever
  holds the file, or by CI), so its SHA-1 is the registered one and Drive works there.
- **Want Drive on your own local build? Use YOUR OWN key.** Build with your machine's default
  debug keystore, read its SHA-1 with `cd surfaces/android && ./gradlew :app:signingReport`,
  and register that SHA-1 as your **own** Android OAuth client for `com.iqlabs.agentnet` in
  Google Cloud Console. Then your local build does Drive login under your own client.

If you *do* have the shared keystore file (handed to you **out-of-band** — a private channel,
never the repo): drop it at `surfaces/android/agentnet-debug.keystore` and the build uses it
automatically (verify with `./gradlew :app:signingReport`). It is a **debug** key only
(standard `android` / `androiddebugkey` password — the *file* is the access control); **never**
use it for a Play Store / release build. Switching keys changes the signature, so the next
install over an existing app fails with a mismatch: `adb uninstall com.iqlabs.agentnet` first,
then install (re-onboards).

> Durable fix for "other machines can't sign with the team key": sign in **CI** (store the
> keystore as a base64 GitHub Actions secret) and ship the **signed APK as a CI artifact**, so
> nobody needs the file locally. Until that's set up, the key must be passed out-of-band.

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
- **Google Drive: "not registered for this Android build" / `UNREGISTERED_ON_API_CONSOLE`:**
  your APK is signed with your machine's own debug key (the shared team keystore isn't in the
  repo — see [Google Drive sign-in & the shared debug key](#google-drive-sign-in--the-shared-debug-key-read-this)),
  so its SHA-1 isn't registered. **In local testing you can't use the team Drive** with your
  own key. Either (a) get the shared keystore out-of-band and rebuild, or (b) register **your
  own** SHA-1 (`cd surfaces/android && ./gradlew signingReport`) as your own **Android** OAuth
  client for `com.iqlabs.agentnet` to test Drive under your own client. The distributed /
  production build (shared key) is unaffected.
- **Stuck on the splash after a clean reinstall:** the first run is unpacking the rootfs (a
  few minutes). Watch `adb logcat -d | grep -E "AgentNet/|\[server\]"`.
