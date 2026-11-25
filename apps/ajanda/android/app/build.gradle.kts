import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import javax.inject.Inject

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// ---------------------------------------------------------------------------
// Rust çekirdeği bağlantısı
//   apps/ajanda/            <- Rust çalışma alanı (Cargo.toml)
//   apps/ajanda/android/    <- bu Gradle projesi
// Her varyant için: cargo ndk (.so) -> uniffi-bindgen (Kotlin) -> APK.
// JVM birim testleri için: cargo build (masaüstü kitaplığı) -> JNA ile yüklenir.
// ---------------------------------------------------------------------------
val rustKoku: File = rootProject.projectDir.parentFile
val MIN_SDK = 26
val NDK_SURUMU = "28.2.13676358"
val androidAbiler: List<String> = providers.gradleProperty("ajanda.abiler").getOrElse("arm64-v8a")
    .split(",").map { it.trim() }.filter { it.isNotEmpty() }
val KITAPLIK_ADI = "ajanda_cekirdek"

fun rustKaynakAgaci() = fileTree(rustKoku) {
    include("Cargo.toml", "Cargo.lock", "cekirdek/**", "uniffi-bindgen/**")
}

/** `cargo ndk` ile Rust çekirdeğini Android ABI'leri için derler; çıktı: <cikti>/<abi>/lib*.so */
abstract class CargoNdkDerle @Inject constructor(private val exec: ExecOperations) : DefaultTask() {
    @get:InputFiles @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val rustKaynaklari: ConfigurableFileCollection
    @get:Input abstract val abiler: ListProperty<String>
    @get:Input abstract val minSdk: Property<Int>
    @get:Input abstract val ndkSurumu: Property<String>
    @get:Internal abstract val ndkDizini: DirectoryProperty
    @get:Internal abstract val calismaAlani: DirectoryProperty
    @get:OutputDirectory abstract val cikti: DirectoryProperty

    @TaskAction
    fun derle() {
        val hedef = cikti.get().asFile
        hedef.deleteRecursively()
        hedef.mkdirs()
        val ndk = ndkDizini.get().asFile
        require(ndk.isDirectory) { "NDK bulunamadı: $ndk (ANDROID_HOME ya da local.properties sdk.dir; NDK ${ndkSurumu.get()})" }
        exec.exec {
            workingDir = calismaAlani.get().asFile
            environment("ANDROID_NDK_HOME", ndk.absolutePath)
            commandLine(
                listOf("cargo", "ndk") +
                    abiler.get().flatMap { listOf("-t", it) } +
                    listOf("-P", minSdk.get().toString(), "-o", hedef.absolutePath) +
                    listOf("build", "--release", "-p", "ajanda-cekirdek")
            )
        }
    }
}

/** Derlenmiş .so'daki UniFFI üst verisinden Kotlin bağlamalarını üretir (çalışma alanındaki uniffi-bindgen ile). */
abstract class UniffiKotlinUret @Inject constructor(private val exec: ExecOperations) : DefaultTask() {
    @get:InputDirectory @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val jniKitapliklari: DirectoryProperty
    @get:InputFiles @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val ayarlar: ConfigurableFileCollection
    @get:Input abstract val kaynakAbi: Property<String>
    @get:Input abstract val kitaplikAdi: Property<String>
    @get:Internal abstract val calismaAlani: DirectoryProperty
    @get:OutputDirectory abstract val cikti: DirectoryProperty

    @TaskAction
    fun uret() {
        val hedef = cikti.get().asFile
        hedef.deleteRecursively()
        hedef.mkdirs()
        val so = jniKitapliklari.get().asFile.resolve("${kaynakAbi.get()}/lib${kitaplikAdi.get()}.so")
        exec.exec {
            workingDir = calismaAlani.get().asFile
            commandLine(
                "cargo", "run", "-q", "-p", "uniffi-bindgen", "--",
                "generate", "--library", so.absolutePath,
                "--language", "kotlin", "--out-dir", hedef.absolutePath, "--no-format",
            )
        }
    }
}

/** JVM birim testleri için çekirdeği bu makinenin kitaplığı olarak derler (target/debug). */
abstract class CargoMasaustuDerle @Inject constructor(private val exec: ExecOperations) : DefaultTask() {
    @get:Internal abstract val calismaAlani: DirectoryProperty

    @TaskAction
    fun derle() {
        exec.exec {
            workingDir = calismaAlani.get().asFile
            commandLine("cargo", "build", "-p", "ajanda-cekirdek")
        }
    }
}

android {
    // Ana uygulama dev.eren.app, ölçüm uygulaması dev.eren.olcum.ajanda: çakışmaz.
    namespace = "dev.eren.ajanda"
    compileSdk = 36
    ndkVersion = NDK_SURUMU

    defaultConfig {
        applicationId = "dev.eren.ajanda"
        minSdk = MIN_SDK
        targetSdk = 36
        versionCode = 1
        versionName = "0.1"
        // JNA aar'ı dört ABI taşır; yalnız Rust'ı derlediklerimizi pakete al.
        ndk { abiFilters += androidAbiler }
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
        getByName("debug").java.srcDirs("src/debug/kotlin")
        getByName("test").java.srcDirs("src/test/kotlin")
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

val ndkYolu = androidComponents.sdkComponents.sdkDirectory.map { it.dir("ndk/$NDK_SURUMU") }

androidComponents {
    onVariants { varyant ->
        val ad = varyant.name.replaceFirstChar { it.uppercase() }
        // Rust her varyantta release profiliyle derlenir (debug .so çok büyük ve yavaş).
        val rustDerle = tasks.register<CargoNdkDerle>("rust${ad}Derle") {
            rustKaynaklari.from(rustKaynakAgaci())
            abiler.set(androidAbiler)
            minSdk.set(MIN_SDK)
            ndkSurumu.set(NDK_SURUMU)
            ndkDizini.set(ndkYolu)
            calismaAlani.set(rustKoku)
        }
        val kotlinUret = tasks.register<UniffiKotlinUret>("uniffi${ad}KotlinUret") {
            jniKitapliklari.set(rustDerle.flatMap { it.cikti })
            ayarlar.from(rustKoku.resolve("cekirdek/uniffi.toml"))
            kaynakAbi.set(androidAbiler.first())
            kitaplikAdi.set(KITAPLIK_ADI)
            calismaAlani.set(rustKoku)
        }
        varyant.sources.jniLibs?.addGeneratedSourceDirectory(rustDerle, CargoNdkDerle::cikti)
        varyant.sources.java?.addGeneratedSourceDirectory(kotlinUret, UniffiKotlinUret::cikti)
    }
}

val rustMasaustuDerle = tasks.register<CargoMasaustuDerle>("rustMasaustuDerle") {
    calismaAlani.set(rustKoku)
}

tasks.withType<Test>().configureEach {
    dependsOn(rustMasaustuDerle)
    // Yalnız Rust değişince de testler yeniden koşsun (masaüstü kitaplığı Gradle girdisi değil).
    inputs.files(rustKaynakAgaci()).withPathSensitivity(PathSensitivity.RELATIVE)
    // Üretilen bağlamalar kitaplığı JNA ile adıyla yükler; masaüstü kitaplığını buradan bulur.
    systemProperty("jna.library.path", rustKoku.resolve("target/debug").absolutePath)
}

dependencies {
    // UniFFI Kotlin bağlamaları JNA kullanır. aar: Android .so'ları; jar: masaüstü JVM testleri.
    implementation("net.java.dev.jna:jna:5.17.0@aar")
    // K2: WebSocket istemcisi (Android'de yerleşik yok). Soket Kotlin'de, protokol Rust'ta (sans-IO).
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation("net.java.dev.jna:jna:5.17.0")
    testImplementation("junit:junit:4.13.2")
}
