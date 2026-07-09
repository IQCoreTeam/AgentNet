// Shell skeleton adapted from AnyClaw (friuns2/openclaw-android-assistant, MIT) — the
// generic native-shell mechanics (WebView + ProcessBuilder + targetSdk=28 + assets).
// Everything OpenClaw/Codex-specific is NOT copied; our engine is the official
// claude/codex CLIs installed inside a proot-distro Ubuntu (see ServerManager).
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val localProperties = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}
val googleOAuthClientId =
    providers.environmentVariable("GOOGLE_CLIENT_ID").orNull
        ?: localProperties.getProperty("googleOAuthClientId", "")

android {
    namespace = "com.iqlabs.agentnet"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.iqlabs.agentnet"
        minSdk = 24
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField(
            "String",
            "GOOGLE_OAUTH_CLIENT_ID",
            "\"${googleOAuthClientId.replace("\\", "\\\\").replace("\"", "\\\"")}\""
        )
    }

    // targetSdk is a per-flavor dimension, not a fixed value, so one codebase ships both the
    // proven legacy engine and the modern-target variant we are bringing up. applicationId and
    // signing stay IDENTICAL across flavors, so switching flavor is an in-place upgrade that
    // never wipes the user's rootfs — do not add an applicationIdSuffix.
    flavorDimensions += "execTarget"
    productFlavors {
        create("legacy") {
            dimension = "execTarget"
            // targetSdk 28 is load-bearing here: Android 10+ (target 29+) enforces SELinux W^X,
            // which blocks executing binaries extracted into app data. We run node + the proot
            // guest's binaries from app storage, so the legacy flavor keeps the pre-29 exemption.
            // Termux (F-Droid) pins the same target for the same reason. This is today's shipping
            // behavior; keep it unchanged until the modern flavor proves out.
            targetSdk = 28
            buildConfigField("String", "EXEC_TARGET", "\"legacy\"")
        }
        create("modern") {
            dimension = "execTarget"
            // targetSdk 35 gives up the W^X exemption on purpose. This flavor is where we bring up
            // a modern target: guest exec will be routed through /system/bin/linker64 (the
            // system_linker_exec technique) so app-storage binaries still run. Until that routing
            // lands, guest binaries are EXPECTED to fail to exec at runtime here — that failure is
            // the signal we are probing for, not a regression.
            targetSdk = 35
            buildConfigField("String", "EXEC_TARGET", "\"modern\"")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    // Shared debug signing: every machine (and CI, later) that has the shared keystore
    // produces the SAME signing SHA-1, so ONE Android OAuth client (package + SHA-1) covers
    // everyone for Google Drive login — no per-developer registration. The keystore is NOT in
    // this public repo (.gitignore'd); each dev drops the file distributed out-of-band at
    // surfaces/android/agentnet-debug.keystore. If it's absent, the build falls back to the
    // machine's own ~/.android/debug.keystore (build still works, just with that SHA-1). The
    // password is the standard debug password — not a secret; the file is the secret.
    val sharedDebugKeystore = rootProject.file("agentnet-debug.keystore")
    if (sharedDebugKeystore.exists()) {
        signingConfigs {
            getByName("debug") {
                storeFile = sharedDebugKeystore
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        // proot + its loader/libs ship under jniLibs (as lib*.so) instead of as loose
        // executable ELF in assets/ — that's what stops the Play Protect "executable ELF
        // in assets" REJECT. useLegacyPackaging=true makes the OS EXTRACT them into
        // nativeLibraryDir as real, executable files; the modern default (false) keeps them
        // mmap'd inside the APK, where proot can't be exec'd. So this flag is load-bearing.
        jniLibs {
            useLegacyPackaging = true
        }
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }

    // The proot rootfs tarball and the localhost server bundle ship as assets and must
    // be stored uncompressed so they can be streamed straight to disk on first run.
    androidResources {
        noCompress += listOf("zip", "tar.gz", "tar.xz")
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("com.google.android.material:material:1.12.0")

    // Solana Mobile Wallet Adapter: lets the dApp ask an installed wallet app
    // (Phantom/Solflare/…) to authorize + sign. This is how a mobile WebView connects a
    // wallet — browser-extension injection (window.phantom) doesn't exist here. The ktx
    // artifact pulls in the base clientlib. lifecycle-runtime-ktx gives lifecycleScope to
    // launch the suspend transact(); coroutines-android is its runtime.
    implementation("com.solanamobile:mobile-wallet-adapter-clientlib-ktx:2.0.8")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    // Native Google authorization for Drive access. The APK never ships an OAuth client
    // secret; Google Play services grants short-lived access tokens for approved scopes.
    implementation("com.google.android.gms:play-services-auth:21.6.0")
}
