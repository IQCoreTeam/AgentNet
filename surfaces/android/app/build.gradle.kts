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
        // targetSdk 35 is our standard. We never direct-execve guest binaries; proot loads them via
        // its own loader mmap, which survives the targetSdk 35 SELinux W^X policy. Verified on device
        // (Seeker / Android 16 + pointer tagging, a worst-case target): node, codex and claude all
        // ran with no exec/mmap denials, so no linker-exec routing is needed. This is the same
        // approach Play-Store Termux uses to run a proot-distro glibc userland at target 29+. minSdk
        // stays 24 so older phones still install; appId + signing are unchanged, so shipping this is
        // an in-place upgrade over the older targetSdk-28 build and never wipes the user's rootfs.
        targetSdk = 35
        // Play requires a strictly increasing versionCode for every upload to a track. CI passes
        // the next number via ANDROID_VERSION_CODE; local/debug builds fall back to 1 unchanged.
        versionCode = (providers.environmentVariable("ANDROID_VERSION_CODE").orNull
            ?: localProperties.getProperty("versionCode"))?.toInt() ?: 1
        versionName = providers.environmentVariable("ANDROID_VERSION_NAME").orNull
            ?: localProperties.getProperty("versionName", "0.1.0")
        buildConfigField(
            "String",
            "GOOGLE_OAUTH_CLIENT_ID",
            "\"${googleOAuthClientId.replace("\\", "\\\\").replace("\"", "\\\"")}\""
        )
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

    // Release signing = the Play "upload key". Fully env-driven so the private key NEVER lives in
    // this public repo: CI decodes the keystore from a secret and exports these vars; locally you
    // can put the same values in local.properties. Unlike the debug keystore, the passwords ARE
    // secrets, so there is no hardcoded fallback. When none of this is set (every normal build),
    // no release signing config is created and a release build stays unsigned — nothing else
    // changes. Google re-signs the uploaded AAB with the Play-managed app key (Play App Signing),
    // so this upload key can be rotated without breaking installs.
    val releaseStoreFile = (providers.environmentVariable("ANDROID_RELEASE_KEYSTORE").orNull
        ?: localProperties.getProperty("releaseKeystore"))?.let { rootProject.file(it) }
    if (releaseStoreFile != null && releaseStoreFile.exists()) {
        signingConfigs {
            create("release") {
                storeFile = releaseStoreFile
                storePassword = providers.environmentVariable("ANDROID_RELEASE_STORE_PASSWORD").orNull
                    ?: localProperties.getProperty("releaseStorePassword")
                keyAlias = providers.environmentVariable("ANDROID_RELEASE_KEY_ALIAS").orNull
                    ?: localProperties.getProperty("releaseKeyAlias")
                keyPassword = providers.environmentVariable("ANDROID_RELEASE_KEY_PASSWORD").orNull
                    ?: localProperties.getProperty("releaseKeyPassword")
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
            // Signed only when the release upload key is configured (CI/Play builds); otherwise
            // findByName returns null and the release build stays unsigned, same as before.
            signingConfig = signingConfigs.findByName("release")
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
