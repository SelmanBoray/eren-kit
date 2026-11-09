plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// PC adresi kaynakta tutulmaz: derlemeden önce EREN_KIT_PC_URL (ör. ws://<pc-adresi>:47800/) verilir.
val pcUrl: String = System.getenv("EREN_KIT_PC_URL") ?: "ws://PC_ADRESI_BURAYA:47800/"

android {
    namespace = "dev.eren.deneme"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.eren.deneme"
        minSdk = 30
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "PC_URL", "\"$pcUrl\"")
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            // Ölçüm kodu: küçültme yok, debuggable değil, ayrı anahtar yönetimi yok.
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    lint {
        checkReleaseBuilds = false
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
