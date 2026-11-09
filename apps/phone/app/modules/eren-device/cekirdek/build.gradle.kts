import org.gradle.api.tasks.testing.logging.TestExceptionFormat
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    // Uygulamanın Android derlemesiyle aynı 2.2 çizgisi: çekirdek kaynakları orada da derlenir.
    kotlin("jvm") version "2.2.20"
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
        allWarningsAsErrors.set(true)
    }
}

dependencies {
    // Ana kaynak kümesinde bağımlılık yok: yalnız Kotlin stdlib (TASARIM.md, genel kural 2).
    testImplementation(platform("org.junit:junit-bom:6.1.3"))
    testImplementation("org.junit.jupiter:junit-jupiter-api")
    testRuntimeOnly("org.junit.jupiter:junit-jupiter-engine")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

// `-Pbirim=Kapi` ya da `-Pbirim=Kanonik,PlanHash`: yalnız sözleşme, o birimlerin dosyaları ve
// sahteler derlenir. Paralel yazımda başka birimin yarım dosyası bu birimin testini kırmasın diye.
val birimler: List<String> = providers.gradleProperty("birim").orNull
    ?.split(',')
    ?.map { it.trim() }
    ?.filter { it.isNotEmpty() }
    .orEmpty()

if (birimler.isNotEmpty()) {
    require(birimler.all { Regex("^[A-Z][A-Za-z]*$").matches(it) }) { "birim adı geçersiz" }
    kotlin.sourceSets.getByName("main").kotlin.include(
        listOf("**/Portlar.kt", "**/Sozlesme.kt") + birimler.map { "**/$it*.kt" },
    )
    kotlin.sourceSets.getByName("test").kotlin.include(
        listOf("**/Sahte*.kt") + birimler.map { "**/$it*Test.kt" },
    )
}

// `-Pcikti=build-Kapi`: eşzamanlı koşan agent'lar aynı build/ dizinini paylaşıp birbirini
// kilitlemesin diye derleme çıktısı proje kökü altında bu dizine alınır. Verilmezse build/.
providers.gradleProperty("cikti").orNull?.let { ad ->
    require(Regex("^[A-Za-z0-9_-]+$").matches(ad)) { "cikti adı geçersiz (yalnız A-Za-z0-9_-)" }
    layout.buildDirectory.set(layout.projectDirectory.dir(ad))
}

tasks.test {
    useJUnitPlatform()
    // Depo kökü: protocol/ kaynaklarını ve vektörlerini okuyan testler için.
    systemProperty("eren.depo", rootDir.resolve("../../../..").canonicalPath)
    // Node testinin doğrulayacağı giden çerçeveler buraya yazılır (TASARIM.md, birlesim).
    systemProperty("eren.cikti", layout.buildDirectory.file("cikti.jsonl").get().asFile.path)
    testLogging {
        events("failed", "skipped")
        exceptionFormat = TestExceptionFormat.FULL
    }
}
