# Ajanda — Rust çekirdek + Kotlin kabuk (yürüyen iskelet)

Yalnız Android. İş mantığı Rust'ta (`cekirdek/`), ekranlar ve Android API'leri Kotlin'de
(`android/`). Köprü: [UniFFI](https://mozilla.github.io/uniffi-rs/) 0.32 (proc-macro, Kotlin+JNA).
Şu an yalnız köprüyü kanıtlar: Kotlin → Rust, Rust → Kotlin geri çağrısı, Rust içinden gömülü SQLite.

## Klasör düzeni

```
apps/ajanda/
  Cargo.toml, Cargo.lock      Rust çalışma alanı (release profili: opt-level=s, LTO)
  cekirdek/                   ajanda-cekirdek -> libajanda_cekirdek.so
    src/lib.rs                KÖPRÜ YÜZEYİ: yalnız burada #[uniffi::export]
    src/hata.rs               CekirdekHatasi / KabukHatasi (Kotlin'de istisna)
    src/kabuk.rs              Kabuk: Rust'ın Kotlin'i geri çağırdığı arayüz
    src/depo.rs               SQLite (rusqlite, bundled) + göçler; köprüden habersiz
    uniffi.toml               Kotlin paketi: dev.eren.ajanda.cekirdek
  uniffi-bindgen/             bağlama üreticisi (çalışma alanının kendi ikilisi)
  android/                    Gradle projesi (AGP 8.13, Kotlin 2.2.20, Gradle 8.14)
    app/build.gradle.kts      cargo ndk + uniffi-bindgen görevleri burada
    app/src/main/kotlin/dev/eren/ajanda/
      CekirdekErisimi.kt      süreç başına tek Cekirdek (etkinlik/alıcı/iş aynı yoldan)
      kabuk/AndroidKabuk.kt   Kabuk'un Android uygulaması (imza şimdilik SHA-256 yer tutucu)
      KopruKaniti.kt, AnaEkran.kt
    app/src/debug/            yalnız debug: arayüzsüz deneme alıcısı (KopruAlici)
    app/src/test/kotlin/      KopruTest: üretilen bağlamalar + gerçek Rust kitaplığı (JVM)
```

Üretilen dosyalar git'e girmez: `.so` -> `android/app/build/generated/jniLibs/rust<Varyant>Derle/`,
Kotlin bağlamaları -> `android/app/build/generated/java/uniffi<Varyant>KotlinUret/`.

## Gereksinimler ve ortam değişkenleri

- Rust (stable) + hedef `aarch64-linux-android` (emülatör için `x86_64-linux-android`), `cargo-ndk` 4.x.
- Android SDK + NDK **28.2.13676358** (`app/build.gradle.kts` içindeki `NDK_SURUMU`), JDK 17+.
- `ANDROID_HOME` = SDK dizini (ya da git'e girmeyen `android/local.properties` içinde `sdk.dir=...`).
  NDK yolu buradan türetilir ve `cargo ndk`'ya `ANDROID_NDK_HOME` olarak verilir.
- `JAVA_HOME` = JDK. Başka kişisel yol gerekmez.

## Komutlar

```sh
# Rust çekirdek testleri (apps/ajanda içinden)
cargo test -p ajanda-cekirdek

# arm64 APK (apps/ajanda/android içinden) -> app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleDebug            # Windows: .\gradlew.bat assembleDebug

# Kotlin köprü testi: Rust masaüstü kitaplığını (target/debug) derler, JNA ile yükler
./gradlew testDebugUnitTest

# Emülatör için x86_64 de ekle
./gradlew assembleDebug -Pajanda.abiler=arm64-v8a,x86_64

# Arayüz açmadan köprü (yalnız debug APK):
adb shell am broadcast -f 0x20 -n dev.eren.ajanda/.KopruAlici   # logcat etiketi: Ajanda
```

## Köprüye yeni işlev eklemek

1. İş mantığını köprüden bağımsız bir Rust modülüne yaz (`depo.rs` gibi), `cargo test` ile sına.
2. `cekirdek/src/lib.rs` içinde `#[uniffi::export] impl Cekirdek` bloğuna yöntem ekle
   (ya da serbest `#[uniffi::export] fn`). Dönüş `Result<T, CekirdekHatasi>`; köprüden geçen
   yapılar `#[derive(uniffi::Record)]`, sayımlar `#[derive(uniffi::Enum)]`. Yeni hata durumu ->
   `hata.rs`'deki `CekirdekHatasi`'na adlandırılmış alanlı değişken.
3. Rust'ın Kotlin'den bir şey istemesi gerekiyorsa `kabuk.rs`'deki `Kabuk` trait'ine yöntem ekle,
   `AndroidKabuk`'ta ve testlerdeki sahte kabuklarda uygula. Kabuk çağrısını Mutex kilidi dışında yap.
4. Gradle derlemesi bağlamaları kendisi üretir; Kotlin adları camelCase olur
   (`imzala_ve_yaz` -> `cekirdek.imzalaVeYaz(...)`, kurucu `Cekirdek.ac(...)`).
5. `KopruTest`'e bir durum ekle: `./gradlew testDebugUnitTest`.

Kurallar: çekirdek çağrıları eşzamanlıdır (SQLite'a dokunur) — ana iş parçacığında çağırma.
`panic = "unwind"` kalmalı (panik Kotlin'e istisna olarak gelir). `strip = "debuginfo"` kalmalı
(bindgen `UNIFFI_META` sembollerini .so'dan okur; APK'ya koyarken AGP ayrıca soyar).
`uniffi` sürümü çalışma alanında sabit; `uniffi-bindgen` aynı sürümü kullanır.
R8 (`isMinifyEnabled`) açılırsa JNA ve `dev.eren.ajanda.cekirdek.**` için keep kuralı gerekir.

## Ölçümler (2026-11-25, bu makine, Gradle daemon sıcak, indirme önbellekleri dolu)

| | süre |
|---|---|
| Soğuk `assembleDebug` (target/ ve build/ silinmiş) | ~80 s (Rust NDK derlemesi ~26-28 s) |
| Değişiklik yokken `assembleDebug` | ~5 s |
| Yalnız Rust değişince `assembleDebug` | ~3 s (cargo ~1.4 s) |
| Yalnız Kotlin değişince `assembleDebug` | ~4-4.5 s |
| `cargo test` (değişiklik sonrası / değişiklik yok) | ~1.2 s / 0.3 s |
| `testDebugUnitTest` | ~4.5 s |

APK (debug, yalnız arm64): 2.89 MB; `libajanda_cekirdek.so` 1.70 MB (%59, sıkıştırmasız),
JNA `libjnidispatch.so` 0.17 MB. x86_64 eklenince +1.70 MB + 0.12 MB. Her iki .so 16 KB sayfa hizalı.
