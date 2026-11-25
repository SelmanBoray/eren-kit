import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    // Ana uygulamanın (dev.eren.app) kimliğiyle çakışmaz.
    namespace = "dev.eren.olcum.ajanda"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.eren.olcum.ajanda"
        minSdk = 26
        // Asıl uygulama da güncel hedefle çıkacağı için ölçüm aynı hedef SDK ile yapılır
        // (kesin alarm izni ve arka plan kuralları hedef SDK'ya bağlı).
        targetSdk = 36
        versionCode = 1
        versionName = "0.1"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    sourceSets {
        getByName("main").java.srcDirs("src/main/kotlin")
        getByName("test").java.srcDirs("src/test/kotlin")
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}
