# Ajanda — uygulama mimarisi

Yalnız Android. Sözleşme: `apps/phone/docs/AJANDA.md` (özellikle "Kanal akışı", "Zaman ve hatırlatma",
"Ekiplerin gereksinimleri → Uygulama"); şemaların başvurusu `apps/phone/protocol/src/ajanda*.ts`.
Bu belge iş bölümünü, modül/paket düzenini ve ikinci dalganın iş parçalarını tanımlar; kod içermez.
Her agent önce "İş bölümü"nü, sonra kendi bölümünü (R1..R4, K1..K4) ve "Ortak dosyalar"ı okur.

## İş bölümü

| Konu | Nerede | Neden / reddedilen |
|---|---|---|
| Kanal protokolü (el sıkışma, telafi, kuyruk) | Rust `motor/kanal.rs`, **sans-IO** | Çerçeve girer (`cerceveGeldi`), yollanacak çerçeve çıkar. Rust'ta soket, iş parçacığı, async yok: UniFFI eşzamanlı kalır, Android yaşam döngüsü Kotlin'de. Reddedilen: Rust'ta tungstenite/tokio (boyut, derleme süresi, Doze ve süreç ölümünü Rust'ın yönetmesi). |
| WebSocket soketi | Kotlin `ag/AjandaSoketi.kt` (OkHttp 4.12) | Android'de yerleşik WebSocket yok. Yalnız `ws://` ve yalnız QR'daki Tailscale adresi (`usesCleartextTraffic`). |
| İmza (Keystore) | Kotlin `kimlik/KeystoreKimlik.kt`, Rust'a `KimlikKabugu` geri çağrısı | Rust el sıkışmada imza metnini kurar (`model::ajanda_kimlik_imza_metni`), baytları `imzala`'ya verir, base64'ler. PC imzası da Kotlin'de doğrulanır (`dogrula`, java.security). Rust'ta kripto yok. Reddedilen: `p256` crate (ikinci kripto yığını, boyut). |
| Duvar saatinden ana çeviri | Kotlin `kabuk/JavaZaman.kt` (java.time), Rust'a `ZamanKabugu` | Sözleşme java.time'ı başvuru alır; telefonun kendi tz verisi. Rust kuralları `kural::AnCevirici` üzerinden çağırır; testler `SabitOfsetCevirici`. Reddedilen: Rust'a tz veritabanı (jiff/chrono-tz: yüzlerce KB ve ikinci doğruluk kaynağı). |
| Alarm planı | Rust `kural/hatirlatma.rs` + `motor/alarm.rs` + `depo/alarmlar.rs` | Plan, kurulu alarm kimlikleri ve kaçırılan hesabı tek yerde, kalıcı. Android'e yalnız "kur(no, an) / iptal(no) / kaçırılanı göster" gider (`AlarmKabugu`). |
| Alarm kurma stratejisi | Kotlin `alarm/AlarmPlanlayici.kt` (tek sınıf) | `apps/ajanda-olcum` sonucuna göre değişebilir (setAlarmClock / setExactAndAllowWhileIdle / muafiyet isteme). Başka hiçbir dosya AlarmManager çağırmaz. |
| Arayüz verisi | Rust sorguları (`liste`, `kayit`, `retListesi`, `gecmis`) + `Gozlemci` | Arayüz çeker; değişiklikte `Gozlemci.degisti(Degisim)` gelir, arayüz kendi iş parçacığına geçip yeniden sorgular. |
| Alıcılar ve arka plan işi | Kotlin, `CekirdekErisimi.al(context)` | Aynı süreç içi tek çekirdek; arayüz gerekmez. Açılış/saat/dilim -> `alarmlariYenidenKur`; alarm -> `alarmCaldi`; periyodik iş -> kısa bağlantı oturumu. |

**Etki kuralı.** `motor` yan etki yapmaz, `Etkiler`'e yazar (çerçeve, kapatma, alarm kur/iptal, kaçırılan,
`Degisim`). `kopru::Cekirdek` motor kilidini bırakınca etki kilidi altında sırayla uygular; böylece
çerçeveler sıra değiştiremez ve geri çağrılar kilit altında çekirdeğe yeniden girip kilitlenemez.
Motor yalnız SQLite işlemi tamamlanmış hale karşılık gelen etkiyi yazar.

**Geri çağrı kuralı.** Hiçbir Kotlin geri çağrısı Cekirdek'i eşzamanlı (aynı iş parçacığında) çağırmaz.
`KimlikKabugu` ve `ZamanKabugu` motor kilidi altında çağrılır: saf ve hızlı olmalı. Çekirdek çağrıları
ana iş parçacığından yapılmaz.

**Bağlantı nesli.** `baglantiAcildi(tasima)` bir nesil (`ULong`) döner; `cerceveGeldi(nesil, ...)` ve
`baglantiKapandi(nesil)` onu taşır. Eski soketin geç olayı yok sayılır; açılış hata verirse taşıma
kaydı silinir (Kotlin soketi kapatır, `baglantiKapandi` çağırmaz).

**Yazılmamış parça.** Saf kural `yazilmadi!` ile panikler (vektör düzeneği "bekliyor" sayar; köprü
`CekirdekHatasi.Yazilmadi`'ya çevirir). Motor/depo yöntemleri `Err(CekirdekHatasi::yazilmadi(...))` döner.
Kotlin iskeletleri `KabukHatasi.Basarisiz("yazılmadı: ...")` fırlatır ya da hiçbir şey yapmaz.

## Rust: `cekirdek/src/`

```
lib.rs              modül listesi, uniffi::setup_scaffolding            [şef]
hata.rs             CekirdekHatasi, KabukHatasi (köprü)                  [şef, dondurulmuş]
model/              veri modeli, JSON, şema (zod anlamıyla)              [1. dalga, dondurulmuş*]
  json.rs           katı nesne okuyucu, JS sayı anlamı, Alan<T> (yok/null/değer), sabit_liste!
  sinirlar.rs       AJANDA_SINIRLARI, AJANDA_SURUMU, çerçeve sınırı
  metin.rs          görünmez tablo, emoji bağlamı, satır/metin kuralları, UTF-16 uzunluk, JS trim
  takvim.rs         tarih/saat/dilim biçimi, gün numarası
  tekrar.rs         Tekrar, tekrar_ornekleri, ornek_gunu_mu, ornek_gunleri_mi
  zaman.rs          AjandaZamani, Hatirlatma, zaman_kurallari, zaman çekirdeği JSON'u
  kayit.rs          AjandaKaydi, kaynak, yazar, örnek, kapalı listeler, kullanici_emri_mi
  islem.rs          AjandaIslem, KayitGovdesi, AjandaDegisiklik, AlanDegisikligi, Parca, Gecmis, ret nedenleri
  cerceve.rs        AjandaYukari/AjandaAsagi, ajanda_asagi_coz, ajanda_yukari_coz (+islem_id), kodla
  eslesme.rs        AjandaEslestirmeQr, imza metni, kanal_kapsamda_mi
  kanonik.rs        kanonik JSON, SHA-256, base64 (bağımlılıksız)
kural/              saf kurallar
  mod.rs            Yazilmadi, AnCevirici, SabitOfsetCevirici                    [şef]
  metin.rs dayanak.rs ornek.rs                                                  [R1]
  birlesim.rs tekil.rs telafi.rs kuyruk.rs esitleme.rs                          [R2]
  hatirlatma.rs                                                                 [R3]
depo/               SQLite
  mod.rs sema.rs gorunen.rs (+ R4'ün ekleyeceği dosyalar)                       [R4]
  alarmlar.rs                                                                   [R3]
motor/              iş mantığı, tek Mutex<Motor>
  mod.rs kanal.rs eslesme.rs islem.rs sorgu.rs                                  [R4]
  alarm.rs                                                                      [R3]
kopru/              Kotlin yüzeyi: #[uniffi::export] YALNIZ burada               [şef, dondurulmuş]
  mod.rs            Cekirdek nesnesi, serbest işlevler, etki uygulama
  kabuklar.rs       KimlikKabugu, ZamanKabugu, Tasima, AlarmKabugu, Gozlemci
  tipler.rs         KayitGorunumu, Sekme, ListeSorgusu, RetGirdisi, Gecmis*, Degisim,
                    BaglantiDurumu, EslesmeDurumu, KurulacakAlarm, HatirlatmaBildirimi, ...
  sahte.rs          (yalnız test) sahte kabuklar: R3/R4 Motor ve Cekirdek testleri için
tests/vektorler.rs  dil bağımsız vektör düzeneği (harness=false)               [şef, dondurulmuş]
```
*Model hatası bulunursa düzeltme şefin sırasıyla yapılır (aşağı bak); model tipleri köprüden de geçer.

Kayıt, zaman, hatırlatma, tekrar ve kapalı listeler `uniffi::Record/Enum` türetir: Kotlin aynı tipi görür
(`AjandaKaydi`, `AjandaZamani.An(tarih, saat, sureDk, saatDilimi, ifade)`, `KayitTuru.RANDEVU`...).
`AjandaDegisiklik`/`AjandaParca` (üç halli alanlar) köprüye çıkmaz: arayüz tam gövde verir
(`duzenle(kayitId, govde)`), fark Rust'ta hesaplanır.

## Kotlin: `android/app/src/main/kotlin/dev/eren/ajanda/`

```
CekirdekErisimi.kt     süreç başına tek Cekirdek; kabukları bağlar              [şef, dondurulmuş]
KopruKaniti.kt         köprü tanısı (ekran, debug alıcı, JVM testi)             [şef]
kabuk/JavaZaman.kt     ZamanKabugu (java.time) — yazıldı                        [şef]
kimlik/                KeystoreKimlik.kt (KimlikKabugu), EslestirmeEkrani.kt    [K1]
ag/                    AjandaSoketi.kt (Tasima), BaglantiYoneticisi.kt, EsitlemeIsi.kt   [K2]
alarm/                 AlarmPlanlayici.kt (AlarmKabugu), AlarmAlici.kt, AcilisAlici.kt   [K3]
ekran/                 AnaEkran.kt (başlatıcı), KayitEkrani.kt (+ K4'ün ekleyecekleri)   [K4]
cekirdek/ (üretilir)   UniFFI bağlamaları: build/generated, git'e girmez
src/test/kotlin/...    KopruTest.kt [şef]; her parça kendi test dosyasını kendi paketinde açar
```
Bağımlılık: JNA 5.17 (UniFFI), OkHttp 4.12 (K2). AndroidX yok (`android.useAndroidX=false`): ekranlar
platform View'larıyla, iş JobScheduler'la, bildirim platform API'siyle. Kotlin paketleri birbirini
yalnız şu noktalardan çağırır: `CekirdekErisimi.al`, `BaglantiYoneticisi.basla/birak`,
`AlarmAlici.ALARM_NO`; geri kalanı çekirdek üzerinden konuşur.

## Akışlar

- **Eşleştirme (K1, R4):** metin (QR/JSON) -> `eslestirmeQrCoz` -> `cekirdek.eslestirmeBaslat(qr)` ->
  `BaglantiYoneticisi.basla` -> soket açılınca motor `pair_request` (açık anahtar `KimlikKabugu`) ->
  `pair_result` -> eşleşme `meta`'ya, `eslesmeDurumu` `Eslesti`; gözlemciye `Degisim.eslesme`.
- **Bağlantı (K2, R4):** `baglantiAdresi()` -> OkHttp -> `onOpen`: `baglantiAcildi(soket)` -> `hello`
  (alanlar `kural::esitleme::ajanda_hello_alanlari`'nın anlamıyla sunucu kopyasından) -> `auth_challenge`:
  PC imzası `dogrula`, telefon imzası `imzala` -> `welcome` -> telafi (`tam`'da ayrı tabloya topla) ->
  `esitlendi` -> kuyruk birer birer. `onClosed/onFailure`: `baglantiKapandi(nesil)`.
- **Elle ekleme (K4, R4, R1):** form -> `govdeyiHazirla` -> `ekle(govde, ELLE)` -> iyimser görünen kayıt +
  kuyruk + (canlıysa) `islem` çerçevesi -> `Degisim.kayitlar` -> `alarm_senkronu` (R3) -> `kayit` ve
  `islem_sonucu` gelince gerçek hal.
- **Alarm (K3, R3):** `Etkiler.alarm_kur` -> `AlarmPlanlayici.kur` -> çalınca `AlarmAlici` ->
  `alarmCaldi(no)` -> `HatirlatmaBildirimi?` -> bildirim. Açılış/saat/dilim -> `AcilisAlici` ->
  `alarmlariYenidenKur(neden)` -> kaçırılanlar tek özet (`kacirilanlariGoster`).
- **Arka plan (K2):** `EsitlemeIsi` -> bağlan -> `baglantiDurumu().asama == CANLI && kuyrukta == 0` -> kapat.

## Depo (SQLite, `depo/sema.rs`)

`meta` (eşleşme, depo_id, son_rev, telafi durumu), `sunucu_kayitlari` (PC'den gelen son haller),
`telafi_kayitlari` (süren tam telafi), `kuyruk` (kalıcı, sıralı, `deneme`, `yollandi`), `ret_listesi`,
`gorunen` (sunucu + iyimser kuyruk; arayüz ve alarmlar YALNIZ bunu okur; tam telafi sürerken değişmez),
`kurulu_alarmlar` (`alarm_no` = PendingIntent istek kodu; teslim edilene dek). Göç 1 iskeletin tablosu,
göç 2 bunlar. İyimser `ekle`'nin görünen hali geçerli bir `AjandaKaydi`'dir (revizyon 1, kaynak
`{yol: girdi_yolu, tur_kokeni: insan, device_id}`, zamanlar şimdi) ve `bekleyen` doğrudur.

## Vektör düzeneği

`cargo test` içinde `tests/vektorler.rs` her bölümü çalıştırır ve tablo basar (geçti/kaldı/bekliyor,
bekleyen parçanın adı). KALDI ya da dosyada tanınmayan bölüm -> çıkış 1. İlk dalga sonu: 267 geçti
(173/173 mesaj + model kuralları), 132 bekliyor, `imza` (1) Kotlin'e devredildi. İkinci dalganın her Rust
parçası bitince kendi bölümleri "bekliyor"dan "geçti"ye geçmelidir; düzeneğe dokunulmaz.

## İkinci dalga iş parçaları

Ortak: Türkçe ad ve yorum; kişisel veri yok; her parça yalnız kendi dosyalarına yazar; imzalar değişmez
(gerekirse raporda öner). Doğrulama: `cargo test -p ajanda-cekirdek` (apps/ajanda) ve
`gradlew assembleDebug testDebugUnitTest` (apps/ajanda/android, `ANDROID_HOME` verilerek).

### R1 — Rust metin ve zaman kuralları
- Dosyalar: `kural/metin.rs`, `kural/dayanak.rs`, `kural/ornek.rs`.
- İmzalar: `ajanda_metni_temizle(&str) -> String`; `govdeyi_hazirla(KayitGovdesi) -> Result<KayitGovdesi, GirdiSorunu>`
  (tek satırlık alanda satır sonu/sekme kararını burada yaz); `dayanak_gecerli_mi(tarih, saat, Option<dilim>, &YerelAn) -> bool`;
  `ajanda_ornek_durumu_uygula(&AjandaKaydi, ornek_tarihi, KayitDurumu, bugun) -> OrnekDurumuSonucu`.
- Başvuru: `ajanda-zaman.ts` `ajandaMetniTemizle`; `ajanda-kural.ts` `dayanakGecerliMi`, `ajandaOrnekDurumuUygula`.
- Kullanır: `model::metin`, `model::tekrar::ornek_gunu_mu`. Bağımlılık: yok.
- Bitti: `gorunmez.temiz` (20), `dayanak` (12), `ornek_durumu` (11) geçti.

### R2 — Rust birleştirme, tekilleştirme, kuyruk, eşitleme kuralları
- Dosyalar: `kural/birlesim.rs`, `kural/tekil.rs`, `kural/telafi.rs`, `kural/kuyruk.rs`, `kural/esitleme.rs`.
- İmzalar: `ajanda_degisikligi_uygula(&AjandaKaydi, &AlanDegisikligi, YazarKimligi) -> AjandaBirlesimi`;
  `ajanda_tekil_anahtari(kapsam, KayitTuru, baslik, Option<&AjandaZamani>) -> String`;
  `ajanda_es_degisikligi(Option<&AjandaZamani>, Option<&str>, Option<&AjandaZamani>, Option<&[Hatirlatma]>) -> AlanDegisikligi`;
  `ajanda_tekil_karari(&[EsDurumu], YazarKimligi) -> TekilKarari`; `ajanda_telafi_tam_mi(&TelafiGirdisi) -> bool`;
  `ajanda_kuyruk_karari(KuyrukOlayi, u32) -> KuyrukKarari`;
  `ajanda_esitleme_adimi<K: KopyaKaydi>(&AjandaKopya<K>, EsitlemeOlayi<K>) -> AjandaKopya<K>`; `ajanda_hello_alanlari(&AjandaKopya<K>) -> HelloAlanlari`.
- Başvuru: `ajanda.ts` (`ajandaDegisikligiUygula`, `ornekleriBuda`, `ajandaTekilAnahtari`, `ajandaEsDegisikligi`),
  `ajanda-kural.ts` (`ajandaTekilKarari`, `ajandaTelafiTamMi`, `ajandaKuyrukKarari`, `ajandaEsitlemeAdimi`, `ajandaHelloAlanlari`).
- Kullanır: `model::kanonik` (kanonik JSON, SHA-256), `AjandaZamani::cekirdek_json`, `model::tekrar`. Bağımlılık: yok.
- Bitti: `birlestirme` (13), `tekil_anahtar` (8), `es_degisikligi` (7), `tekil_karar` (12), `telafi` (10),
  `kuyruk_karari` (10), `esitleme` (8) geçti.

### R3 — Rust hatırlatma planı ve alarm motoru
- Dosyalar: `kural/hatirlatma.rs`, `motor/alarm.rs`, `depo/alarmlar.rs`.
- İmzalar: `hatirlatma_halleri`, `kurulacak_hatirlatmalar`, `kacirilan_hatirlatmalar`, `hatirlatma_ozeti`
  (hepsi `(&AjandaKaydi, simdi_ms, &dyn AnCevirici, ...) -> Result<_, ZamanHatasi>`); `Motor::alarm_senkronu(o, e, &[kayit_id])`
  (boş = hepsi), `Motor::alarmlari_yeniden_kur(o, e, YenidenKurmaNedeni)`, `Motor::alarm_caldi(o, e, alarm_no) -> Option<HatirlatmaBildirimi>`,
  `Motor::alarm_kurulamadi(alarm_no, neden)`; `Depo::{kurulu_alarmlar, tum_kurulu_alarmlar, alarm_kaydet, alarm_no_ile, alarm_teslim_edildi, alarm_sil}`.
- Kural: sözleşme "Zaman ve hatırlatma" ve "Uygulama → Alarmlar" (her değişiklikte, tam eşitleme sonunda,
  açılışta, saat/dilim değişiminde yeniden kur; kurulanları teslim edilene dek sakla; kaçırılanlar tek özet;
  tekrarda bir örnek çalınca sıradakini kur). Kayıtları yalnız `Depo::gorunen_kayit`/`etkin_kayitlar`'dan okur;
  çeviri `Ortam::cevirici()`; dilim çevrilemezse o hatırlatmayı kurma ve hatayı yut (diğerleri sürsün).
- Testler: `kopru::sahte` (SahteZaman, SahteAlarm) ve `Depo::gorunen_yaz` ile R4'ü beklemeden.
- Bağımlılık: R4 `alarm_senkronu`'nu her görünen kopya değişikliğinden sonra çağırır (R4 bitene dek uçtan uca yok).
- Bitti: `hatirlatma_plani` (11), `hatirlatma_plani.kacirilan` (10) geçti; motor testleri.

### R4 — Rust yerel depo ve eşitleme motoru
- Dosyalar: `depo/mod.rs`, `depo/sema.rs`, `depo/gorunen.rs` (+ yeni `depo/*.rs`), `motor/mod.rs`,
  `motor/kanal.rs`, `motor/eslesme.rs`, `motor/islem.rs`, `motor/sorgu.rs`.
- İmzalar: `motor/*.rs`'deki her `Motor` yöntemi (kopru'nun çağırdığı; dosyalarda belgeli); `Depo::gorunen_*`
  ve `etkin_kayitlar` okuma imzaları sabit (R3 okur).
- Kural: sözleşme "Kanal akışı" 1-6 ve "Uygulama" (eşitleme, kuyruk, ret listesi); kararlar R1/R2 kurallarından;
  `cerceve_geldi` her çerçeveyi `ajanda_asagi_coz`'dan geçirir (geçersiz -> kapat). Kimlikler `rastgele` +
  `base64url_yaz` (`k_`, `i_` önekli `OpakId`). Görünen kopya değişince `alarm_senkronu`, `Degisim` doldur.
  Eşitleme vektörlerini SQLite uygulamasına karşı da sına (bellek modeli `kural::esitleme`).
- Bağımlılık: R1 (`govdeyi_hazirla`, `ornek`), R2 (`birlesim`, `kuyruk`, `esitleme`), R3 (`alarm_senkronu`).
  Kendi testlerinde bunlar bitmemişse `CekirdekHatasi::Yazilmadi`/panik görür: ilgili testleri parça
  adlarıyla işaretle; birleşimde hepsi yeşil olmalı.
- Bitti: kopru'daki bütün Motor yöntemleri yazılı; `kopru::sahte` ile uçtan uca testler (eşleştirme, tam ve
  artımlı telafi, kesilen telafi, iyimser ekle ve ret, geçici ret ve deneme sınırı, kopma).

### K1 — Kotlin kimlik ve eşleştirme
- Dosyalar: `kimlik/KeystoreKimlik.kt`, `kimlik/EslestirmeEkrani.kt`, `src/test/.../kimlik/*`.
- Uygular: `KimlikKabugu` (`acikAnahtar` SPKI DER; `imzala` SHA256withECDSA DER; `dogrula`; `rastgele` SecureRandom;
  `anahtariSil`). Keystore takma adı sabit, uygulamaya özgü. Ekran: metin yapıştırma (QR tarama ileride; kamera
  bağımlılığı gerekirse rapora), `eslestirmeQrCoz`, `eslestirmeBaslat`, `eslesmeDurumu`, kaldırma.
- Test: `ajanda-kurallar.json` `imza` vektörü (java.security ile `dogru_metin` doğrulanır, `yanlis_metin` reddedilir;
  JVM testinde Keystore yok: doğrulamayı Keystore'dan ayrı bir işlevde tut). Bağımlılık: R4 (uçtan uca).

### K2 — Kotlin ağ taşıması ve arka plan eşitlemesi
- Dosyalar: `ag/AjandaSoketi.kt`, `ag/BaglantiYoneticisi.kt`, `ag/EsitlemeIsi.kt`, `src/test/.../ag/*`.
- Uygular: `Tasima`; OkHttp dinleyicisi -> `baglantiAcildi`/`cerceveGeldi`/`baglantiKapandi` (nesil); tek soket;
  yeniden bağlanma (artan bekleme), ağ geri gelince deneme; ping aralığı; `EsitlemeIsi` (JobScheduler, ağ
  koşullu, periyodik; zamanlamayı K2 kurar, `AnaEkran` açılışında da `BaglantiYoneticisi.basla`).
  Çekirdek çağrıları OkHttp iş parçacığında; geri çağrıdan çekirdeğe eşzamanlı girme.
- Bağımlılık: R4 (uçtan uca), K1 (eşleşme).

### K3 — Kotlin alarm, bildirim, alıcılar
- Dosyalar: `alarm/AlarmPlanlayici.kt`, `alarm/AlarmAlici.kt`, `alarm/AcilisAlici.kt` (+ `alarm/Bildirimler.kt`),
  `src/test/.../alarm/*`.
- Uygular: `AlarmKabugu` (strateji TEK yerde: varsayılan `setAlarmClock` ya da `setExactAndAllowWhileIdle`,
  izin yoksa `setAndAllowWhileIdle`; ölçüm sonucu yalnız bu sınıfı değiştirir), bildirim kanalı, hatırlatma ve
  kaçırılan özet bildirimi (dokununca `AnaEkran`), alıcılar `goAsync` + arka plan iş parçacığı.
- Bağımlılık: R3.

### K4 — Kotlin ekranlar
- Dosyalar: `ekran/` paketinin tamamı (`AnaEkran.kt`, `KayitEkrani.kt`, eklenecekler), `src/test/.../ekran/*`.
- Kullanır: `liste(ListeSorgusu(Sekme.TARIHLI|TARIHSIZ|TASLAKLAR|SILINENLER, kapalilarDahil))`, `kayit`,
  `ekle`, `duzenle`, `durumDegistir`, `onayla`, `sil`, `geriYukle`, `retListesi`, `retAt`, `gecmisIste`/`gecmis`,
  `baglantiDurumu`, `eslesmeDurumu`, `gozlemciEkle/Cikar`, `varsayilanHatirlatmalar`, `metniTemizle`,
  `govdeyiHazirla`. İki ana sekme; taslak işareti ve onay; tamamla/geri al; ret listesi (düzelt -> form, at);
  metin düz gösterilir. Eşleşme yoksa `kimlik.EslestirmeEkrani`'na yönlendir; açılışta
  `alarmlariYenidenKur(UYGULAMA_ACILDI)` ve `BaglantiYoneticisi.basla`.
- Bağımlılık: R4 (veri), K1 (eşleştirme ekranı).

## Ortak dosyalar ve dokunma sırası

Dondurulmuş (ikinci dalgada yalnız şef, iş parçaları birleştikten sonra, sırayla değiştirir):
`Cargo.toml` (çalışma alanı ve `cekirdek/`), `Cargo.lock`, `cekirdek/src/lib.rs`, `hata.rs`, `kopru/*`,
`model/*`, `kural/mod.rs`, `tests/vektorler.rs`, `android/app/build.gradle.kts`, `gradle.properties`,
`settings.gradle.kts`, `AndroidManifest.xml`, `CekirdekErisimi.kt`, `KopruKaniti.kt`, `kabuk/JavaZaman.kt`,
`KopruTest.kt`, `README.md`, bu belge.

- Yeni crate, Gradle bağımlılığı, izin, bileşen, köprü yöntemi, `CekirdekHatasi` değişkeni ya da model düzeltmesi
  gereken parça bunu raporunda (gerekçe + tam değişiklik) yazar, ortak dosyaya dokunmaz; şef dalga sonunda tek
  tek uygular, her birinden sonra iki komut yeşil.
- Önceden bildirilenler: Gradle'da OkHttp; manifestte INTERNET, ACCESS_NETWORK_STATE, SCHEDULE_EXACT_ALARM (≤32),
  USE_EXACT_ALARM, RECEIVE_BOOT_COMPLETED, POST_NOTIFICATIONS, cleartext; bileşenler `ekran.AnaEkran`,
  `ekran.KayitEkrani`, `kimlik.EslestirmeEkrani`, `alarm.AlarmAlici`, `alarm.AcilisAlici`, `ag.EsitlemeIsi`.
  K4 yeni Activity yerine aynı Activity içinde görünüm/diyalog kullanırsa manifeste gerek kalmaz.
- `depo/sema.rs` R4'ündür; `kurulu_alarmlar` değişikliği R3 raporuyla. Yayımdan önce göç 2 yerinde
  düzeltilebilir; yayımdan sonra yalnız yeni göç.
- Birleştirme sırası önerisi: R1, R2 (bağımsız) -> R3 -> R4 -> K1, K3 -> K2 -> K4.

## Bilinen ayrışmalar ve açık noktalar

- `serde_json` JSON'daki eşsiz vekil kaçışını (`"\ud800"`) ve taşan sayıyı (`1e400`) ayrıştırmaz; JS ayrıştırır.
  Sonuç farkı yalnız kuralsız alanlarda (`error.detail`, `pair_request.etiket`, zarfın `islem` gövdesi) ve
  `v:1e400`'de; ikisi de reddeder ya da kapatır. Vektörlerde yok (`model/cerceve.rs` başı).
- `ZoneId.systemDefault().id` bazı cihazlarda IANA biçiminde olmayabilir (`GMT+03:00`): elle eklemede
  `SaatDilimi` şemasından geçmezse K4 kullanıcıya dilim seçtirir.
- `alarm_no` SQLite AUTOINCREMENT'tir; Kotlin `toInt()` ile istek kodu yapar (2^31'e erişilmez).
