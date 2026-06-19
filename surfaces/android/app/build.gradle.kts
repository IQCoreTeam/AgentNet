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
        // targetSdk 28 is load-bearing: Android 10+ (target 29+) enforces SELinux W^X,
        // which blocks executing binaries extracted into app data. We run node + the
        // proot guest's binaries from app storage, so we need the legacy exemption.
        // Termux (F-Droid) pins the same target for the same reason.
        targetSdk = 28
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField(
            "String",
            "GOOGLE_OAUTH_CLIENT_ID",
            "\"${googleOAuthClientId.replace("\\", "\\\\").replace("\"", "\\\"")}\""
        )
    }

    buildFeatures {
        buildConfig = true
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
}
