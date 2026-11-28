# Tasarım kaynağının lisans notları

Bu klasördeki prototip (`ajanda-yonler.html`, `parca/`) yazı tiplerini Google Fonts üzerinden bağlantıyla
yükler (`test/yap.mjs` satır 11, `ajanda-yonler.html` satır 3); yazı tipi dosyası depoda yoktur.
Uygulamaya gömülecek dosyaları indirmek ayrı bir iştir; aşağıdaki bilgiler o iş için kaynaktır.
Bilgiler google/fonts deposundaki `METADATA.pb` dosyalarından alındı (2026-11-27).

| Yazı tipi | Prototipte nerede | Tasarımcı | Lisans | Telif satırı | Kaynak depo | Eksenler | Alt kümeler |
|---|---|---|---|---|---|---|---|
| **Bricolage Grotesque** | Sahne yönünün tek yazı tipi (`--f-s`, `parca/10-kabuk.css` satır 6) | Mathieu Triay | SIL Open Font License 1.1 | Copyright 2022 The Bricolage Grotesque Project Authors | https://github.com/ateliertriay/bricolage | opsz 12–96, wdth 75–100, wght 200–800 | latin, latin-ext, vietnamese |
| Archivo | Kabuk ve Cetvel yönü (`--f-c`, satır 5) | Omnibus-Type | SIL Open Font License 1.1 | Copyright 2020 The Archivo Project Authors | https://github.com/Omnibus-Type/Archivo | wdth 62–125, wght 100–900 | latin, latin-ext, vietnamese |
| Barlow | Tabela yönü gövde yazısı (`--f-tm`, satır 8) | Jeremy Tribby | SIL Open Font License 1.1 | Copyright 2017 The Barlow Project Authors | https://github.com/jpt/barlow | durağan ağırlıklar | latin, latin-ext, vietnamese |
| Barlow Condensed | Tabela yönü kanat yazısı (`--f-t`, satır 7) | Jeremy Tribby | SIL Open Font License 1.1 | Copyright 2017 The Barlow Project Authors | https://github.com/jpt/barlow | durağan ağırlıklar | latin, latin-ext, vietnamese |

## Android uygulamasına girecek olan

- Yalnız **Bricolage Grotesque** gerekir (Sahne yönü). Değişken dosya (`opsz,wdth,wght`) tek dosyayla
  550 ve 650 gibi ara ağırlıkları da verir; `minSdk 26` olduğu için Compose `FontVariation` ile kullanılabilir.
  Ayrıntı: `SAHNE.md` "Yazı" bölümü.
- Cetvel'den alınan mezura saat seçicisi Sahne'ye taşınırken Archivo'nun dar kesimi (`font-stretch:62%`)
  yerine Bricolage Grotesque kullanılır (önerimiz; `SAHNE.md` "Etkileşimler"). Archivo ve Barlow'u
  uygulamaya gömmek gerekmez.
- `latin-ext` alt kümesi Türkçe harfleri (ı, İ, ş, ğ, ç, ö, ü) kapsar; prototipin ekran görüntülerinde
  bu harfler Bricolage Grotesque ile çizilmiş görünüyor (`goruntu/1-bugun-acik.png`).

## Uygulamaya gömülen varlıklar

| Ad | Dosya | Kaynak | Biçim | Boyut | sha256 | Tasarımcı | Lisans | Telif | Lisans metni |
|---|---|---|---|---|---|---|---|---|---|
| Bricolage Grotesque (gömülü) | `apps/ajanda/android/app/src/main/res/font/bricolage_grotesque.ttf` | google/fonts deposu, `ofl/bricolagegrotesque` | Değişken eksenler opsz/wdth/wght | 408.496 bayt | `413e7357809ddd12fd80a96a8a396de0e401638d4acd3cb3e37532f0472ac682` | Mathieu Triay | SIL OFL 1.1; ayrılmış yazı tipi adı yok; dosya değiştirilmedi | Copyright 2022 The Bricolage Grotesque Project Authors | `app/src/main/res/raw/ofl_bricolage_grotesque.txt`; uygulamada Ayarlar > Açık kaynak lisansları ekranında gösterilir |

## Uygulamanın açık kaynak lisansları ekranı

Uygulama, içerdiği bütün açık kaynak bileşenlerin listesini ve lisans metinlerini Ayarlar > "Açık kaynak
lisansları" ekranında gösterir (`ekran/sahne/ekranlar/KatmanYerTutuculari.kt`, `LISANS_METINLERI`; sırayla
aşağıdaki beş dosya). Liste derleme çıktısından üretildi: Gradle `releaseRuntimeClasspath` bağımlılık ağacı
ve Rust çekirdeğinin `cargo tree -e normal,no-proc-macro` ağacı. **Bağımlılık değişince liste yeniden
üretilmelidir**; bu belge yalnız özetidir, sürümlerin kesin kaynağı `acik_kaynak_bilesenleri.txt`'dir.

| Dosya (`apps/ajanda/android/app/src/main/res/raw/`) | İçerik |
|---|---|
| `acik_kaynak_bilesenleri.txt` | Bileşen listesi, lisanslara göre gruplu (1–6 aşağıdaki tabloda); çift lisanslılarda seçilen lisans yazılı; MPL ve MIT bileşenlerinin kaynak adresleri |
| `lisans_apache_2_0.txt` | Apache License 2.0 tam metni (bir kez; Apache grubundaki bütün bileşenler için) |
| `lisans_mpl_2_0.txt` | Mozilla Public License 2.0 tam metni |
| `lisans_mit_zlib.txt` | MIT ve zlib bileşenlerinin her birinin kendi lisans dosyası, telif satırıyla, olduğu gibi |
| `ofl_bricolage_grotesque.txt` | Bricolage Grotesque'in OFL 1.1 metni (yukarıdaki gömülü varlık) |

| Lisans | Bileşenler | Not |
|---|---|---|
| **Apache License 2.0** | AndroidX (activity, annotation, arch.core, autofill, collection, Compose animation/foundation/runtime/ui 1.11.4, concurrent-futures, core, customview-poolingcontainer, documentfile, dynamicanimation, emoji2, graphics-path, interpolator, legacy-support-core-utils, lifecycle 2.9.4, loader, localbroadcastmanager, navigationevent, print, profileinstaller, savedstate, startup-runtime, tracing, transition, versionedparcelable, window); Guava listenablefuture; OkHttp 4.12.0; Okio 3.6.0; JetBrains annotations; Kotlin stdlib 2.2.20; kotlinx-coroutines 1.9.0; kotlinx-serialization-core 1.7.3; JSpecify | Metin: `lisans_apache_2_0.txt` |
| Apache License 2.0 (seçimli) | **JNA 5.17.0** (LGPL 2.1+ ya da Apache 2.0; Apache seçildi). Rust çekirdeği `libajanda_cekirdek.so`: Rust standart kitaplığı ve anyhow, bitflags, camino, cargo-platform, cfg-if, equivalent, errno, fallible-iterator, fallible-streaming-iterator, fastrand, getrandom, hashbrown, hashlink, heck, indexmap, itoa, libc, linux-raw-sys, once_cell, rustix, semver, serde, serde_core, serde_json, smallvec, static_assertions, tempfile, thiserror | Hepsi "MIT OR Apache-2.0" türü çift lisanslı; listede her birinin yanında "burada Apache-2.0 seçildi" yazar |
| **Mozilla Public License 2.0** | uniffi, uniffi_core, uniffi_pipeline 0.32.2; Public Suffix List (OkHttp içinde, `publicsuffixes.gz`) | Değiştirilmeden kullanıldı; MPL'nin istediği kaynak adresleri listede (uniffi-rs `v0.32.2` etiketi, publicsuffix.org). Metin: `lisans_mpl_2_0.txt` |
| **MIT** | bytes 1.12.2, cargo_metadata 0.23.1, libsqlite3-sys 0.40.0, memchr 2.8.3 (Unlicense OR MIT; MIT seçildi), rusqlite 0.43.0, zmij 1.0.23, libffi (JNA'nın `libjnidispatch.so`'su içinde) | Her birinin telif satırı ve metni ayrı: `lisans_mit_zlib.txt` |
| **zlib** | foldhash 0.2.0 | Metin: `lisans_mit_zlib.txt` |
| Kamu malı | SQLite 3.54.1 (libsqlite3-sys içinde gömülü) | Lisans metni yok; https://sqlite.org/copyright.html |
| **SIL OFL 1.1** | Bricolage Grotesque | Metin: `ofl_bricolage_grotesque.txt` |

- Apache 2.0 ve MPL 2.0 metinleri her bileşen için yinelenmez: lisans metni tektir, bileşenler listede
  adlarıyla durur. MIT ve zlib'de telif satırı bileşene özgü olduğu için her birinin kendi dosyası konur.
- Uygulamanın kendi kodu bu tabloya girmez. Testte görünürlük: `SahneEtkilesimTest.lisansEkraniButunBilesenleriGosterir`.

## OFL 1.1'in uygulama için gerektirdikleri

- Yazı tipi uygulamayla birlikte dağıtılabilir, ticari uygulamada da kullanılabilir.
- Lisans metni (OFL.txt) ve telif satırı yazı tipiyle birlikte dağıtılmalıdır; uygulamada "Açık kaynak
  lisansları" ekranında ya da varlık klasöründe lisans dosyasıyla gösterilmesi yeterlidir.
- Yazı tipi tek başına satılamaz. Değiştirilirse (alt küme çıkarmak da değiştirmektir) "Reserved Font
  Name" varsa o ad kullanılamaz; Bricolage Grotesque'in `OFL.txt` dosyasında ayrılmış ad olup olmadığı
  dosya indirilirken kontrol edilmelidir.

## Öteki varlıklar

- Çizimler (`cizim/*.svg`, prototipte `parca/50-ortak.js` `RESIM`) ve simgeler (`IK`) bu prototip için
  elle yazılmış SVG yollarıdır; dış kaynaktan alınmadı.
- "Fotoğraf" yerine geçen görseller (`FOTO`) de elle çizilmiş SVG'dir; gerçek fotoğraf yoktur.
- Ekran görüntüleri (`goruntu/*.png`) prototipin başsız Chrome'da alınmış kareleridir; örnek verinin
  tamamı uydurmadır.
