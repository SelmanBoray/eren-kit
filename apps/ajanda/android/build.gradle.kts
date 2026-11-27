// Sürümler gradle/libs.versions.toml'da (AGP 8.13.0, Kotlin 2.2.20, Gradle 8.14).
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.roborazzi) apply false
}
