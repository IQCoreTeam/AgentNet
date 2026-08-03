// Root build file — plugin versions only; the real config is in app/build.gradle.kts.
// AGP 8.9.1 is the official minimum for compileSdk 36 (developer.android.com/build/releases/
// about-agp); bumped from 8.7.3 for the targetSdk 36 move (issue #130). Kotlin 2.1.0 is kept:
// it predates the official AGP 8.9 test matrix but builds cleanly — revisit only if a real
// incompatibility shows up (a Kotlin bump would drag Gradle/AGP majors along with it).
plugins {
    id("com.android.application") version "8.9.1" apply false
    id("com.android.asset-pack") version "8.9.1" apply false
    id("org.jetbrains.kotlin.android") version "2.1.0" apply false
}
