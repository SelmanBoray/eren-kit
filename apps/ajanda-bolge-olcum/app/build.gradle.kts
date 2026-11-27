import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    // Ana uygulamanın ve alarm ölçüm uygulamasının kimliğiyle çakışmaz.
    namespace = "dev.eren.olcum.bolge"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.eren.olcum.bolge"
        // Tek hedef telefon Android 16; 31 altı dallar yazılmadı (arka plan konumu, FUSED sağlayıcı).
        minSdk = 31
        // Arka plan konumu ve PendingIntent kuralları hedef SDK'ya bağlı: asıl uygulamanın hedefiyle ölçülür.
        targetSdk = 36
        versionCode = 1
        versionName = "0.1"
        // Yerel kod yok; filtre yalnız hedefin açıkça arm64 olduğunu belgeler.
        ndk { abiFilters += "arm64-v8a" }
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
    // Kol 1: Play Hizmetleri geofencing ve birleşik konum. Tek çalışma zamanı bağımlılığı.
    implementation("com.google.android.gms:play-services-location:21.3.0")
    testImplementation("junit:junit:4.13.2")
}
