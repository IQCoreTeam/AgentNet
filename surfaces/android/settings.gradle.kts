// AgentNet Android shell — a Kotlin/Gradle project living beside the JS surfaces.
// pnpm ignores this dir (no package.json), so the monorepo and the Android build
// don't collide. The shell's job: extract a proot-distro Ubuntu (glibc) into app
// storage, run our localhost node bundle + the official claude/codex CLIs inside it,
// and point a WebView at 127.0.0.1 — the on-device form of the vscode extension host.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

@Suppress("UnstableApiUsage")
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "AgentNet"
include(":app")
// Play Asset Delivery pack holding the heavy Ubuntu rootfs tar (kept out of the base
// module, which has a 500MB Play compressed-download cap). See rootfs/build.gradle.kts.
include(":rootfs")
