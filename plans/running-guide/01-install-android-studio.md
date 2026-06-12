# 1. Install Android Studio

Android Studio is the official tool for building Android apps. It also brings the **Android
SDK** (which includes `adb`, the tool that talks to your phone). Installing Android Studio
gets you everything you need.

You only do this **once**.

---

## macOS

1. Go to **https://developer.android.com/studio** and click **Download Android Studio**.
2. Accept the terms, download the `.dmg`.
3. Open the `.dmg` and **drag the Android Studio icon into Applications**.
4. Open **Android Studio** from Applications (allow it past Gatekeeper if macOS warns:
   right-click → Open the first time).
5. The **Setup Wizard** runs on first launch:
   - Choose **Standard** install.
   - Accept the SDK license agreements.
   - Let it download the SDK components (a few minutes).
6. Done. You'll land on the **Welcome to Android Studio** screen.

**Where the SDK / adb live on Mac** (you'll need this later for the terminal path):
```
~/Library/Android/sdk/platform-tools/adb
```

---

## Windows

1. Go to **https://developer.android.com/studio** and click **Download Android Studio**.
2. Accept the terms, download the `.exe`.
3. Run the installer. Click **Next** through the defaults (keep "Android Virtual Device"
   checked — harmless).
4. Launch **Android Studio**.
5. The **Setup Wizard** runs on first launch:
   - Choose **Standard** install.
   - Accept the SDK license agreements.
   - Let it download the SDK components (a few minutes).
6. Done — you'll see the **Welcome to Android Studio** screen.

**Where the SDK / adb live on Windows:**
```
C:\Users\<YourName>\AppData\Local\Android\Sdk\platform-tools\adb.exe
```

---

## Verify it worked

On the Welcome screen, you don't need to do anything yet — if you got here, you're set.

**Optional sanity check (terminal):** open a terminal (macOS Terminal / Windows
PowerShell) and run:

```bash
# macOS
~/Library/Android/sdk/platform-tools/adb version

# Windows (PowerShell)
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" version
```

If it prints `Android Debug Bridge version ...`, you're good.

> 💡 **Tip:** to type just `adb` instead of the full path, add platform-tools to your PATH.
> Optional — the guide always shows the full path so you don't have to.

---

Next: **[02-open-and-run.md](02-open-and-run.md)** — open the project and run the app.
