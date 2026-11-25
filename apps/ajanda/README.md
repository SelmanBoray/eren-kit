# Ajanda — Rust çekirdek + Kotlin kabuk

Yalnız Android. İş mantığı Rust'ta (`cekirdek/`), ekranlar ve Android API'leri Kotlin'de
(`android/`). Köprü: [UniFFI](https://mozilla.github.io/uniffi-rs/) 0.32 (proc-macro, Kotlin+JNA).
Sözleşme: `apps/phone/docs/AJANDA.md`. **Mimari, iş bölümü ve ikinci dalganın iş parçaları: [MIMARI.md](MIMARI.md).**

Durum (ilk dalga): veri modeli, JSON çözme/kodlama ve şema doğrulaması yazıldı; `ajanda-mesaj.json`'ın
173 vektörünün tamamı Rust'ta TypeScript ile aynı sonucu veriyor. Köprü yüzeyi, geri çağrı arayüzleri,
depo şeması ve modül sınırları hazır; kurallar, eşitleme motoru, alarm planı ve Kotlin parçaları
`Yazilmadi` döner (MIMARI.md "İkinci dalga").

## Klasör düzeni

```
apps/ajanda/
  Cargo.toml, Cargo.lock      Rust çalışma alanı (release profili: opt-level=s, LTO)
  MIMARI.md                   iş bölümü, modül/paket düzeni, iş parçaları, ortak dosyalar
  cekirdek/                   ajanda-cekirdek -> libajanda_cekirdek.so
    src/model/                veri modeli + JSON + şema (zod anlamıyla)
    src/kural/                servisle aynı sonucu veren saf kurallar
    src/depo/                 SQLite (rusqlite, bundled) + göçler
    src/motor/                kanal durum makinesi (sans-IO), kuyruk, sorgular, alarm planı
    src/kopru/                KÖPRÜ YÜZEYİ: #[uniffi::export] yalnız burada; geri çağrı arayüzleri
    tests/vektorler.rs        dil bağımsız vektör düzeneği (kendi main'i)
    uniffi.toml               Kotlin paketi: dev.eren.ajanda.cekirdek
  uniffi-bindgen/             bağlama üreticisi (çalışma alanının kendi ikilisi)
  android/                    Gradle projesi (AGP 8.13, Kotlin 2.2.20, Gradle 8.14)
    app/build.gradle.kts      cargo ndk + uniffi-bindgen görevleri burada
    app/src/main/kotlin/dev/eren/ajanda/
      CekirdekErisimi.kt      süreç başına tek Cekirdek; kabukları bağlar
      kabuk/ kimlik/ ag/ alarm/ ekran/   (MIMARI.md "Kotlin")
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
- Vektörler `apps/phone/protocol/vektorler/` altından okunur (kopya yok); başka yer için `AJANDA_VEKTOR_DIZINI`.

## Komutlar

```sh
# Rust çekirdek testleri + vektör tablosu (apps/ajanda içinden)
cargo test -p ajanda-cekirdek
cargo test -p ajanda-cekirdek --test vektorler     # yalnız vektörler

# arm64 APK + Kotlin köprü testi (apps/ajanda/android içinden)
./gradlew assembleDebug testDebugUnitTest          # Windows: .\gradlew.bat ...

# Emülatör için x86_64 de ekle
./gradlew assembleDebug -Pajanda.abiler=arm64-v8a,x86_64

# Arayüz açmadan köprü (yalnız debug APK):
adb shell am broadcast -f 0x20 -n dev.eren.ajanda/.KopruAlici   # logcat etiketi: Ajanda
```

Vektör düzeneği her koşuda bölüm tablosu basar: GEÇTİ / KALDI / BEKLİYOR (yazılmamış kural ve sahibi).
KALDI ya da vektör dosyasında tanınmayan bölüm varsa çıkış 1'dir.

## Köprüye dokunmak

Köprü yüzeyi (`cekirdek/src/kopru/`, `hata.rs`) ve model ilk dalgada dondurulmuştur; değişiklik
MIMARI.md "Ortak dosyalar" sırasıyla yapılır. Kalıp:

1. İş mantığı köprüden bağımsız modüle (`kural/`, `motor/`, `depo/`), `cargo test` ile sınanır.
2. Kotlin'e açılan yöntem `kopru/mod.rs`'te `#[uniffi::export] impl Cekirdek` içinde ince kabuktur:
   `self.calistir(|motor, ortam, etkiler| ...)`. Yan etki `Etkiler`'e yazılır, kilit dışında uygulanır.
3. Rust'ın Kotlin'den bir şey istemesi `kopru/kabuklar.rs`'deki arayüzlerden biriyle; uygulaması
   Kotlin'de sahibinin dosyasında, Rust testleri için `kopru/sahte.rs`'te.
4. Gradle bağlamaları kendisi üretir; Kotlin adları camelCase olur (`durum_degistir` -> `durumDegistir`,
   kurucu `Cekirdek.ac(...)`, sayım değerleri `KayitTuru.RANDEVU`, `u64` -> `ULong`).

Kurallar: çekirdek çağrıları eşzamanlıdır (SQLite, Keystore) — ana iş parçacığında çağırma; geri
çağrılardan çekirdeğe eşzamanlı yeniden girme. `panic = "unwind"` kalmalı (panik Kotlin'e istisna
olarak gelir). `strip = "debuginfo"` kalmalı (bindgen `UNIFFI_META` sembollerini .so'dan okur; APK'ya
koyarken AGP ayrıca soyar). `uniffi` sürümü çalışma alanında sabit; `uniffi-bindgen` aynı sürümü kullanır.
R8 (`isMinifyEnabled`) açılırsa JNA, OkHttp ve `dev.eren.ajanda.cekirdek.**` için keep kuralı gerekir.

## Ölçümler (bu makine, Gradle daemon sıcak, indirme önbellekleri dolu)

| | süre |
|---|---|
| Soğuk Rust NDK derlemesi (arm64, release) | ~33 s (iskelette ~26-28 s) |
| `assembleDebug testDebugUnitTest` (Rust değişmiş, sıcak) | ~26 s |
| `cargo test` (değişiklik sonrası / değişiklik yok) | ~2.9 s / 0.5 s |

APK (debug, yalnız arm64, temiz paketleme): 3.80 MB (iskelet 2.89 MB). `libajanda_cekirdek.so`
1.94 MB (iskelet 1.70 MB; +0.24 MB: serde_json, model, köprü yüzeyi); OkHttp + Okio ~0.55 MB (dex).
Not: AGP'nin artımlı paketlemesi kaldırılan bağımlılığın girdilerini APK'da bırakabilir; boyut
ölçmeden önce `app/build/intermediates/apk` ve `app/build/outputs/apk`'yı sil.
