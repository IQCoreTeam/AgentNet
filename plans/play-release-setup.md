# Android release runbook — Play (AAB) + Seeker/dApp Store (universal APK)

How to cut and ship an AgentNet Android update (targetSdk 36) to BOTH channels: Google Play
production and the Solana dApp Store / sideload. The per-release procedure comes first because
that is what you repeat; the one-time setup (keys, secrets, Play Console, testers) follows.

READ THIS BEFORE EVERY RELEASE BUILD. No secrets live in this file — keep it that way; it is
tracked in the public repo.

---

## Cutting a release (repeat every update — ship BOTH channels)

Every channel shares ONE versionCode sequence (Play went live at 17 / 0.1.4; the dApp Store
previously ran its own numbers, last 6; unified from 18 / 0.1.5). Next code = highest ever
uploaded anywhere + 1. Bump small and explicit.

### 0. Version bump commit

One-line commit `Version X.Y.Z` editing only the default `versionName` in
`surfaces/android/app/build.gradle.kts` (the single marketing-version source). versionCode
never lives in git — every build receives it via `ANDROID_VERSION_CODE`. Push to main.

### 1. Play — signed AAB (always from CI)

CI force-rebuilds the webview + localhost dists and repacks `agentnet-server.tar` every run,
so a stale local `dist/` can never leak into the AAB (the SpaceBun-divergence class of bug —
this is why local AABs for Play are discouraged).

```bash
gh workflow run android-release.yml --ref main -f abi=arm64 -f version_code=<next>
# wait for green, then:
gh run download <run-id> -n agentnet-aab-arm64
```

Upload `app-release.aab` manually in Play Console -> Production -> new release (uploading
stays a deliberate human step, never automated). Release notes accept locale blocks pasted
as one text: `<en-US>...</en-US><ko-KR>...</ko-KR>`.

### 2. Seeker / dApp Store — universal APK (local build)

The rootfs ships as the `:rootfs` install-time asset pack, and ONLY the bundletool universal
path fuses it back into an installable APK.

**TRAP — `./gradlew assembleRelease` is a dud:** it skips the asset pack and produces a ~8MB
APK with no Linux container. Never ship it; delete any `outputs/apk/release/app-release.apk`
it leaves behind so nobody grabs it later.

```bash
# 1) fresh dists — ALWAYS, or you re-ship whatever stale tar sits in the tree
pnpm --filter agentnet-localhost build && pnpm --filter agentnet-webview build
STAGE="$(mktemp -d)/server-bundle" && mkdir -p "$STAGE/webview"
cp -R surfaces/localhost/dist/. "$STAGE/" && cp -R surfaces/webview/dist/. "$STAGE/webview/"
tar -cf surfaces/android/app/src/main/assets/agentnet-server.tar -C "$STAGE" .

# 2) signed AAB (env-driven signing; the password is the local backup written by
#    surfaces/android/setup-release-signing.sh — it is never in the repo)
cd surfaces/android
ANDROID_RELEASE_KEYSTORE=upload.jks \
ANDROID_RELEASE_STORE_PASSWORD=<pw> ANDROID_RELEASE_KEY_ALIAS=agentnet-upload \
ANDROID_RELEASE_KEY_PASSWORD=<pw> \
ANDROID_VERSION_CODE=<next> ANDROID_VERSION_NAME=X.Y.Z \
./gradlew --no-daemon bundleRelease

# 3) fuse the universal APK (bundletool is on homebrew)
bundletool build-apks --bundle=app/build/outputs/bundle/release/app-release.aab \
  --output=universal.apks --mode=universal \
  --ks=upload.jks --ks-key-alias=agentnet-upload --ks-pass=pass:<pw> --key-pass=pass:<pw>
unzip universal.apks universal.apk    # <- this file is what you upload / sideload
```

**TRAP — bundletool stores the rootfs tar UNCOMPRESSED:** the universal APK comes out at
~1.15GB where the deflate-compressed equivalent is ~541MB (0.1.5 shipped uncompressed; it
works, but doubles the download and the on-device APK footprint). Until this is scripted,
repack before uploading: re-zip everything deflated EXCEPT keep `lib/**/*.so` entries at
their existing methods and `resources.arsc` Stored, then `zipalign -f -P 16 4`, then re-sign
with apksigner + `upload.jks`.

### 3. Verify BOTH artifacts before uploading

```bash
apksigner verify --print-certs universal.apk   # SHA-1 must be 353d80a2d39600782898ce0fb215427d60b9f23c
aapt2 dump badging universal.apk | head -1     # versionCode / versionName as intended
unzip -p universal.apk assets/agentnet-server.tar | tar -t | grep <marker-of-the-new-ui>
keytool -printcert -jarfile app-release.aab | grep SHA1   # same upload-key fingerprint
```

That SHA-1 is the upload key's public cert fingerprint (already inside every shipped APK, so
it is not a secret). Same key across releases = sideload updates install in place over the
existing app, no uninstall, no data wipe.

---

## What is / isn't automated

- Automated (CI): build a **signed release AAB** (targetSdk 36) on demand.
- Manual (you): create the upload key, add the secrets, register Play, upload the AAB to a
  closed track, recruit 12 testers, wait 14 days, apply for production.

Sideloading the debug APK (GitHub `app-debug.apk`) does NOT count toward Play's 14-day / 12-tester
requirement — Play only counts installs that go through the Play closed-testing track.

---

## Step 1 — Generate the upload key (one time, do this locally, keep it forever)

The upload key signs what you send to Play. Google then re-signs with a separate app key it manages
(Play App Signing), so this upload key can be rotated later, but DON'T lose it — losing it means a
support round-trip to reset. Back it up somewhere safe (password manager / encrypted drive).

```bash
keytool -genkeypair -v \
  -keystore agentnet-upload.jks \
  -alias agentnet-upload \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storetype JKS
# It will prompt for a store password and a key password. Use strong ones and SAVE them.
# Name/org fields can be anything (e.g. CN=AgentNet). They are not shown to users.
```

You now have `agentnet-upload.jks`. It is `*.jks` so it's already gitignored — never commit it.

## Step 2 — Add the four GitHub secrets

Repo -> Settings -> Secrets and variables -> Actions -> New repository secret. Add:

| Secret | Value |
|---|---|
| `ANDROID_RELEASE_KEYSTORE_B64` | output of `base64 -i agentnet-upload.jks` (one line) |
| `ANDROID_RELEASE_STORE_PASSWORD` | the store password from Step 1 |
| `ANDROID_RELEASE_KEY_ALIAS` | `agentnet-upload` |
| `ANDROID_RELEASE_KEY_PASSWORD` | the key password from Step 1 |

```bash
base64 -i agentnet-upload.jks | pbcopy   # macOS: copies the b64 blob to paste as the secret
```

## Step 3 — Build the AAB

GitHub -> Actions -> **android-release** -> Run workflow. Leave defaults (arm64; version code =
run number). It produces artifact **agentnet-aab-arm64** containing `app-release.aab`.
Download it. (Needs a live `android-assets` run for the rootfs — same dependency as android-apk.)

Local alternative (if you'd rather not put the key in CI): put the same values in
`surfaces/android/local.properties` (`releaseKeystore=../agentnet-upload.jks`, `releaseStorePassword=...`,
`releaseKeyAlias=...`, `releaseKeyPassword=...`) after staging assets, then
`./gradlew bundleRelease`. Output: `app/build/outputs/bundle/release/app-release.aab`.

## Step 4 — Play Console (one time)

1. Register at play.google.com/console — **$25 one-time**. Personal account is fine (no business
   needed); you'll do identity verification with a government ID. No D-U-N-S for personal accounts.
2. Create app: name, default language, "App" + "Free".
3. Accept the developer agreement + fill the required declarations (content rating, data safety,
   privacy policy URL, target audience). These gate closed testing, so do them early.
4. **Play App Signing**: on your first AAB upload Play will offer to manage the app signing key —
   accept the default (Google-generated). Your upload key (Step 1) stays the thing you sign with.

## Step 5 — Closed testing track + testers

1. Test and release -> Testing -> **Closed testing** -> create a track (e.g. "closed-alpha").
2. Upload `app-release.aab` to a new release on that track. Fix any pre-launch report
   blockers Play flags.
3. Testers list: add a **Google Group** or an email list of tester Gmail addresses. Aim for
   **15-16 people** even though the rule is 12 — you need a buffer against drop-off, because the
   14-day clock wants >=12 opted-in continuously.
4. Copy the **opt-in URL** and send it to testers. Each tester must: open the link -> accept ->
   install the app **from Play** -> keep it and actually open/use it over the 14 days. Google
   tracks real engagement, not just the opt-in click.
5. After **12+ testers opted-in for 14 continuous days**, the Play Console dashboard unlocks
   **Apply for production**.

## Step 6 — Tester recruiting

Pull from the community you've already been telling about AgentNet. Message template
(tune per channel):

> AgentNet early access — need ~15 testers for the Play Store launch. Takes 2 min: tap the link,
> install from Play, keep it on your phone for 14 days and open it now and then. Android 11+ phones.
> Reply with your Gmail and I'll add you. arm64 phones (basically all modern phones).

Double duty: these same testers are the cross-vendor matrix (Pixel / Samsung / Android 13-14) that
gates collapsing the project to modern-only. Ask them to confirm the app reaches the wallet screen
and that claude/codex reply. Any failure -> `adb logcat | grep -iE "avc|AgentNet"`.

---

## Notes / gotchas

- versionCode must strictly increase every upload. CI uses the run number; if you build locally,
  bump `ANDROID_VERSION_CODE` yourself.
- AAB carries arm64 libs only (our rootfs is per-ABI). x86_64 devices/emulators can't install from
  Play — fine for phone testers; note it if a tester reports "not compatible".
- The AAB is never posted to the public `android-latest` release — that stays the sideload APK.
- Do NOT enable minify/R8 shrink (kept off): the WebView + native bridge doesn't benefit and
  shrinking risks breaking reflection into the native/proot layer.
- Signing lineage is per physical device. The Play build is signed with the Play App Signing key
  (Google-managed); the sideload debug APK is signed with the shared debug keystore (SHA-1
  353d80a2 is the UPLOAD key; the installed sideload cert is the debug key 4add0aec). Those are
  different keys, so neither can update the other in place: `adb install -r` across lineages fails
  with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. The only way across is uninstall + reinstall, which
  WIPES app data (the on-device rootfs AND the local wallet key). The Play build is not debuggable,
  so you cannot `run-as` to back its wallet up first. Rule: keep a dogfood device on ONE lineage
  (if you sideload it, never also install the Play build on it), and back up the wallet (seed or
  Drive) BEFORE any cross-lineage switch. Check the installed signer first with
  `adb shell dumpsys package com.iqlabs.agentnet | grep -i signatures`.
- Push-triggered CI gives the two channels DIFFERENT versionCodes (each workflow uses its own run
  number: the AAB from android-release, the sideload APK from android-apk), so they will not share
  one sequence unless you pass `-f version_code=<n>` on a manual dispatch. Harmless because the two
  lineages are separate installs anyway, but do not expect the sideload number to match Play's.
- Sideload smoke-test on a real device: `adb install -r` (or uninstall + install across lineages),
  then wake and UNLOCK the screen (a secure keyguard blocks foreground launch and makes screencap
  come back black), `adb shell svc power stayon true` so it does not re-lock mid-test, then
  `adb shell am start -n com.iqlabs.agentnet/.MainActivity`. First run shows the reworked onboarding
  while the rootfs extracts; confirm the welcome tutorial renders in the device language.
