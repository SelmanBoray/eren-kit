# Ajanda — uygulama mimarisi

Yalnız Android. Sözleşme: `apps/phone/docs/AJANDA.md` (özellikle "Kanal akışı", "Zaman ve hatırlatma",
"Ekiplerin gereksinimleri → Uygulama"); şemaların başvurusu `apps/phone/protocol/src/ajanda*.ts`.
Bu belge iş bölümünü, modül/paket düzenini ve ikinci dalganın iş parçalarını tanımlar; kod içermez.
Uygulama sözleşmenin **sürüm 2**'sini (`AJANDA_SURUMU` = 2) konuşur; v2'de değişenler "Sürüm 2" bölümündedir.
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
| Arayüz verisi | Rust sorguları (`liste`, `kayit`, `retListesi`, `gecmis`, takvim: `takvimAyi`, `takvimGunu`) + `Gozlemci` | Arayüz çeker; değişiklikte `Gozlemci.degisti(Degisim)` gelir, arayüz kendi iş parçacığına geçip yeniden sorgular. |
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

**Yazılmamış parça.** Rust'ta yazılmamış parça kalmadı (`yazilmadi!` makrosu kaldırıldı). Yeni bir kural
yarım bırakılırsa `std::panic::panic_any(kural::Yazilmadi("parça"))` atar (vektör düzeneği "bekliyor" sayar;
köprü `CekirdekHatasi.Yazilmadi`'ya çevirir); motor/depo yöntemi `Err(CekirdekHatasi::yazilmadi(...))` döner.
Kotlin'de iskelet kalan yalnız `ag/` (K2) ve `ekran/` (K4): hiçbir şey yapmazlar.

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
depo/               SQLite (yazan bağlantı motorda; arayüz sorguları için ayrı okuma bağlantısı)
  mod.rs            Depo, `yazma` (tek işlem), meta anahtarları, okuma bağlantısı          [R4]
  sema.rs           göçler (3: R4 sütunları, 4: yerel kip)                               [R4, D1]
  yerel.rs          kip (`meta.kip`), yerel revizyon sayacı, yerel geçmiş                [D1]
  gorunen.rs        görünen kopya (arayüz ve alarmlar yalnız bunu okur)                  [R4]
  kopya.rs          sunucu kopyası, tam telafi tablosu, depo_id/son_rev, hello alanları  [R4]
  kuyruk.rs         işlem kuyruğu, ret listesi                                           [R4]
  alarmlar.rs                                                                   [R3]
motor/              iş mantığı, tek Mutex<Motor>
  mod.rs            Motor, Ortam, Etkiler, değişiklik yayma, `alarm_isleminde`           [R4]
  kanal.rs          bağlantı durum makinesi, telafi, kuyruğun yollanması ve sonuçları   [R4]
  iyimser.rs        iyimser uygulama, görünen kopyanın hesabı                            [R4]
  yerel.rs          yerel yazar, koparma, yerel kipten bağlanma (`yereli_kuyruga_dok`)   [D1]
  aktarma.rs        dışa ve içe aktarma: ajanda.json belgesi, plan, uygulama           [D3]
  birlestirme.rs    birleştirme önizlemesi: onay bekleme, plan izi, olası çiftler       [D4]
  islem.rs eslesme.rs sorgu.rs testler.rs                                       [R4]
  takvim.rs         takvim sekmesi: ay özeti, gün listesi (+ takvim_testleri.rs) [takvim]
  alarm.rs                                                                      [R3]
kopru/              Kotlin yüzeyi: #[uniffi::export] YALNIZ burada               [şef, dondurulmuş]
  mod.rs            Cekirdek nesnesi, serbest işlevler, etki uygulama
  kabuklar.rs       KimlikKabugu, ZamanKabugu, Tasima, AlarmKabugu, Gozlemci
  tipler.rs         KayitGorunumu, Sekme, ListeSorgusu, RetGirdisi, Gecmis*, Degisim,
                    BaglantiDurumu, EslesmeDurumu, KurulacakAlarm, HatirlatmaBildirimi, ...
  sahte.rs          (yalnız test) sahte kabuklar: R3/R4 Motor ve Cekirdek testleri için
tests/vektorler.rs  dil bağımsız vektör düzeneği (harness=false)               [şef, dondurulmuş]
tests/uctan_uca.rs  köprü yüzeyi + sahte kabuklar + sahte PC ile senaryolar     [R4]
tests/buyuk_kopya.rs  büyük kopyada süre ölçümü (AJANDA_OLCUM_ADET; takvim dahil) [R4]
tests/takvim.rs     takvim köprü yüzeyi uçtan uca (eşitlenen kopya, örnek durumu) [takvim]
tests/yukseltme.rs  v1 yerel veritabanından yükseltme, sürüm uyuşmazlığı        [v2]
tests/veri/v1_depo.sql  sürüm 1 kodunun ürettiği veritabanının dökümü (fikstür) [v2]
tests/yerel_kip.rs  yerel yazar, kip geçişleri, göç 4 sınıflaması                [D1]
tests/yerel_vektorler.rs  yerel yazarın servis vektörleriyle karşılaştırılması     [D1]
tests/koparma.rs    koparma ve yerel kipten bağlanma (veri kaybı yok senaryoları)  [D1]
tests/veri/v3_eslesmesiz_kuyruklu.sql  şema 3, eşleşmesiz ama kuyruklu veritabanı (fikstür) [D1]
tests/veri_koruma.rs  veri koruması: temel kuralı, başka depo, yedekten dönen PC, kayıt başına denetim [D2]
tests/gecis_guvenligi.rs  geçiş güvenliği: temelsiz mezar taşı, bozuk kayıt, açılış onarımı, `son_gecis` [D2]
tests/veri/v3_eslesmis_zengin.sql  şema 3, eşleşmiş, zengin (PC temeli, kuyruk, ret) veritabanı (fikstür) [D2]
tests/donus_denetimi.rs  yedekten dönen PC: yazım kimliği ve `DonusAnalizi` senaryoları [D2]
tests/aktarma.rs   dışa ve içe aktarma: biçim, plan, yerel ve bağlı kip, ölçüm        [D3]
tests/aktarma_guveni.rs  içe aktarma güvenliği: bellek sınırları, gelecek tarihli an, içerikli iz, taslaklar [D3]
tests/aktarma_bellek.rs  içe aktarma bellek ölçümü (önizleme tepe belleği, kayıtlar tutulmuyor) [D3]
tests/aktarma_ret_yedegi.rs  ret listesinin yedeğe girmesi: biçim 2 `retler`, yinelenmeme, sayılar    [D3]
tests/birlestirme.rs  birleştirme önizlemesi: onay, vazgeç, kopma, olası çift, taslak     [D4]
tests/v3_tasima.rs  v3 alanlarının yerel yazar, D2 yolları ve içe aktarmada taşınması        [R1]
tests/ortak/        sahte kabuklar ve `/ajanda` konuşan sahte PC servisi        [R4]
```
*Model hatası bulunursa düzeltme şefin sırasıyla yapılır (aşağı bak); model tipleri köprüden de geçer.

Kayıt, zaman, hatırlatma, tekrar ve kapalı listeler `uniffi::Record/Enum` türetir: Kotlin aynı tipi görür
(`AjandaKaydi`, `AjandaZamani.An(tarih, saat, sureDk, saatDilimi, ifade)`,
`AjandaZamani.Gun(tarih, gunBolumu, saatDilimi, ifade)`, `KayitTuru.RANDEVU`, `GunBolumu.AKSAM`...).
`AjandaDegisiklik`/`AjandaParca` (üç halli alanlar) köprüye çıkmaz: arayüz tam gövde verir
(`duzenle(kayitId, temel, govde)`), fark Rust'ta hesaplanır.

**Düzenlemede yalnız değişen alanlar gider.** `temel: DuzenlemeTemeli?` (`revizyon` + formun açıldığı
`govde`): verilirse `guncelle`'ye yalnız kullanıcının formda o halden değiştirdiği alanlar girer, onlardan
da yalnız görünen halden farklı olanlar (`motor/islem.rs` `yalniz_degisenler`); `temel_revizyon` formun
açıldığı revizyondur. Form açıkken PC'den inen değişiklik kullanıcının dokunmadığı alanda geri alınmaz
(sözleşmenin alan alan birleşmesi). `None`: gövdenin tamamı istenen haldir (ret listesinden "düzelt").
Kayıt ekranı temeli kaydedilmemiş formla birlikte saklar (`ekran/FormKaydi.kt`): süreç ölümünden sonra da
aynı temelle kaydedilir.

## Kotlin: `android/app/src/main/kotlin/dev/eren/ajanda/`

```
CekirdekErisimi.kt     süreç başına tek Cekirdek; kabukları bağlar              [şef, dondurulmuş]
KopruKaniti.kt         salt okur köprü tanısı (debug alıcı, JVM testi)          [şef]
kabuk/JavaZaman.kt     ZamanKabugu (java.time) — yazıldı                        [şef]
kimlik/                KeystoreKimlik.kt (KimlikKabugu), EslestirmeEkrani.kt (+ EslestirmeDurumu,
                       EslestirmeVerisi, EslestirmeMetinleri, P256) — yazıldı   [K1, kapandı]
                       GecisMetinleri.kt (koparma ve geçiş metinleri, saf)      [D6]
ag/                    AjandaSoketi.kt (Tasima), BaglantiYoneticisi.kt, EsitlemeIsi.kt — İSKELET  [K2]
                       DuraklamaBildirimi.kt (YEREL_KIP duraklama bildirimi, saf; kuralı aşağıda)  [K5]
                       BaglantiKusagi.kt (açılan soket sayacı; "Şimdi değil" kuşağı)           [D4]
alarm/                 AlarmPlanlayici.kt (AlarmKabugu), AlarmAlici.kt, AcilisAlici.kt (+ Bildirimler,
                       BildirimIcerigi, HatirlatmaDurumu, SorunKaydi, AlarmIsParcacigi) — yazıldı [K3, kapandı]
                       IzinPlani.kt (hangi anda hangi izin, saf karar)          [D6]
birlestirme/           BirlestirmeAkisi.kt, BirlestirmeMetinleri.kt — saf mantık [D4]
aktarma/               YedekKabi.kt (zip), AktarmaAkisi.kt, AktarmaMetinleri.kt — saf mantık [D3]
                       OtomatikYedekPlani.kt, OtomatikYedekci.kt (saf), OtomatikYedek.kt (SAF, ayarlar) [D6]
                       YedekIsDenetcisi.kt (yedek işinin kurulma kuralı, saf; JobScheduler arkasında)  [D6]
ekran/                 AnaEkran.kt (başlatıcı), KayitEkrani.kt (+ K4'ün ekleyecekleri) — İSKELET  [K4]
cekirdek/ (üretilir)   UniFFI bağlamaları: build/generated, git'e girmez
src/test/kotlin/...    KopruTest.kt [şef]; her parça kendi test dosyasını kendi paketinde açar
                       test/aktarma/YedekBellekTest.kt (Kotlin bellek ölçümü, `AJANDA_BELLEK_OLC=1`)
```
`KopruTest` gerçek Rust kitaplığına karşı (JVM): şema, tanı, ekle -> kayıt/liste -> alarm kur/çaldı,
boş depoda motor sorguları, eşleştirme akışı (`pair_request`, ret -> `Reddedildi`, yeniden başlatma ->
`Bekliyor`, kaldırma -> `anahtariSil`), `JavaZaman` kuralı.
Bağımlılık: JNA 5.17 (UniFFI), OkHttp 4.12 (K2). AndroidX yok (`android.useAndroidX=false`): ekranlar
platform View'larıyla, iş JobScheduler'la, bildirim platform API'siyle. Kotlin paketleri birbirini
yalnız şu noktalardan çağırır: `CekirdekErisimi.al`, `BaglantiYoneticisi.izle/simdiDene`,
`AlarmAlici.ALARM_NO`; geri kalanı çekirdek üzerinden konuşur.

**Ön plan bağlantısı ne zaman açık (tek kural, `ag/GorunurlukSayaci.kt`):** uygulamanın herhangi bir
etkinliği başlamışken (`onStart`..`onStop`) açık, hiçbiri görünmezken `birakmaGecikmesiMs` (3 s) beklemesi
ve gerekirse kuyruk boşaltması sonrası kapalı. `AjandaUygulamasi` (manifestte `android:name`)
`BaglantiYoneticisi.izle` ile etkinlik yaşam döngüsü geri çağrısını sayaca bağlar; etkinlikler bağlantıyı
kendileri açıp kapatmaz. Android ekran geçişinde önce yeni etkinliği başlatır, sonra eskisini durdurur:
sayaç sıfıra inmez (ana ekran <-> kayıt ekranı geçişinde bağlantı düşmez, kayıt ekranının geçmişi canlı
bağlantıyı bulur); döndürme/tema değişiminde bir an sıfıra iner, bekleme içinde yeniden başlar. Home ya da
başka uygulama (eşleştirme ekranı dahil): bekleme sonrası kapanır, arka planda yeniden bağlanma döngüsü
kalmaz. Eşleştirme ekranı yalnız `simdiDene` der (görünürken kopuksa beklemeden dene; talebi değiştirmez).

## Akışlar

- **Eşleştirme (K1, R4):** metin (QR/JSON) -> `eslestirmeQrCoz` -> `cekirdek.eslestirmeBaslat(qr)` ->
  `BaglantiYoneticisi.simdiDene` -> soket açılınca motor `pair_request` (açık anahtar `KimlikKabugu`) ->
  `pair_result` -> eşleşme `meta`'ya, `eslesmeDurumu` `Eslesti`; gözlemciye `Degisim.eslesme`; aynı
  bağlantıda `hello` ile sürer (ret: `Reddedildi{kod}`, servis kapatır).
- **Bağlantı (K2, R4):** `baglantiAdresi()` -> OkHttp -> `onOpen`: `baglantiAcildi(soket)` -> `hello`
  (alanlar `kural::esitleme::ajanda_hello_alanlari`'nın anlamıyla sunucu kopyasından) -> `auth_challenge`:
  PC imzası `dogrula`, telefon imzası `imzala` -> `welcome` -> telafi (`tam`'da ayrı tabloya topla) ->
  `esitlendi` -> kuyruk birer birer. `onClosed/onFailure`: `baglantiKapandi(nesil)` (tam telafi atılır,
  yolda kalan işlem `Kopma`). Çerçeve işlenirken herhangi bir hata (depo, Keystore imzası, rastgele),
  işleyici aşamayı önce `Kapaniyor`'a çevirmiş olsa da, taşımaya `kapat` yollatır (`kanal.rs`
  `cerceve_geldi`); Kotlin `AjandaSoketi` de atılan istisnada soketi ayrıca kapatır. Açık ama işlemez
  soket kalmaz, yeniden bağlanma normal yoldan sürer.
- **Elle ekleme (K4, R4, R1):** form -> `govdeyiHazirla` -> `ekle(govde, ELLE)` -> iyimser görünen kayıt +
  kuyruk (tek işlem) -> `alarm_senkronu` (R3, işlem kalıcı olduktan sonra) -> `Degisim.kayitlar` ->
  (canlıysa) `islem` çerçevesi -> `kayit` ve `islem_sonucu` gelince gerçek hal (sıra fark etmez).
- **Alarm (K3, R3):** `Etkiler.alarm_kur` -> `AlarmPlanlayici.kur` -> çalınca `AlarmAlici` ->
  `alarmCaldi(no)` -> `HatirlatmaBildirimi?` -> bildirim. Açılış/saat/dilim -> `AcilisAlici` ->
  `alarmlariYenidenKur(neden)` -> kaçırılanlar tek özet (`kacirilanlariGoster`).
  **Alarm ufku:** Android uygulama başına en çok 500 alarm tutar. Aynı anda en çok `ALARM_BUTCESI` (400;
  pay: iptali/teslimi işlenmemiş satırlar) teslim edilmemiş satır kurulu olur: bütün gelecek tetikler
  `(tetik_ms, kayit_id)` sırasıyla dizilir, en yakın 400'ü kurulur, en uzak kurulanın anahtarı
  `meta.alarm_ufku`'dadır; ötesindekiler ertelenir (satır açılmaz). Tek kaydın senkronu yalnız ufuk
  içini kurar, sonra bütçe denetlenir: aşıldıysa ya da ertelenen varken yer açıldıysa (alarm çaldı,
  kayıt kapandı/silindi/taşındı) bütün plan yeniden dizilir (`motor/alarm.rs` `butceyi_denetle`).
  `alarmCaldi` bu yüzden tek SQLite işlemindedir (`alarm_isleminde`).
- **Rozet (K4):** kuyruktaki değişikliğin rozeti gerçek durumu söyler (`Liste.Gonderim`): eşleşme yoksa
  (`baglantiAdresi() == null`) rozet ve gönderim iddiası yok, eşleşmiş ama canlı değilse "PC'yi bekliyor",
  yalnız `CANLI`'da "Gönderiliyor".
- **Arka plan (K2):** `EsitlemeIsi` -> bağlan -> `baglantiDurumu().asama == CANLI && kuyrukta == 0` -> kapat.

## Depo (SQLite, `depo/sema.rs`)

`meta` (eşleşme, depo_id, son_rev, telafi durumu), `sunucu_kayitlari` (PC'den gelen son haller),
`telafi_kayitlari` (süren tam telafi), `kuyruk` (kalıcı, sıralı, `deneme`, `yollandi`, `bekledigi_rev`),
`ret_listesi` (`govde_json`, `sira`), `gorunen` (sunucu + iyimser kuyruk; arayüz ve alarmlar YALNIZ bunu
okur; tam telafi sürerken sunucu tarafından değişmez), `kurulu_alarmlar` (`alarm_no` = PendingIntent istek
kodu; teslim edilene dek). Göç 1 iskeletin tablosu, göç 2 bunlar, göç 3 R4'ün sütunları (`bekledigi_rev`,
`govde_json`, `sira`; 2. göç debug APK'larıyla cihaza gitmiş olabileceği için yerinde değişmedi).
**Göç 4 (D1, şema 4):** `meta.kip` (`yerel` | `bagli`), `meta.yerel_rev` (yerel revizyon sayacı; ilk yerel
yazmada kurulur) ve `yerel_gecmis` tablosu (yerel kipteki her yazmanın `AjandaGecmisGirdisi` JSON'u, `rev`
yerel revizyon). Göç mevcut kurulumu şöyle sınıflar: `meta.eslesme` varsa `bagli`, kip satırı dışında hiçbir satır değişmez;
yoksa `yerel`: kuyruk silinir ve `gorunen.bekleyen` sıfırlanır (görünen kopya zaten sunucu kopyası + kuyruğun
iyimser hali olduğundan o hal yerel gerçek olur; sunucu kopyası, `depo_id`, `son_rev` kalır). `kip` satırı
yoksa (elle silinmiş meta) `bagli` sayılır.
İyimser `ekle`'nin görünen hali geçerli bir `AjandaKaydi`'dir (revizyon 1, kaynak
`{yol: girdi_yolu, tur_kokeni: insan, device_id}`, `elle_alanlar` verilen alanlar, zamanlar kuyruğa giriş
anı) ve `bekleyen` doğrudur.

**Görünen kopya bir türetmedir:** kaydın görünen hali = sunucu kopyasındaki hali + kuyruktaki işlemlerinin
sırayla iyimser uygulanması (`motor/iyimser.rs`, servisin `islemCalistir`'iyle aynı kurallar). Ret, kopma,
tam telafi ya da yeni `kayit` sonrası doğru hal tek yoldan bulunur: kaydı yeniden hesapla. "İyimser
değişikliği geri alma" ayrı kod yolu değildir; reddedilen işlem kuyruktan çıkınca hesap onu içermez.
Kayıt satırları `AjandaKaydi::json()` metnidir (anahtarlar sıralı): değişiklik denetimi metin eşitliğidir.

**Yazma kuralı:** birden çok tabloya dokunan her değişiklik `Depo::yazma` ile tek işlemdir; etkiler işlem
kalıcı olduktan sonra yazılır. R3'ün alarm senkronu (kayıt başına savepoint) `Motor::alarm_isleminde` ile
TEK ayrı işlemde çalışır, etkileri ancak o işlem kalıcı olunca katılır (dış işlem olmadan her savepoint
ayrı fsync'li işlemdi: 5000 kayıtlık ilk eşitleme 7 s -> 0,3 s). Telafideki `kayit`'ler `TELAFI_TAMPONU`
(200) birikince tek işlemde yazılır.

**Okuma bağlantısı:** `liste`, `kayit`, `ret_listesi` motor kilidini almaz; dosya veritabanında ikinci
(salt okunur, `query_only`) bağlantıdan son kalıcı hali okur (WAL). Böylece tam telafinin sonu gibi uzun
bir yazma arayüzü bekletmez. Bellek içi veritabanında (testler) motor okur.

## Vektör düzeneği

`cargo test` içinde `tests/vektorler.rs` her bölümü çalıştırır ve tablo basar (geçti/kaldı/bekliyor,
bekleyen parçanın adı). KALDI ya da dosyada tanınmayan bölüm -> çıkış 1. İlk dalga sonu: 267 geçti
(173/173 mesaj + model kuralları), 132 bekliyor, `imza` (1) Kotlin'e devredildi. İkinci dalga sonu
(birleşim): **399 geçti, 0 bekliyor, 0 kaldı**, `imza` (1) Kotlin'de (`kimlik/ImzaVektoruTest`). Sürüm 2:
**464 geçti, 0 bekliyor, 0 kaldı** (yeni bölümler `gun_hatirlatmasi` 9, `gece_teyidi` 16; `gece_teyidi` servis
kuralıdır, uygulama `kural::dayanak::gece_teyidi_eksik_mi` ile yalnız sınar). Düzenek dosyada tanımadığı
bölümde ve `surum` uyuşmazlığında çıkış 1 verir: sözleşmeye bölüm eklenince düzenek de eklenir.

## Sürüm 2 (sözleşme `docs/AJANDA.md` "Sürüm 2")

- **Model.** `AjandaZamani::Gun.gun_bolumu: Option<GunBolumu>` (kapalı liste; `an`/`donem`'de şema reddeder;
  yoksa JSON v1 ile bayt bayt aynı, tekil anahtar değişmez). `AjandaRetNedeni` ve `KuyrukRetNedeni`'ne
  `gece_teyidi_gerekli`; `AJANDA_SINIRLARI.GECE_ARALIGI_DK`; `AJANDA_SURUMU` = 2 (çerçeve, `pair_request`). QR sürümü protokolde ayrı bir sabittir (`AJANDA_QR_SURUMU`, bugün 2; `apps/phone/protocol/src/sinirlar.ts`): QR'ın şekli değişmedikçe artmaz; uygulama ileride v3'e geçerken v2 servisin QR'ını reddetmemelidir. **Bilinen açık:** uygulama kodu hâlâ QR'ın `v`'sini `AJANDA_SURUMU` ile denetler ve yazar (`model/eslesme.rs`); `AJANDA_SURUMU` 3 olunca v2 servisin QR'ı yanlışlıkla reddedilir. v3 geçişinden önce kodda ayrı bir QR sabiti kullanılmalıdır.
  İmza öneki `eren-ajanda-auth-v1` sabit (sürümden türemez).
- **Kural (`kural/hatirlatma.rs`).** `once` saatsiz gün kaydında gün hatırlatmasıdır:
  `gun_hatirlatmasi_yereli(gün, dk, bölüm)` = gün `− ⌊dk/1440⌋`, saat `GunBolumu::hatirlatma_saati` (08/11/13/19/20; sözleşmenin `GUN_HATIRLATMA_SAATLERI`'si)
  ya da 09:00, kaydın diliminde `AnCevirici` ile. Haller ve kurulacaklar `gun_hatirlatmasi{tarih, saat}`,
  özet `gun_hatirlatmasi{tarih, saat, gecti}` taşır. Tetik her senkronda kaydın o anki zamanından
  hesaplandığı için gün/bölüm değişince alarm kendiliğinden taşınır (eski `(kayit_id, tetik_ms)` iptal),
  saat gelince saatli kurala geçer, kalkınca döner; `donem`/`belirsiz`/zamansız bekler. Alarm motoru
  (`motor/alarm.rs`) değişmedi: kuralı kullanır.
- **Yerel veritabanı: göç yok.** Şema 3 kalır; v1 kayıt satırları v2 şemasıyla olduğu gibi okunur, kuyruk
  gövdeleri (`islem_json`, zarfsız) ve eşleşme (`meta.eslesme`, Keystore anahtarı) aynen geçerlidir.
  Güncellemeden sonra alarmlar yeni kurala göre `MY_PACKAGE_REPLACED` -> `alarmlariYenidenKur(PAKET_GUNCELLENDI)`
  (ayrıca her açılışta ve periyodik işte) ile yeniden planlanır: v1 alarmları aynı `alarm_no` ile kalır,
  saatsiz günler 09:00'ını alır. Sınama: `tests/yukseltme.rs` (fikstür `tests/veri/v1_depo.sql`, sürüm 1
  kodunun sahte PC ile ürettiği veritabanının dökümü).
- **Sürüm uyuşmazlığı.** Başka `v`'li çerçeve (çözücüde `protokol_uyumsuz`), `error{protokol_uyumsuz}` ya da
  karşının kapanış kodu 1002: `BaglantiDurumu.son_hata = protokol_uyumsuz` ve `surum_uyusmazligi`
  (`ServisEski`: karşı `v` küçük, `UygulamaEski`: büyük, `Bilinmiyor`). Kayıt, kuyruk, alarm değişmez; `CANLI`'da,
  başka kanal hatasında ve eşleşme değişiminde temizlenir. Kotlin (`ag/BaglantiDenetcisi`) artan beklemeli
  denemeyi bırakır: görünürken 30 dk'da bir (`AgAyarlari.surumBeklemeMs`), `basla`/`hemenDene` hemen bir kez, ağ
  değişimi denemez, arka plan oturumu `SURUM_UYUSMAZ` ile biter. Ekran (`DurumGostergesi`) "PC'yi güncelleyin" /
  "Uygulamayı güncelleyin" / "Sürüm uyuşmuyor" der; eşleştirme ekranı başka sürümün QR'ını açıklamayla reddeder.
- **Köprü yüzeyi (v2'de değişen).** `AjandaZamani.Gun` yeni alan; yeni `GunBolumu`; `BaglantiDurumu.surumUyusmazligi`
  + `SurumUyusmazligi`; `baglantiKapandi(nesil, kapanisKodu: Int?)` (OkHttp `onClosing` kodu); yeni
  `Cekirdek.hatirlatmaOnizlemesi(govde) -> HatirlatmaOnizlemesi{kurulacak, saatsiz, gecmis, ilkTetikMs,
  gunHatirlatmasi{tarih, saat, gecti}}` (motor kilidini almaz; form ve ayrıntı notu); serbest
  `gunHatirlatmaSaati(GunBolumu?)`.
- **Arayüz.** Form (`KayitFormu`, `KayitEkrani`): saatsiz günde isteğe bağlı "Günün bölümü" yongaları (saat
  seçilince kalkar, aynısına dokunmak kaldırır); hatırlatma seçenekleri saatsizde "O gün" ve "1 gün önce";
  not çekirdeğin önizlemesinden: "Cuma 19:00'da hatırlatılır.", bölümsüzde "O gün 09:00'da hatırlatılır
  (Cuma).", geçtiyse "Bu kayıt için bildirim gelmeyecek…", taslakta "Taslak onaylanınca: …". Liste (`Liste`):
  saatsiz gün saat sırasına girmez, günün başında bölüm sırasıyla, saat yerine bölüm etiketi ("Akşam",
  "Cumartesi · akşam"); hatırlatma saati listede yazılmaz (ayrıntı/form notunda). Bildirim saat uydurmaz:
  "Görev · bugün akşam".

## Sürüm uyumu ve sözleşme 3 (kanal)

Sözleşme: `docs/AJANDA.md` "Sürüm uyumu" ve "Sürüm 3". Model katmanı (`1aa4883`) ile kanal (`62dd419`, `41496f7`) iki ayrı adımdır.

- **Model (`model/surum.rs`, `model/alan.rs`).** `AJANDA_SURUMU` = 3, `AJANDA_SURUMLERI` = `[2, 3]`, QR için ayrı `AJANDA_QR_SURUMU` = 2 (yukarıdaki "Sürüm 2" bölümündeki QR açığı bununla kapandı). `Surum {V2, V3}` çözme ve yazmanın parametresidir: her çözücü ve yazıcı bağlantı sürümünü alır, v2'de v3 alanı yazılmaz. `V3Alanlari` kayıttaki v3 alanlarını (`simge`, `bolge`, `bolge_konumu`, `varis`, `baglantilar`, `ekler`, dar `tekrar`), `V3Degisikligi` işlemdeki v3 kısmını taşır. `hello`/`welcome` `yetenekler`, ek yedeği çerçeveleri, `DonmusHata` (`ajanda_donmus_hata_oku`) ve `ajanda_geri_dusus(denenen, ret, kume)` buradadır.
- **Kanal (`motor/kanal.rs`).** Bağlantı kümenin en büyüğüyle (v3) açılır. v2 servis `protokol_uyumsuz` verirse `ajanda_geri_dusus` v2'yi seçer ve yeni bağlantı v2'de eşitlenir (veri, kuyruk, alarmlar korunur). Düşülen sürüm `YUKARI_DENEME_MS` (1 saat) ya da süreç yeniden başlayana dek tutulur (bellek içi); sonra yeniden v3 denenir. Düşüşten 1 saat sonra ilk köprü çağrısında (`kopru/mod.rs` her çağrının sonunda `yukari_denemesi`), yolda işlem yokken çekirdek açık bağlantıyı kendisi kapatır (hata yazılmaz), sonraki bağlantı v3 ile açılır; `BaglantiDurumu.yukari_deneme_ms` bu anı verir. `welcome`'dan sonraki 1002 sürüm düşüşü sayılmaz, sıradan kopmadır (R7). Sürüm sabitlenmeden gelen öteki ret kodları dondurulmuş zarfla okunur ve kodun kendisi olarak işlenir (geri düşüş yok).
- **Kopya ve servis sürümü.** Kopyanın hangi sürümle dolduğu meta `kopya_surumu`'nda durur: v2'de dolmuş kopya ilk v3 bağlantıda bir kez tam telafi ister. Servis sürümü meta `servis_surumu`'ndadır; erteleme kararı ve `BaglantiYetenekleri` buna bakar.
- **Erteleme (bağlı kip, sürüm < 3; yerel kipte yok).** Ayrı sütun yoktur: satırın hali işlemden, bilinen sürümden ve kaydın önceki satırlarından hesaplanır (`kuyruk_ertelemeleri`).
  - v2 kısmı da olan satır bölünür: v2 kısmı aynı `islem_id` ile gider, v3 kalanı yeni `islem_id`'yle hemen arkasına girer.
  - Yalnız v3 alanı değiştiren satır yerinde kalır, atlanır, denemesi artmaz, telafide atılmaz; arkasındaki başka kaydın satırı gider.
  - R2: ertelenmiş satırın arkasındaki aynı kayda `sil`, `geri_yukle`, `ekle` öne geçmez; kaydın arkasındaki bütün satırlar bekler, v3'te özgün sırayla gider. Ertelenen satır ret listesine gitmez; tek istisna R3 (aşağıdaki "v3 alanlarının taşınması (R1)"): bölünen `ekle` reddedilince v3 kalanı ret girdisine katılır. `kanal.rs` başındaki "kullanıcı atmadıkça ret listesine gitmez" cümlesi bu durumu kapsamaz; kod değişmedi (`kanal.rs` Kol C'nin).
  - R4: v3'te yollanıp yanıtı gelmeden kopan karma satır (`deneme > 0`) v2'de bölünmez; bütünüyle bekler, v3'te aynı `islem_id` ile gider.
  - R4 bölünmezlik kaydın sırasını da tutar: bütünüyle bekleyen karma satırın arkasındaki o kayda ait bütün satırlar (silme dahil) da servis v3'e yükselene ya da kullanıcı `ertelenenleriAt` ile atana dek bekler; başka kayıtların işlemleri gider.
  - Çıkış yolu: `Cekirdek.ertelenenleriAt(kayitId: String?): Int` (`None`: bütün kayıtlar) her ertelenen v3 değişikliğini ret listesine `RetGirdisi.ertelenenAtildi: Boolean = false` işaretiyle geçirir (`neden` `TeslimEdilemedi`, sessizce kaybolmaz); v2 kısımları ve bekleyen silme bu serviste hemen gider. `BaglantiYetenekleri.ertelenen` yalnız v3 değişikliği taşıyan satırları sayar (atılacak sayı); gönderilmeyen toplam `ertelenen_islem`'dir. Yukarı deneme yoldaki geçmiş isteğini bekler; `Yanit` aşamasındaki 1002 geri düşüş sayılmaz (yalnız `Eslestirme` ve `Hello`).
  - Ertelenenler ilk v3 bağlantıda `esitlendi`'den sonra gider. Aynı v3 alanına sonradan dokunan değişiklik de ertelenir ve sırada arkadadır: sonraki kazanır.
  - `BaglantiDurumu.kuyrukta` ertelenenleri saymaz (Kotlin'in "kuyruk boşalana dek" beklemeleri takılmasın). R1(3): `BaglantiDurumu.ertelenen_islem` (`#[uniffi(default)]`) ertelenen ve onların arkasında bekleyen işlemlerdir; gönderilmeyen toplam `kuyrukta + ertelenen_islem` (`KoparmaSonucu.gonderilmeyen_islem` koparma anında budur).
  - R6: kuyruk dizinle yürünür (`depo/kuyruk.rs` `kuyruk_sonraki`, `kuyruk_parcali_kayitlar`; v3 alan adı geçmeyen satır çözülmez): 5 000 satırda durum okuması 1,16 s → ~50 ms.
  - Koparmada (`bagli_kipten_cik`) ertelenenler kuyrukla atılır; değerleri görünen kopyada kalır.
  - Atılanın görünürlüğü (A1): `RetGirdisi.v3Degisikligi: V3DegisiklikOzeti? = null` (`V3DegisiklikOzeti(konan: V3Alanlari, kaldirilan: List<String>)`), `RetGirdisi.ulasmisOlabilir: Boolean = false` (yollanmış satırdan atılan girdi; servis uygulamış olabilir, "gönderilmeden atıldı" denmez) ve `Cekirdek.ertelenenGeriAl(islemId: String): Boolean` (atılanı yeni işlem olarak yeniden uygular; eski serviste yine ertelenir, v3'te gider, yerel kipte doğrudan uygulanır).
  - Denetimli geri alma (C1): `Cekirdek.ertelenenGeriAlDenetimli(islemId: String, zorla: Boolean): ErtelenenGeriAlma` → `ErtelenenGeriAlma{bulundu, uygulandi, degisen, cakisan, birlesen}`; `ertelenenGeriAl` `zorla=false` ile aynıdır. Atma anının v3 alanları ret satırında saklanır (`atma_tabani`); tekil alanda çakışma bildirilir ve hiçbir şey yapılmaz (`zorla` geçer), `ekler` ve `baglantilar` üç yönlü birleşir, yalnız değişecek alanlar gider. Bağlı kipte yalnız canlı bağlantıda ve servis v3'te eşitlendikten sonra. Geçmiş isteği yaşı her sürümde 1 dk ile sınırlıdır (`ic_hata`), saat geri gidişine dayanıklıdır; `BaglantiDurumu.gecmisBeklemeMs` bu anı verir.
- **Köprü.** `baglantiYetenekleri() -> BaglantiYetenekleri{kip: BaglantiKipi{Yerel, BagliDegil, Bagli}, surum?, v3Alanlari, yetenekler, ertelenen}` ve `KayitGorunumu.ertelenen` (yalnız ertelenmiş satırı olan kaydın `bekleyen`'i yanlıştır). Değişiklik `Degisim.baglanti` / `Degisim.kayitlar` ile bildirilir. `v3Alanlari` yanlışken alan yine düzenlenebilir (ertelenir).
- **Kapı (R1 ve Kotlin).** `ajanda_arac_v3` ve uygulamanın v3 düzenleme ekranı ancak şu iki koşul birlikte sağlanınca açılır: (1) Kol B'nin R1 düzeltmesi (yerel yazar ve D2 yolları v3 alanlarını taşır); (2) Kotlin kabuğu `BaglantiDurumu.ertelenen_islem`'i kullanır: durum göstergesi ('bekleyen yok' yalnız `kuyrukta` ve `ertelenen_islem` 0 iken) ve eşleşmeyi kaldırma onayı (`kuyrukta + ertelenen_islem`). R1 kapandı: yerel yazar ve bağlı kipteki D2 yolları v3 alanlarını taşır ("v3 alanlarının taşınması (R1)"); Kol C'nin üç `#[ignore]` testi açıldı. Kapının kalan koşulu Kotlin tarafıdır. Kapı açılmadan v3 işlemi üreten köprü yolu yoktur.
- **Sınama.** `tests/surum_v3.rs`, `tests/erteleme.rs`, `tests/surum_kanal.rs`, `motor/v3_testleri.rs`, `motor/erteleme_testleri.rs`; R2 `ertelenmis_satirin_arkasindaki_sil_one_gecmez`, `sirasi_tutulan_kaydin_arkasi_bekler_baska_kayit_gider`; R3 `baglanti_acikken_servis_yukselirse_bir_saatte_v3e_gecilir`, `yukari_denemesi_yoldaki_islemi_bekler_ani_durumda_gorunur`; R4 `v3te_yollanmis_karma_satir_v2de_bolunmez`; R7 `welcomedan_sonra_cercevesiz_1002_geri_dusus_degil`. `cargo test` 275+ (+3 `#[ignore]`; simge eklemesi sayıyı biraz artırabilir), vektörler 784.
- **Kapının Kotlin koşulu (arayüz ve bağlantı kolu).** `ajanda_arac_v3` ve uygulamanın v3 düzenleme ekranı ancak R1 düzeltmesi (Kol B) ve Kotlin kabuğunun `BaglantiDurumu.ertelenen_islem`'i kullanması (ilk iki madde) birlikte sağlanınca açılır:
  - `DurumGostergesi.hesapla` "bekleyen yok"u ancak `kuyrukta` ve `ertelenenIslem` ikisi de 0 iken der; ertelenen varken ayrıntıya "M değişiklik PC'deki servis güncellenince gidecek".
  - Yapıldı (R1 Kotlin): kaldırma ve koparma onayları `kuyrukta + ertelenenIslem` sayısını gösterir; `BaglantiDenetcisi` CANLI iken `yukariDenemeMs` doluysa o anda yoklar.
  - `AgStratejisi` ve `EsitlemeIsi` `kuyrukta`'ya bakmaya devam eder.
  - Kotlin'de gereken (`ertelenenleriAt`, arayüz kolu): (1) `CekirdekYuzu.ertelenenleriAt`; (2) ret satırında `ertelenenAtildi` ise neden metni "PC'deki servis eski olduğu için gönderilmeden atıldı." ve düzeltme kapalı; (3) kayıt ayrıntısında "Bekleyen değişikliği at" düğmesi; (4) eşitleme ekranında "N değişiklik servis güncellemesini bekliyor · Hepsini at"; (5) ret satırında atılan v3 özetinin (`v3Degisikligi`) gösterilmesi ve "Yeniden uygula" düğmesi; `ulasmisOlabilir` iken "gönderilmeden atıldı" yazılmaz; (6) "Yeniden uygula" ekranı `ertelenenGeriAlDenetimli(zorla=false)` çağırıp `cakisan`'ı kullanıcıya gösterir ve onayla `zorla=true` sunar; `birlesen` bilgisi gösterilir; (7) `BaglantiDurumu.gecmisBeklemeMs` anına yoklama.
  - **KAPI:** "Bekleyen değişikliği at" / "Hepsini at" ekranı, atılanın görünürlüğü (A1), "Yeniden uygula" ve "Bekleyen değişikliği at" ekranı Kotlin bu çakışma akışını göstermeden bağlanmaz.
- **Bilinen açıklar.**
  - R1 kapandı ("v3 alanlarının taşınması (R1)"): koparmadan sonra yeniden bağlanınca ertelenen v3 değeri PC'ye gider; D4 olası çift anahtarı `bolge`'yi sayar.
    Yedek belgesinde bölgeler biçim 4'tedir (`bolgeler` bugün hep boş; okuyucu 4 ve üstünü reddeder).
  - Boşta açık kalan bağlantı artık `BaglantiDenetcisi`'nin `yukariDenemeMs` anındaki yoklamasıyla yükselir (Kotlin, R1 Kotlin).
  - v2 servis bilinirken her durum okuması kuyrukta tam tarama yapar (5 000 satırda debug ~30–60 ms).
  - Ek yükleme ve indirme istemci tarafında yok; istemci `ek_yedegi` istemiyor.
  - Kotlin formu v3 alanlarını düzenleyemiyor (arayüz kolu).
  - Liste alanları (`baglantilar`, `ekler`) `ret_duzelt`te öğe öğe birleşmez; Kol C'nin L1'ini bekliyor ve PC'de sonradan eklenen öğe ezilebilir. Bölge, konum ve varışın tek birim birleşmesi de L1/R2'ye kaldı.

## Takvim sekmesi (yerel salt okuma; sözleşme değişmedi)

Üçüncü sekme: ay ızgarası, altında seçili günün kayıtları. Kablo biçimi, `AJANDA_SURUMU`, eşitleme ve yerel
şema (3) değişmedi; yalnız görünen kopyadan okuyan iki köprü yöntemi eklendi (mevcut imzalar aynı).

- **Yüzey.** `takvimAyi(yil, ay, kapalilarDahil) -> TakvimAyi{yil, ay, gunler, seritler}`: `gunler` ayın bütün
  günleri (boşlar dahil) `TakvimGunOzeti{tarih, toplam, acik, kapali, taslak, gorev, randevu, notlar, serit}`;
  `seritler` ayla kesişen çok günlü öğeler `TakvimSeridi{kayitId, ornekTarihi?, baslik, tur, durum, taslak,
  ilkGun, sonGun}` (kırpılmamış; ilk gün artan, uzun önce). `takvimGunu(tarih, kapalilarDahil) ->
  List<TakvimOgesi{gorunum, ornekTarihi?, durum, ilkGun, sonGun, saat?, bitisSaati?}>`, sıralı. Özetin
  `toplam`'ı o günün `takvimGunu` uzunluğudur. İkisi de motor kilidini almaz (okuma bağlantısı), cihaz
  dilimini ve çeviriyi `ZamanKabugu`'ndan alır. Hata: `GecersizGirdi{alan: "yil"|"ay"|"tarih"}`.
- **Gün ve dilim.** Gün sınırı cihazın şimdiki dilimidir (Tarihli sekmesiyle, `ekran/Liste.kt`, aynı): saatli
  (`an`) kayıt kendi diliminden cihaz dilimine çevrilir (java.time; çevrilemezse duvar saati cihazınki), saatsiz
  gün ve dönem takvim günüdür. Çekirdekte dilim veritabanı yok. Saatli öğe başına 2 (süreliyse 3)
  `ZamanKabugu` çağrısı.
- **Sıra.** Bölümsüz saatsizler (bölümsüz `gun`, `donem`), sonra bölümlüler bölüm sırasıyla, sonra saatliler
  cihaz saatiyle; önceki günden süren saatli öğe saatlilerin başında; eşitlikte ilk gün, oluşturma, kimlik.
  Saatten bölüm türetilmez.
- **Çok günlü.** Dönem ve süresi gece yarısını aşan saatli kayıt kapsadığı her günde (ilk/son günüyle) ve
  şeritte; tam gece yarısında biten ertesi günü kaplamaz.
- **Tekrar.** `an`/`gun` + `tekrar` penceredeki örneklerine açılır (`tekrar_ornekleri`). Örneğin durumu
  `ornekler` satırı, yoksa serinin durumu (kapalı seri bütün örnekleriyle kapalı). `ornekTarihi` örneğin kaydın
  kendi takvimindeki günüdür (dilim çevirisiyle cihaz gününden farklı olabilir): örneği tamamlamak
  `durumDegistir(kayitId, durum, ornekTarihi)`. `gorunum.kayit` serinin kendisidir (`zaman` çapa günü).
- **Görünürlük (karar).** Tarihli sekmesiyle aynı: silinmiş hiç yok; taslak görünür (işaretli, özette
  `taslak`); `tamam`/`iptal` (örnekte de) yalnız `kapalilarDahil` iken — ekran Tarihli sekmesinin
  "kapalılar" seçimini paylaşabilir. Tamamlanan öğe öteki sekmelerdeki gibi görünümden çıkar.
- **Hız** (`tests/buyuk_kopya.rs`, `--release`, masaüstü): 5000 kayıtta ay ~4,5 ms, gün ~3,7 ms; 20000'de
  ay ~25 ms, gün ~20 ms (aynı koşuda Tarihli sekmesi 28 / 120 ms). Bedelin çoğu aday taramasıdır: göçsüz
  sorgu pencereden önceki her satırın `json`'unu okur (tekrar edenler ve uzun dönemler sütunsuz bulunur).
  Gerekirse yeni göç (tekrar ve dönem için kısmi dizin) bunu pencere kadarına indirir; şema sürümü artar
  (`KopruTest` ve `tests/yukseltme.rs` 3 bekliyor).
- **Ekran (Kotlin, `ekran/`).** `Gorunum.TAKVIM` üçüncü ana sekmedir. `Takvim.kt` saf mantık: ızgara (pazartesi
  başlar, ay dışı hücre boş, 4-6 hafta), şeritlerin haftalara bölünüp açgözlü sıraya yerleşmesi (en çok 2 sıra,
  sığmayan gün başına "+N"), hücre noktaları (yalnız tek günlükler; açık dolu, taslak halka, kapalı soluk) ve
  ekran okuyucu metni, seçili günün satırları (`Liste.satir`; yer, saat ve durum öğeden, tarih başlıkta) ve
  `TakvimDurumu` (ay + seçili gün + "bugün"; gece yarısı bugünü seçili olanı yeni güne taşır; `metin()` ile
  `onSaveInstanceState`'te). `TakvimDenetleyici` (yalnız arka iş parçacığı): son 7 ay + seçili gün önbelleği,
  komşu aylar ay değişiminden önce okunur, kayıt değişiminde (`kayitlar`/`tumu`) önbellek atılır; "kapalılar"
  seçimi `AnaDenetleyici`'ninkidir. `TakvimGorunumu` listenin ilk öğesidir (küçük ekranda günle birlikte kayar);
  ızgara platform View'larıyla çizilir, her gün hücresi ayrı dokunulur görünümdür (TalkBack), yatay kaydırma
  ayı değiştirir, uzun basma o güne kayıt açar. Örnek satırında tamamla/geri al `durumDegistir(…, ornekTarihi)`
  ile yalnız o güne; düzenle/sil seriye ("Seriyi sil"). Testler: `TakvimTest`, `TakvimDenetleyiciTest`,
  `TakvimGercekTest`.

## Yerel kip ve veri koruması (D1, D2)

- **İki kip.** `CalismaKipi`: `Yerel` (doğruluk kaynağı telefonun görünen kopyası; yazan `motor/yerel.rs`) ve `Bagli`
  (servis yazar; kullanıcı işlemleri kuyruğa girer). Kip `meta.kip`'tedir, `Cekirdek::kip()` sorar.
- **Yerel yazar.** İşlem kuyruğa girmez: servisin `islemCalistir` kurallarıyla (`iyimser::islem_uygula`) tek
  SQLite işleminde görünen satır (`bekleyen` yanlış), yerel revizyon (`depo/yerel.rs`, monoton, PC revizyonlarının
  altına inmez) ve `yerel_gecmis` satırı yazılır; kalıcı olunca alarm senkronu ve `Degisim.kayitlar`. Yan etkisiz
  işlem hiçbir şey yazmaz. Servisin yerelde de yapılan denetimleri: `ekle`'de `KAYIT_ADET` (mezar taşları dahil)
  ve saat dilimi (`saat_dilimi_bilinmiyor`, `ZamanKabugu.andan_yerele` ile); ret köprü hatası olarak döner
  (yerelde kuyruk ve ret listesi yoktur). Yerelde yalnız insan yazar; taslak ve sentetik tur kuralları yoktur
  (bağlantıdan kalan taslak onaylanabilir). Yerel kipte geçmiş `yerel_gecmis`'ten gelir.
- **Koparma** (`baglantiyiKopar()`, `Motor::baglantiyi_kopar`): bağlı kipten yerele. Kalır: görünen kopya o
  anki haliyle (bekleyen işlemler dahil), ret listesi, PC temeli (`sunucu_kayitlari`, `depo_id`, `son_rev`),
  alarmlar. Silinir: kuyruk, eşleşme bilgisi ve cihaz anahtarı; açık bağlantı kapanır. Servisin kabul ettiği ama
  `kayit`'i gelmemiş (onaylanmış) satırlar önce PC temeline katılır (sonraki bağlanmada fark olarak yeniden
  gitmesin). `KoparmaSonucu`: `onceki_kip`, `gonderilmeyen_kayit`, `gonderilmeyen_islem`, `yanitsiz_islem`
  (yollanmış ama yanıtsız: PC'ye ulaşmış olabilir), `ret_listesinde`, `baglanma_iptal`. Yerel kipte çağrı süren
  bağlanmayı ya da bekleyen eşleştirmeyi iptal eder, kayda dokunmaz. (D2) Bağlı kipte `eslesmeyiKaldir` de
  koparmadır (`GecisNedeni.EslesmeKaldirildi`): veri kalır, eşleşme ve cihaz anahtarı silinir.
- **Yerel kipten bağlanma.** QR ile eşleşince kip, servisin tam kopyası elde edilene dek `Yerel` kalır ve yerel
  yazmalar sürer. `hello` boş kopya gibi gider (`son_rev` 0, `depo_id` yok), bu yüzden telafi hep tamdır ve
  gelenler yalnız `telafi_kayitlari`'na toplanır; görünen kopya, alarmlar ve PC temeli değişmez. Kopmada toplanan
  atılır, sonraki bağlantı baştan dener. (D2) Bağlı kipte `welcome` saklı `depo_id`'den farklı bir `depo_id`
  getirirse (yeni QR ile başka servis ya da servis sıfırdan kuruldu) görünen kopya ezilmez: kip `Yerel` olur,
  eşleşme kalır, bağlantı bu yoldan sürer (`GecisNedeni.DepoDegisti`). QR reddedilirse eski eşleşme korunur.
  `esitlendi`'de tek işlemde `yereli_kuyruga_dok`: her yerel kayıt için
  fark temeli seçilir, fark kuyruğa girer, toplanan kopya sunucu kopyasının yerine geçer, kip `Bagli` olur,
  görünen kopya yeniden hesaplanır. **Fark temeli kuralı** (`birlesme_islemleri`, `hedef_hal`):
  - Servisin kopyasında kayıt yoksa temel yok, kayıt `ekle` ile gider. Varsa fark, telefonun koparma anındaki
    PC temeline (`sunucu_kayitlari`; depo değişse de bilinir) göre **alan alan** hesaplanır: telefonun
    dokunmadığı alanda PC kazanır, iki tarafın da değiştirdiği alanda telefon kazanır (önizleme ve seçim
    D4'tedir). Temel kaydı bilmiyorsa (yolda kalmış ekleme) telefonun PC'den farklı her alanı gider.
  - Temelin bilmediği alan geri gönderilmez: v3 kuralı gereği `Alan::Yok` kaldırma değildir; yalnız telefonun
    açıkça kaldırdığı (`null`) alan kalkar.
  - **Yazım kimliği** revizyon + `guncelleme_ms`'tir (revizyon büyüklüğü tek başına kanıt değil). Aynı
    `depo_id`'de "PC yedekten dönmüş" mü, depo düzeyinde kanıtla `DonusAnalizi` ayırır: telefonun bildiği
    yazım PC'de yoksa (kayıt yok, revizyon küçük, aynı numarada başka yazım, numarası büyük ama PC saatiyle
    daha eski) kayıptır; kalan yazımlar dönüş noktasının alt, kayıp yazımlar ve yeniden verilmiş numaralar
    üst sınırını verir. Kanıt yoksa dönüş yoktur ve her kayıt meşru ilerlemiştir; kanıt varsa kalışı
    kanıtlanamayan kayıt yitirilmiş sayılır. Dönüşte PC'nin yitirdiği onaylı değerler de yeniden gider. Hem
    yerel kipten bağlanmada hem bağlı kipte (`geri_donenleri_kuyruga_koy`) çalışır.
  - `geri_yukle` yalnız aynı depo temeliyle verilir; başka depoda PC'de silinmiş kayıt diriltilmez. Telefonun
    silmesi yalnız PC'nin hali de dönmüşse (yitirmişse) geri alınır; PC'nin silmesi geçerliyse telefonun
    öteki farkları `geri_yukle`'siz gider, servis `kayit_silinmis` der, telefonun hali ret listesine düşer.
  - Birleşen hal geçerli bir kayıt değilse `tutarsiz_kayit`: PC yitirmemişse telefonun değiştirdikleri gider
    ve servis reddeder; PC yitirmişse hiçbir işlem gitmez, PC'nin hali kalır, telefonun hali ret listesine
    girer. Temelsiz mezar taşı (PC'de hiç olmamış silinmiş kayıt) gönderilmez; iki tarafta da silinmişse
    hiçbir işlem gitmez.
  - Okunamayan görünen kayıt `tutarsiz_kayit` nedeniyle ret listesine düşer, geçiş sürer. Aynı kayıt PC'de de
    varsa tek sonuç: görünen kopyada PC'nin hali durur, ret girdisi o kaydın düzeltmesidir; PC'de yoksa kayıt
    görünen kopyadan çıkar, düzeltme yeni kayıt olarak eklenir. Satırı okunamayan PC temeli bilinmiyor sayılır.
  - Açılışta "bağlı kip + eşleşme yok" (çıkışsız) durum yerel kipe çevrilir (`acilis_onarimi` ->
    `cikissiz_bagli_kipi_onar`, veri kaybı yok). Onarım hatası açılışı düşürmez (kip bağlı kalır, sonraki
    açılış yeniden dener); izi `meta.onarim_hatasi`'na (`ts_ms`, `mesaj`) yazılır, başarılı olunca silinir.
    Köprüden okunamıyor (arayüz henüz görmez). **Değişmez: hiçbir yerel kayıt sessizce
  kaybolmaz.** Her yerel kayıt ya görünen kopyada kalır ya da servis işlemi reddedince ret listesine düşer;
  görünen kopya başka bir `depo_id`'nin tam telafisiyle değiştirilmez.
- **Kotlin'in bilmesi gerekenler.** Yeni yüzey: `kip()` ve `baglantiyiKopar()`. Bağlanma sürerken `kip()` hâlâ
  `Yerel` döner (`Bagli` yalnız `esitlendi` sonrası). Gözlemci: kip değişince `Degisim.tumu` ve
  `Degisim.baglanti`; `sonGecis()` (`GecisOzeti`: `GecisNedeni` `Koparma`, `EslesmeKaldirildi`, `DepoDegisti`, `KoparmaSonucu` sayıları, eski/yeni `depo_id`; kalıcı, sonraki geçiş üstüne yazar) arayüze ne olduğunu söyletir; `baglantiyiKopar` bağlı kipten `tumu`, `eslesme`, `baglanti` (ve açık geçmiş sayfaları için
  `gecmis`: önbellek atıldı, yeniden istenmeli) gönderir. `KoparmaSonucu`'ndaki sayılar kullanıcıya
  söylenecek metindir. Kotlin tarafı `d274ebe`'de şema 4'e ve kuyruksuz `ekle`'ye uydu.
- **Bilinen sınırlar.** (1) Taslak işareti ve kaynak izi `ekle` ile düşer. (2) Her yerel kipten bağlanma bir
  tam telafidir. (3) PC'de silinmiş ama telefonda düzenlenmiş kayıt ret listesine düşer. (4) Önizlemeli
  birleştirme "Birleştirme önizlemesi (D4)" bölümündedir. (5) Yalnız iki tarafın da değiştirdiği alan için: telefonun değeri PC'nin değerini ezer;
  PC'nin değeri PC geçmişinde kalır; önizleme ve seçim D4'tedir. (6) Göç 4, eşleşmesiz kurulumda onaylanmış
  kuyruk satırlarını PC temeline katmaz; sonradan aynı değerle yeniden giderler (zararsız). (7) Yerel kipte
  `hello` boş gittiği için tek kayıtlık dönüş (yitirilen yazımların hepsi sonradan `son_rev`'i aşan tek
  kayıttaysa) görülemez; çözümü kanal ya da protokol işidir. (8) Belirsiz aralıkta (dönüş noktası kanıtla
  daraltılamadığında) telefonun değeri PC'nin dönüş sonrası değerini ezebilir; PC'nin değeri PC geçmişinde
  kalır. (9) A→B→A'da B'nin bütün kayıtları A'ya kalıcı eklenir; arayüz bunu `sonGecis` ile önceden söylemeli
  (D6). (10) Sıfırdan kurulmuş servisin kopyasında kayıt yoktur: telefonun bütün kayıtları `ekle` ile gider ve
  `ekle`'nin kayıpları (1) geçerlidir. (11) İçe aktarma (D3) iki tarafın değiştirdiği alanı birleştirmez:
  kayıt bütün olarak daha yeni `guncelleme_ms`'e göre kazanır; bağlı kipte kaybolanlar "Dışa ve içe
  aktarma" bölümündedir.
- **Geri alma kısıtı.** Şema 4'e geçmiş eşleşmesiz kurulumda şema 3 APK'sına dönülürse eski kod kipi bilmez;
  ilk eşleşmede tam telafi yerel kayıtları siler. Şema 4'ten geri dönülmemeli; dönülecekse önce dışa aktarma
  (D3) alınmalı.
- **Okunamayan PC temeli** koparmayı düşürmez: satırı okunamayan temel bilinmiyor sayılır ve D2/D4 yolunda
  da aynı (`KoparmaSonucu`, `sonGecis`, D4 önizlemesi sayar).
- **Arka plan oturumu.** Kotlin `ag/` yerel kipte eşleşme varken arka planda bağlanmaz
  (`ArkaPlanSonucu.YEREL_KIP`; alarmlar yine kurulur): birleştirme sorusu yalnız görünür uygulamada çıkar.
  Kapandı (K5): arka plan eşitlemesi `YEREL_KIP` ile bitince duraklama başına bir kez bildirim gösterilir
  (`ag/DuraklamaBildirimi`, durum kanalı; uygulama görünürken gösterilmez). Duraklamanın kimliği, öncelik
  sırasıyla: (1) onay bekleyen plan (`birlestirmeOnizlemesi().iz`): her yeni plan bir kez "onayınızı bekliyor"
  der, geçiş olsun olmasın; (2) söylenmemiş geçiş (`sonGecis`, `GecisMetinleri.gosterilmeli`; arayüz
  `gecisGosterildi` ile işaretlediyse söylenmiş sayılır): her geçiş bir kez, `GecisMetinleri.duraklama` metniyle;
  (3) eşleşme (`eslesmeDurumu`): geçişi olmayan (ilk eşleşme) ya da geçişi söylenmiş (arayüz gösterdi;
  koparmadan sonra yeniden eşleşme) eşleşme başına bir kez, genel "Eşitleme bekliyor" metniyle. Plan ya da
  geçiş bildirildiyse o eşleşmenin duraklaması da söylenmiş sayılır (plan düşünce yinelenmez). Gösterilemeyen
  bildirim (izin ya da kanal kapalı) saklanmaz, sonraki turda yeniden denenir.
- **Servis değişmezleri.** Telefonun dönüş saptaması (`DonusAnalizi`) üç servis değişmezine dayanır: (1) geçmiş
  hiç budanmaz; (2) kaydın `guncelleme_ms`'i, o yazımın geçmiş satırının `ts_ms`'iyle aynıdır; (3)
  `guncelleme_ms` kayıt başına geriye gitmez. Kol C bunları `apps/phone/docs/AJANDA.md`'de "telefonun
  dayandığı servis değişmezleri" başlığıyla yazıyor ve servis testleriyle sabitliyor.
- **Kotlin notu (kapandı).** Eski "kopya ve hatırlatmalar silinir" kaldırma onay metni yanlıştı
  (`eslesmeyiKaldir` koparmadır); D6'da `GecisMetinleri`/`EslestirmeMetinleri` ile düzeltildi.

### v3 alanlarının taşınması (R1)

Yerel yazar ve D2 yolları v3 alanlarını (`simge`, `bolge`, `bolge_konumu`, `varis`, `baglantilar`, `ekler`, dar `tekrar`) artık taşır (`83988de`, `73f5908`). Sınama: `tests/v3_tasima.rs`.

- `iyimser::eklenen_kayit` v3'ü ve elle alanlarını kurar.
- `v3_farki` / `kayit_farki` (`motor/islem.rs`): bölge değişirken konum korunacaksa `bolge_konumu` açıkça gönderilir.
- `kuyruga_islemler` ve `icerik_ayni` v3'ü sayar; v3 farkı olan kayıt "aynı" sayılmaz.
- Yerel geçmişte v3 parçaları tutulur.
- Temeli bilinmeyen birleşmede yalnız PC'de olan v3 geri gönderilmez (`pc_v3_alanlariyla`).
- D4 olası çift anahtarı bölgeyi sayar.
- v2 serviste dökülen v3 işlemi ertelenir (yukarıdaki "Erteleme"), ret listesine düşmez.
- Kol C'nin üç `#[ignore]` testi açıldı (`yerel_kipte_v3_alanli_ekleme_kisitsiz_uygulanir`, `koparmadan_sonra_v3_baglanmada_ertelenen_deger_pcye_gider`, `ice_aktarilan_v3_alanli_kayit_v2_serviste_ertelenir`).
- `duzenle` ve `ekle` v2 olarak kaldı (v3 alanı olmayan işlem v2 baytlarıyla gider).
- Ret düzeltmesi artık `retDuzelt(islemId, govde)`: hedefi (var olan kayıt ya da yeni kayıt) çekirdek seçer ve v3'ü korur; `ertelenen_atildi` girdisinde kullanılamaz (onun yolu `ertelenenGeriAl`).
- R1b çekirdek (`0d2ed2b`):
  - R3: bölünen `ekle` reddedilince v3 kalanı ret girdisine katılır ve kuyruktan düşer (`reddedilen_eklenin_kalani`, `kanal.rs`'te 7 satır).
  - R4: `ret_duzelt` v3 yüzünden reddedilen düzeltmede döngüye girmez.
  - R5: silinecek kaydın v3 farkı dökülmez.
  - R6: sözleşme 2 yedeğinde v3 yokluğu "bilinmiyor" sayılır; telefondaki değer korunur.
  - R8: gövdesiz ret girdisi (`sil`, durum, onayla, geri yükle) formla düzeltilmez, `GecersizGirdi` döner.
  - R10: temelsiz birleşmede varış bölgesinden kopmaz.
  - `ertelenenGeriAlDenetimli`: listede olmayan girdi için `bulundu=false`; atılmamış (`ertelenen_atildi` olmayan) girdi için `GecersizGirdi`.
- R1b Kotlin (`1cb23af`): `BaglantiDenetcisi` `Degisim.gecmis`'te de durumu okur; yoklama bekleyişi `yukariTekrarMs` ile sınırlıdır; `RetSatiri`'na `ertelenenAtildi`, `geriAlinabilir`, `v3Ozeti` (`V3AlanMetni`) eklendi; plan bildirimi geçiş işaretine yazmaz.

## Dışa ve içe aktarma (D3)

Bağımsız kipte telefonun tek yedeği. Çekirdek dosya sistemine dokunmaz: belge metni girer ve çıkar; zip'i
Kotlin yazar ve okur. Kurallar `motor/aktarma.rs` başındadır.

- **Belge** (`ajanda.json`, UTF-8, anahtarlar sıralı): `bicim` (`eren_ajanda_yedegi`), `bicim_surumu`,
  `sozlesme_surumu`, `uygulama_surumu` (yalnız tanı), `olusturma_ms`, `kip`, `kayitlar` (modelin kendi kayıt
  JSON'u, mezar taşları dahil), `ekler`, `bolgeler`, `retler` (yalnız biçim 2). **Sürüm kuralı:** `bicim`, `bicim_surumu` ve
  `sozlesme_surumu` katı okumadan önce bakılır; `bicim_surumu` ya da `sozlesme_surumu` bu uygulamanınkinden
  büyükse belge bütünüyle reddedilir (okuyamayacağı alanı sessizce atmaz). Eski sözleşme sürümü okunur; kendi
  sürümünde şema katıdır. `ekler`, kaydın başvurduğu dosyaların tekil dizinidir (`{ozet, bayt, mime}`;
  `ozet` sha256 küçük harf hex, dosya kapta `ekler/<ozet>`); ek üstverisi kaydın içindedir (v3). Bugün hep
  boştur. `bolgeler` hep boştur (dolu dizi reddedilir); bölgeler gelince öğe şeması tanımlanır ve
  biçim sürümü 4'e ayrılır (okuyucu 4 ve üstünü reddeder). **Biçim 2, 3 ve `retler`:** yazıcı gereken en
  düşük sürümü yazar (ret girdisi yoksa 1; varsa 2; bir ret öğesi biçim 2'nin taşıyamadığını taşıyorsa 3);
  okuyucu 3'e dek okur. `retler` biçim 2 ve 3'te vardır ve orada zorunludur; biçim 1 okuyucusu onu (alan
  bilinmiyor) reddeder, biçim 1 okuyan eski uygulama da biçim 2 ve 3 belgesini sürüm hatasıyla reddeder.
  Öğe (biçim 2): `{govde, islem, islem_id, kayit_id, neden, ts_ms}`. **Biçim 3** ret satırını bütünüyle
  taşır (V1): ayrıca `islem_json` (satırın metni bayt bayt: işlem, atılmış ertelenen değişikliğin taban
  bilgili hali, Kol C'nin `atma_tabani` anahtarı dahil, okunamayan metin ya da kaydın hali; `govde`
  isteğe bağlı) ve `kayit_sonra_degisti`; `neden` yerel ad da olabilir (`[a-z0-9_]{1,64}`,
  `ertelenen_atildi` gibi). Gövdesiz girdiler de girer. Biçim 2 yalnız hiçbir şey kaybolmayacaksa
  yazılır (`ret_ogesi`). `DisaAktarma.bicimSurumu`
  yazılan belgenin sürümünü verir: 2 ya da 3 ise biçim 1 okuyan eski uygulama dosyayı (kayıtlarıyla birlikte)
  bütünüyle reddeder; dışa aktarma sonucu bunu söyler (`ESKI_SURUM_ACAMAZ`: bu ya da daha yeni bir sürümle
  geri yüklenir), otomatik yedek de (`YedekSonucu.Yapildi.eskiSurumAcamaz`). Ret girdileri düzeltilir ya da
  atılırsa biçim 1 yazılır.
- **Zip kabı** (`aktarma/YedekKabi.kt`): kökte `ajanda.json`, ekler `ekler/<ozet>`; ad, dizin ve sınırlar
  çekirdekten gelir (`aktarmaBicimi`). Sınırlar: bir ek 4 MiB, ek sayısı 10 000, ekler toplamı 16 MiB, belge
  64 MiB (aşağıda), açılmış toplam 80 MiB (+ham payı). Eski köprüden 0 gelen alan en dar sınır sayılır.
  Kotlin okuması yığın bütçesine de bağlıdır (aşağıda). Okurken her girdi adı beyaz listeden geçer; yol kaçışı (`..`, mutlak
  yol, ters bölü), beklenmeyen ve yinelenen girdi reddedilir. Boyutlar başlığa güvenilmeden açılırken sayılır
  (şişirme saldırısı reddi); `ekler/` girdileri de açılmış toplama girer (saklanmayan dizin girdisinin
  okunmamış kalanı da sayılarak tüketilir).
- **Bellek ve sınırlar (çekirdek).** Belge ağaca çevrilmez: `yapi_tara` metni ağaç kurmadan bir kez geçer
  ve sınırları uygular: `kayitlar` en çok 100 000 öğe, `retler` en çok `RET_DIZISI_AZAMI` öğe, bu iki dizinin
  dışındaki bölüm en çok 4 MiB (ağaç kurulmadan önce denetlenir) ve 100 000 sözcük (anahtar ya da değer),
  iç içelik 127 (serde_json ile aynı), `ekler` 10 000 öğe. Bir kayıt en çok 256 KiB; büyüğü yalnız
  kendini geçersiz kılar. Kayıtlar `plan_kur`'da tek tek çözülür (bellek: belge metni + öğe aralıkları + o
  anki kaydın ağacı). Öğenin içindeki sözdizimi hatası bütün belgeyi reddeder.
- **Belge sınırı** 64 MiB. Rust'ta ayırma hatası süreci düşürür (`catch_unwind` yakalamaz), bu yüzden
  güvenilmeyen belgenin çekirdekteki payı belge sınırıyla sınırlıdır. Modelden hesaplanan en büyük belge
  (`50 000 × 37 961 + 10 000 × 256 + 4096` ≈ 1,77 GiB) artık yalnız bilgidir: telefona sığmaz.
  **Takas:** dolu telefonda (`KAYIT_ADET` = 50 000) kayıt başına ortalama 1342 bayt sınırı vardır (ölçülen
  olağan kayıt 472 bayt, ağır gerçekçi kayıt 2875 bayt). Sınırı aşan telefonun yedeği bu sürümde içe
  aktarılamaz; dışa aktarma onu yine yazar (yazarken boyut sınırı uygulanmaz, belge ağaç kurmadan yazılır) ve
  `DisaAktarma.ice_aktarma_sinirini_asiyor` ile uyarır. Bunun dışında dışa aktarmanın yazdığı belge
  boyutla reddedilmez.
- **Uygulama iki geçişlidir** (`ice_aktar`): önce yalnız iz, tutarsa aynı plan yeniden kurulurken her yazılacak
  sınıflandığı anda yazılır; yazılacaklar bellekte birikmez.
- **Kotlin yığın bütçesi** (`YedekKabi`): kullanılabilir bellekten (`maxMemory - kullanılan`) pay düşülür; pay
  32 MiB ile yığının dörtte birinden büyük olanıdır. Belge iki kat sayılır (bayt + metin). Bütçe aşılırsa
  `YedekHatasi.BellekYetmez` (kullanıcıya `BELLEK_BUTCESI`); `OutOfMemoryError` yakalaması yalnız son çaredir.
- **Kotlin ikinci eşik: bu telefonun yığın bütçesi** (`YedekKabi.buTelefondaAcmaButcesi`). Çekirdek sınırı
  (64 MiB) bütün telefonlar için aynıdır; açmanın gerçek bellek isteği telefona göre değişir. Bütçe
  `maxMemory − pay − 32 MiB taban`'dır (pay okuma bütçesindekiyle aynı; taban, yeni açılmış uygulamanın
  yığında zaten tuttuğudur, `TABAN_KULLANIM`). Belge bütçeye iki kat sayılır (`acmaBellegi`: bayt + metin;
  ekler eklenir). 128 MiB yığında bütçe 64 MiB, yani yaklaşık 32 MiB belgeye yeter; 192 MiB'ta 112 MiB, yani 56
  MiB belgeye; 256 MiB ve üstünde çekirdek sınırı (64 MiB) belirler, bu eşik uyarı çıkarmaz. 32 MiB taban bir
  tahmindir, cihazda ölçülmedi (JVM testinde taban ~2 MB; View tabanlı küçük bir uygulamanın açılışta 10-25
  MB tuttuğu varsayıldı, üst yanı alındı). Belge çekirdek sınırının altında ama bu bütçeyi aşıyorsa yazılır ve
  uyarılır (`BELLEK_YETMEYEBILIR`: bu telefonda geri yüklemeye bellek yetmeyebilir); uyarı elle dışa
  aktarmada (`AktarmaAkisi`) ve otomatik yedekte çıkar (`YedekBildirimi.BellekAsiyor`, `sonBellekAsiyor`);
  sınır aşılıyorsa yalnız `SINIR_ASIYOR` söylenir. Hata metinleri iki farklı durumu ayırır: yığın bütçesi
  aşılınca (`BELLEK_BUTCESI_METNI`) "bu telefonda şu an açılamıyor" (dosya bozuk sayılmaz; kapatıp açmak ya da
  daha çok belleği olan cihaz); biçim sınırı aşılınca (`COK_BUYUK_METNI`) "bu uygulamanın büyük bir yedeği
  olabilir" (dışa aktarma sınırı aşan belgeyi de yazar, ama bu sürümle geri yüklenemez).
- **Ön tarama.** Dizide fazladan iki nokta (`[:1]`, `[1,:2]`) reddedilir; 256 KiB üstü öğenin içi ağaç
  kurulmadan denetlenir (`sozdizimi_denetle`). Kök anahtar kopyalanmaz: adı kök dizi adlarıyla kopyasız
  karşılaştırılır (kaçışlı yazım yalnız bir kök dizi adı olabilecek uzunluktaysa çözülür,
  `KOK_ADI_KACISLI_AZAMI`), dev anahtar dış bölüm sınırında reddedilir; 60 MB'lık anahtarda tepe bellek 60
  MB'tan 205 bayta indi (kaçışsız ve kaçışlı, `tests/aktarma_bellek.rs`). Tarama ile serde_json'un kabulü aynıdır: 40 000 adımlık
  bulanıklaştırma testi ve iç içelik sınırının iki yanı testlidir.
- **Gelecek tarih kuralı.** `guncelleme_ms` şimdi + 1 günden ileri olan kayıt geçersizdir (kırpılmaz,
  reddedilir): "daha yeni kazanır" kuralı o anı her yerel kayda üstün sayar (uzak tarihli mezar taşı
  telefonu siler) ve servisin `max(önceki, şimdi)` kuralı onu yapışkan kılar.
- **Köprü yüzeyi.** `aktarmaBicimi()` (kap düzeni ve sınırlar); `disaAktar()` (`DisaAktarma`: belge, kayıt,
  silinmiş, okunamayan, `retListesinde`, `retYedekte`, `bicimSurumu`, `iceAktarmaSiniriniAsiyor` bayrağı, kip, ekler); `iceAktarmaOnizlemesi(belge)` (`IceAktarmaOnizlemesi`:
  yeni, güncellenecek (içinde `silinecek`, `geriYuklenecek`), aynı, atlanacak, geçersiz (ilk 20'si
  konumla), sınır aşan, gönderilmeyecek, `taslakGonderilmeyecek`, `taslakOnaylanacak`,
  `taslagaDonecek`, `okunamayanRetListesine`, `retListesineGelecek`, `retGecersiz`, `retBayat` (hep 0),
  `retSonraDegisen`, `retSinirAsan`, kuyruğa girecek işlem,
  ekler, `iz`); `iceAktar(belge, iz)`. Bayt karşılıkları
  `iceAktarmaOnizlemesiBayt`, `iceAktarBayt`: belge `String`'e çevrilmeden geçer; ikisi karıştırılabilir (aynı
  belge, aynı sonuç; Kotlin `AktarmaAkisi` bayt yolunu kullanır). `iz` içeriği kapsar (kip, her öğenin metni ve sınıfı,
  güncellenecek kaydın telefondaki satırı): başka dosya ya da önizlemeden sonra değişen kayıt eski izle
  uygulanmaz. `iz` zorunludur: iz yoksa ya da işlem içinde yeniden kurulan plan onunla tutmuyorsa hiçbir şey
  yazılmaz: `uygulandi` yanlış, `plan` güncel önizlemedir (kullanıcıya yeniden gösterilip onayıyla yeni
  `iz`'le çağrılır). Uygulama tek SQLite işlemidir.
- **Yeni önizleme alanları.** `taslakOnaylanacak`: telefonda taslak olan kaydın dosyada daha yeni ve onaylı
  hali; uygulanınca telefondaki taslağı onaylar, ayrı sayılır (kullanıcı onaylamadan uygulanmaz).
  `okunamayanRetListesine`: yerel kipte satırı okunamayan telefon kaydı dosyadakiyle onarılırken eski
  metni ret listesine düşer (bağlı kipte atlanır). `taslagaDonecek`: yerel kipte telefonda onaylı, dosyada daha
  yeni ve taslak olan kayıt (bağlı kipte hep 0). `retListesineGelecek`, `retGecersiz`, `retSonraDegisen`, `retSinirAsan`:
  biçim 2 ve 3 `retler` girdileri (aşağıda). Yalnız gönderilemeyen değişiklik içeren bir yedekte de onay sorulur. **Mezar taşı
  kuralı:** dosyadaki onaylı mezar taşı telefondaki taslağın yerine geçiyorsa kayıt yalnız `silinecek` sayılır
  (`onayla` gönderilmez, taslak kalır). Okunamayan satırın bayrakları (`silindi`, `taslak`) dört sayıda
  (`taslakOnaylanacak`, `taslagaDonecek`, `silinecek`, `geriYuklenecek`) aynı kuralla sayılır. Tarama ve
  önizleme sayıları serde_json'un kabul kuralıyla aynıdır.
- **Çakışma kuralı.** Aynı `kayit_id` telefonda da varsa `guncelleme_ms`'i büyük olan kazanır (mezar taşları
  dahil); eşitse telefondaki kalır. Her kayıt ayrı sınıflanır: tek bozuk kayıt (şema, kural, dosyada yinelenen
  kimlik, bilinmeyen dilim) aktarmayı düşürmez, geçersiz sayılır; kayıt sınırı dolunca yeniler `sinir_asan`.
- **Yerel kip:** doğrudan yazılır, alanlar korunur (oluşturma ve güncelleme anı, kaynak izi, `elle_alanlar`,
  örnekler, durum, taslak, silindi); revizyon yerel sayaçtan; yerel geçmişe içe aktarma satırı (yeni: doğum
  parçası, güncelleme: fark); kalıcı olunca alarm senkronu.
- **Bağlı kip:** servis yazar, bu yüzden D1'in dökme kuralıyla işlemler kuyruğa girer (yeni: `ekle`, durum,
  örnekler, `sil`; güncelleme: `geri_yukle`, `guncelle`, `durum`, örnekler, `onayla`, `sil`). Kaybolanlar:
  kaynak izi (servis `ekle`'yi bu telefonun elle ya da sesli not yazması sayar), oluşturma ve güncelleme
  anları, revizyon, `elle_alanlar` (servis hesaplar), taslak olmayanın taslağa döndürülmesi, telefonda
  olmayan mezar taşları (PC'nin sınırını ölü kayıtla doldurmasın; `gonderilmeyecek`). Telefonda olmayan
  taslak atlanır (`taslakGonderilmeyecek`): servisin `ekle`'si onaylanmış kayıt doğurur, kullanıcının
  onaylamadığı öneri onaylanmış gibi gitmesin (dosyada kalır; yerel kipte taslak olarak alınabilir).
  Servisin reddettiği işlem ret listesine düşer.
- **Ret listesi ve belgeye girmeyenler.** Kuyruk belgeye girmez: etkisi görünen kopyadadır (bağlı kipte iyimser
  hal aktarılır). Ret listesi satırı olduğu gibi biçim 2 ya da 3 `retler`'e girer (D3 gözden geçirmesi
  Y4, tam taşıma V1): birleştirme ya da içe aktarmadan sonra taslaklar, okunamayan satırların okunabilen hali
  ve servisin silip telefonun düzenlediği kayıtlar yalnız orada yaşar; yedeğe girmeselerdi telefonla
  giderlerdi. `islem_json` ve yerel neden bayt bayt gider (v3 değişikliği, atılmış ertelenen değişiklik ve
  `atma_tabani` kaybolmaz); gövdesiz girdiler de girer (`sil`, `durum`, okunamayan metin). İçe
  aktarmada her öğe ayrı okunur; geçersiz ya da dosyada yinelenen `islem_id` `retGecersiz` sayılır, telefonun
  ret listesinde aynı `islem_id` varsa yinelenmez, ret listesi `KAYIT_ADET`'e ulaşınca kalanlar alınmaz
  (`retSinirAsan`), kalanlar (`retListesineGelecek`) iki kipte de ret listesine yazılır. Okunamayan satır
  olduğu gibi yazılır. `retListesinde` belgeye girmeyen ret girdisini sayar: kimliği ya da anı
  okunamayanları ve `RET_DIZISI_AZAMI`/öğe sınırını aşanları (yalnız telefonun ret listesinde kalır;
  kullanıcı önce düzeltmeli ya da atmalı); girenlerinki `retYedekte`. Yerel geçmiş belgeye girmez: yeni telefonda içe aktarma
  satırıyla başlar.
- **Kaydı yedekten sonra değişen ret girdisi (`retSonraDegisen`; eski `retBayat` hep 0).** Telefondaki kayıt
  yedek alındıktan sonra değişmişse girdi atılmaz, alınır ve `kayitSonraDegisti` ile işaretlenir (işaret
  `meta`'da tutulur, yedekle taşınır). Eski kural girdiyi geri getirmiyordu; bağlı kipte servisin sonradan
  düzenlediği kaydın tek kopyası yedekteki girdiyse ona ulaşmanın yolu kalmıyordu. Saat karşılaştırılmaz:
  kayıt dosyada geçerliyse telefondaki hali dosyadakinden farklı olup kalıyorsa (`atlanacak`) ya da bilinemiyorsa
  (`kayit_sonra_degisti_mi`) işaret konur. Düzeltmesi (`retDuzelt`) işaretli girdiyi yeni kayıt olarak ekler;
  kaydın şimdiki halini yedekteki eski istekle ezmez. Kalan açık: çözülmüş bir `ekle` reddi ayırt edilemez
  (düzeltmesi yeni kimlikle eklenir, girdinin `kayit_id`'si hiçbir kayda bağlanmaz); geri gelir, yeniden
  düzeltilirse kopya kayıt doğar, hiçbir şey ezilmez. Yeni test:
  `ice_aktarilan_atilan_girdinin_tabani_geri_almada_kullanilir`.
- **Mahremiyet.** Belge içeriği (başlık, açıklama, ileride bölge) günlüğe, hata mesajına ya da
  `GecersizKayit`'e girmez. Hatalar yalnız konum (şemanın alan adları ve sıra numaraları, `guvenli_yol`) ve
  sabit neden taşır; JSON sözdizimi hatası yalnız satır ve sütun. Kotlin metinleri yalnız sayı ve tarih
  taşır.
- **Ölçüm** (`tests/aktarma.rs`, 5000 kayıt, hata ayıklama/yayın): önizleme 162/50 ms; yerel uygulama
  844/301 ms; dışa aktarma 302/94 ms; bağlı kipte dökme 1,16/0,50 s. Bellek (`tests/aktarma_bellek.rs`):
  önizleme yazılacak kayıtları tutmaz; 20 000 kayıtlık 13,6 MB'lık belgede önizleme tepesi 1,85 MB; uygulama
  tepesi 35,1 MB, bunun 33,7 MB'ı alarm senkronu. 20 MiB'lık bir dış alan 0,5 MB tepeyle reddedilir.
  Kotlin tarafı (`test/aktarma/YedekBellekTest.kt`, `AJANDA_BELLEK_OLC=1`, en küçük yığın): 24,4 MB belgede
  okuma tek başına 55 MB, bütçe kuralıyla 83 MB; 61,5 MiB belgede 127 MB ve 166 MB.
- **Kotlin** (`aktarma/`, saf mantık, JVM testli): `YedekKabi` (zip), `AktarmaAkisi` (adım adım: dışa
  aktarma; dosya oku -> `Adim.Onay` -> `onayla` ya da `vazgec` -> `Adim.Bilgi`/`Hata`; önizlemeden sonra
  telefon değiştiyse yeni planla yeniden onay; bellek bütçesi aşılırsa `BellekYetmez` Hata adımı, `OutOfMemoryError`
  yalnız son çare), `AktarmaMetinleri`. Görünüm bugün `AnaEkran`'ın ⋮ menüsünde
  SAF (`ACTION_CREATE_DOCUMENT`/`OPEN_DOCUMENT`) bağlantısıdır (eski görünüm; yeni arayüz `AktarmaAkisi`'ni
  çağıracak).
- **Açık kalanlar.** Ek deposu yer tutucudur (ek yok; `kayit_ekleri` v3 alanları gelince dolacak). Ekran
  döndürmede bekleyen içe aktarma (okunmuş dosya, önizleme) kaybolur. Gelecek tarih kuralı yalnız içe
  aktarmada uygulanır: eski bir içe aktarmadan zaten girmiş gelecek tarihli an onarılmaz.

### Otomatik klasör yedeği (D6)

- Varsayılan kapalı. Açıksa ve klasör seçilmişse günde bir yedek alınır (son başarılı yedeğin cihaz günü bugün
  değilse zamanı gelmiştir). Son 7 gün tutulur (gün başına en yenisi). **Ad kalıbı**
  `ajanda-otomatik-yedek-<gün>-<SSddss>-<kurulum>.zip`; her deneme yeni ad alır. Kurulum kimliği (8 küçük hex)
  `noBackupFilesDir`'de tutulur ve **yalnız dosya yoksa** (ilk açılış, "verileri sil") ya da içeriği kimlik
  değilse (bozuk) üretilir; dosya varken okunamazsa (izin, G/Ç) yeni kimlik üretilmez, deneme hata verir ve
  sonra yeniden denenir (yeni kimlik eski yedekleri sahipsiz bırakırdı). Yazım geçici dosya + atomik yeniden
  adlandırmadır. "Verileri sil" sonrasında yeni kimlik üretilir ve eski kimliğin yedekleri silinmez (bilinçli:
  silinen uygulamanın yedeği başka telefonun ya da elle alınmış yedek gibi korunur).
- **Sahiplik:** temizlik yalnız bu kurulumun kalıbına uyan dosyalara (ve artık `.yaziliyor` geçicilerine)
  dokunur. Elle alınan yedeklere, başka telefonların yedeklerine ve eski biçimli adlara dokunulmaz.
- **Tetikleyici:** `EsitlemeIsi` hizmetinde ağ koşulu olmayan ayrı iş (`YEDEK_ISI`). Saatlik iş kaldırıldı;
  yerine bir sonraki gerekli anda çalışan tek seferlik iş var (en az 1 dk, en çok 24 sa sonra). Hatada geri
  çekilir: 30 dk, 1 sa, 2 sa, 4 sa, en çok 6 sa. Eşitleme işleri ve manifest değişmedi. Ayar dosyası
  yazılamadıysa (iç bellek dolu: `SharedPreferences.commit()` yanlış) `TercihYedekAyarlari` `IOException`
  atar ve `sonYazimBasarisiz` kalkana dek iş en az 6 saat sonraya kurulur (`AYAR_YAZILAMADI_BEKLEMESI_MS`):
  sonuç diske geçmediğinden soğuk başlayan süreç onu bilmez, her dakika yeniden denerdi.
- **İşin yeniden kurulması (`YedekIsDenetcisi`).** Zorla durdurma ya da üreticinin pil yöneticisi kurulu işi
  siler; o zaman kendini yeniden kuracak bir çalışma da olmaz. `isiDenetle` (açıksa ve kurulu tek seferlik
  kalıcı iş yoksa kurar; varsa zamanlamasına dokunmaz; eski sürümün periyodik işini tek seferliğe çevirir) üç
  yerden çağrılır: (1) görünürlük: `BaglantiYoneticisi.izle` uygulama öne gelince `isiDenetleArkaPlanda`
  (yedek iş parçacığında, ana iş parçacığını tutmaz); (2) eşitleme işi: `EsitlemeIsi` her çalışmada
  `yedekDenetle`'yi çağırır (`ArkaPlanEsitleme`); (3) açılış alıcısı: `AcilisAlici` açılış, güncelleme, saat ya
  da dilim değişiminde. Hata atmaz, ayar ekranına bağlı değildir. **Çalışan işe dokunulmaz:** iş bu süreçte
  çalışırken (`isCalisiyor`) `denetle` ve `yenidenKur` hiçbir şey yapmaz, çünkü çalışan iş aynı numarayla
  yeniden kurulursa sistem onu durdurur; iş bitince `sonrakiniKur` güncel ayarla kurar. Kural saf sınıf
  `YedekIsDenetcisi`'ndedir (`YedekIsPlanlayici` arkasında; testte bellekte, üretimde `JobScheduler`).
- **Yazma ve doğrulama:** önce `<ad>.yaziliyor` adıyla yazılır, bitince yeniden adlandırılır (sağlayıcı
  yeniden adlandırmayı desteklemiyorsa son ad doğrudan yazılır). Yazılan dosya geri okunup doğrulanır (CRC,
  bayt boyu, ek sayısı ve dosya sonundaki merkezi dizin kaydı: girdi sınırında kesik dosya da yakalanır);
  tutmazsa dosya silinir ve sonuç `DOGRULANAMADI`. Sağlam eski dosya ancak yenisi doğrulandıktan sonra silinir;
  yarım yazımın izi sonraki denemede temizlenir: iz gösterdiği dosya bütünse (`butunMu`: sonuna dek yazılmış
  zip, CRC'ler tutuyor, tek belge) sağlam yedektir ve tutulur, değilse silinir. Böylece süreç son ada
  doğrudan yazarken ya da doğruladıktan sonra izi silmeden ölse bile bütün bir son dosya korunur. Gelecek
  tarihli dosyalar en eski sayılır; az önce yazılan dosya her zaman kalır. Klasör değişince durum sıfırlanır.
- **Temizlik sırası (T4).** Yazmadan sonraki temizlik geçici dosyalara dokunmaz (`geciciDahil = false`); geçici
  dosya temizliği deneme başındadır. Doğrulanan dosya sağlayıcı kimliğiyle korunur (`koruKimlikler`): yeniden
  adlandırmada kimliği koruyup listeyi önbellekten veren sağlayıcı (Drive benzeri) az önce doğrulanan yedeği
  eski geçici adıyla gösterebilir; ad kalıbına bakan temizlik onu silerdi, kimliği hiçbir adla silinmez ve kendi
  gününü tutar. Bunu 14 günlük bir senaryoda sınayan sahte sağlayıcı testi vardır. Son doğrulanan dosyanın kimliği (`sonKimlikler`) deneme başında da korunur (V3): yeni deneme başlarken geçici dosya temizliği önceki denemenin doğrulanmış dosyasını silmez.
- **Bildirim:** kanal `ajanda_durum` ("Eşitleme ve yedek durumu", düşük önem). Her sorun için bir kez
  bildirim gösterilir; izin ya da kanal yoksa durum saklanır ve ekran söyler. Bildirim arayüz görünürken de
  gösterilir (yedeğin durumunu gösteren ayar ekranı henüz yok; bildirim düşük önemli ve bir kezdir); önde
  çalışan yedekte yalnız sonuç söylenmiş sayılır ve eski bildirim kalkar. Yedeği kapatmak ve klasör seçmek de
  (aynı klasör dahil) hata ve bildirim durumunu sıfırlar, eski bildirimi kaldırır. Sınır aşan yedeğin
  (`SinirAsiyor`) yanında, sınırın altında ama bu telefonun açma belleğini aşan yedek için ayrı bir bildirim
  vardır (`BellekAsiyor`, bir kez). `YedekGorunumu` yeni alanları:
  `sonYedekGunOnce` (son başarılı yedekten bu yana gün), `soylenmemis` (kullanıcıya henüz söylenmemiş sorun).
- **Sınıflar:** `OtomatikYedekPlani` (saf kurallar: zaman, ad, silinecekler), `OtomatikYedekci` (saf akış, tek
  deneme `@Synchronized`), `OtomatikYedek` (SAF katmanı, ayarlar, iş kurma; ayarlar ekranı için giriş noktaları),
  `YedekIsDenetcisi` (işin kurulma kuralı, saf).
- **Hata türleri** (`YedekSorunu`): `KLASOR_YOK`, `ERISIM_YOK`, `YER_YOK`, `YAZILAMADI`, `DOGRULANAMADI`,
  `COK_BUYUK`, `EK_BOZUK`, `BELLEK`, `CEKIRDEK`, `BEKLENMEYEN`; son hata ve anı ayarlarda tutulur.
- **Açık kalanlar.** SAF katmanı ve `JobScheduler` cihazda denenmedi. Eski biçimli `ajanda-yedegi-*.zip` dosyaları ve
  yeniden kurulumdan önceki yedekler hiç silinmez. Ekler okunurken belleğe alınır; en çok 16 MiB ve yığın
  bütçesiyle sınırlıdır.

## Birleştirme önizlemesi (D4)

Yerel kipten servise bağlanırken (yeni eşleşme, koparmadan sonra yeniden eşleşme, farklı `depo_id`'li
`welcome`) yerel kayıtlar sorulmadan dökülmez. Kurallar `motor/birlestirme.rs` başındadır.

- **Durum makinesi.** Servisin tam kopyası toplanır; `esitlendi`'de plan kurulur (`yerel::dokme_plani`, salt
  okur). Her telefon kaydı `Ayni` ise (kayıt yok, servisle aynı ya da yalnız servis ilerlemiş) soru yoktur:
  dökme hemen, eskisi gibi. Aksi halde **onay beklenir**: kip `Yerel` kalır (yerel yazmalar sürer), bağlantı
  `Telafi` aşamasında açık kalır (servis telefonu canlı sayar; gelen canlı `kayit`'ler toplanan kopyaya yazılır),
  `meta.birlestirme_bekliyor` servisin `depo_id`'sini taşır.
- **Onay** (`birlestirmeyiOnayla(iz)`): tek SQLite işleminde plan yeniden kurulur; `iz` şimdiki planla tutmazsa
  hiçbir şey yazılmaz, yeni plan döner (D3 kalıbı). Tutarsa D2 dökme kuralları işler, olası çiftler kaydedilir,
  kip `Bagli`, bağlantı `Canli`. Kalıcı onaydan sonra gelen hata (ör. alarm senkronu, kuyruk) başarıyı
  bozmaz. `BirlestirmeSonucu.zatenUygulandi`: bekleyen yokken aynı izle gelen onay (ikinci ya da gecikmiş);
  gecikmiş onaya "daha önce yapıldı" denir.
  `plan == null` ve `zatenUygulandi == false` ise bağlantı kopmuştur, hiçbir şey yazılmamıştır.
- **Vazgeç** (`birlestirmedenVazgec`): yerel kipte süren bağlanmanın iptali: eşleşme ve cihaz anahtarı silinir,
  bağlantı kapanır; kayıt, ret listesi, PC temeli ve alarm değişmez. Yeniden bağlanmak için QR gerekir (eşleşme
  kalsaydı her bağlantıda aynı soru gelirdi).
- **Kopma ya da yeniden açılış** onaydan önce: toplanan kopya ve işaret atılır (`telafiyi_sil`); hiçbir kayıt
  değişmemiştir, sonraki bağlantı yeniden alır ve yeniden sorar. Kopya saklanmaz: onay her zaman servisin o
  anki kopyasına göre olmalıdır.
- **Olası çift.** Planda servise `ekle` ile gidecek telefon kaydı ile servisin kopyasında olup telefonda
  bulunmayan kayıt: ikisi de silinmemiş, kimlikleri farklı, tekil anahtarları (`ajanda_tekil_anahtari`: tür,
  başlık, zaman çekirdeği; kapsamsız) aynı. Durum, `ifade`, süre, açıklama, hatırlatma anahtara girmez. v3
  `bolge` de girmez (`ajanda_tekil_anahtari`'na `None` verilir: D4'ün v2 baytları); bölgesi farklı iki kayıt bu
  yüzden olası çift sayılabilirdi; R1 ile anahtar bölgeyi sayar ("v3 alanlarının taşınması (R1)"). İkisi
  de tutulur, birleştirilmez; onayda `meta.olasi_ciftler`'e yazılır; `olasiCiftler()` yalnız ikisi de görünen
  kopyada canlı olanları döndürür (biri silinir ya da `ekle` reddedilirse işaret düşer).
- **Taslak kuralı.** Servisin kopyasında olmayan yerel taslak `ekle` ile gitmez (servis taslak alamaz; onaylı
  kayıt doğururdu): dökmede ret listesine düşer, görünen kopyadan çıkar; düzeltilirse yeni onaylı kayıt olur.
  Servisin kopyasında olan taslak alan alan birleşir. Önizlemede `taslaklar` sayılır.
- **Köprü yüzeyi.** `birlestirmeOnizlemesi()` (bekleyen yoksa `null`), `birlestirmeyiOnayla(iz)`,
  `birlestirmedenVazgec()` (`KoparmaSonucu`), `olasiCiftler()`, `olasiCiftleri(kayitId)`. Gözlemciye önizleme
  hazır olunca ve kalkınca `Degisim.baglanti`. İz: sınıflar, içerikli işlemler, ret metinleri, çakışan
  alanlar, her kaydın hali, okunamayan PC temeli sayısı, servisten gelecekler, olası çiftler.
- **Kotlin** (`birlestirme/BirlestirmeAkisi`, saf, JVM testli; `AktarmaAkisi` kalıbı): `BirlestirmeCekirdegi`
  dar yüzü üzerinden kurulur. `ilgili(Degisim)` (baglanti, tumu, eslesme) doğruysa görünüm `denetle()` çağırır:
  `null` sorulacak şey yok; `Adim.Onay` ise `onayla(adim)`, `vazgec()`, `simdiDegil(adim)`. Onay `Adim.Onay`'ın
  iziyle yapılır: eski adımla gelen onay çekirdeği uygulamaz, yeni planla yeniden `Onay` döner. `onayla` plan
  değiştiyse yeni planla yeniden `Onay`, bekleyen kalmadıysa `Bilgi`. `BirlestirmeAkisi` ve `AktarmaAkisi`
  tek kilit altında çalışır; aynı adımla ikinci onay çekirdeğe gitmez (ilk sonucu döner). `simdiDegil`
  çekirdeğe gitmez; plan izine ve bağlantı kuşağına (`ag/BaglantiKusagi`) bağlıdır: plan değişince ya da
  yeni bağlantıda yeniden sorar, `denetle(zorla = true)` her zaman sorar. `bekleyen()` sorgusu ve şerit
  metni var ("bekleyen birleştirme" şeridi). Metinler yalnız sayı taşır.
  - **Eski ana ekranın bağlanması** (`9522fb5`, `d5d7768`, `711ba89`; `ekran/AnaEkran`). Birleştirme penceresinde üç düğme vardır; "Eşleşmeyi kaldır" ikinci onay ister (onay `kuyrukta + ertelenenIslem` sayısını gösterir). Bekleyen birleştirme şeridi vardır; durum göstergesi "Onay bekliyor" der (`DurumGostergesi.birlestirmeyle`).
  - Okunurken değişen plan "Kayıtlar bu arada değişti" diye uyarılır. Yer değiştiren soruda "Birleştir" 1 sn etkisizdir (yanlış dokunuşa karşı). Kaldırma onayı açıkken pencere değişmez.
  - Sonuçlar `SonucKutusu` ve dinleyiciyle yeniden yaratılan etkinliğe taşınır. "Şimdi değil" o bağlantı boyunca geçerlidir; şerit güncellenir. Vazgeç durumu yalnız başarıda sıfırlar.
  - Bilinen açık: okunamadı durumunda gösterge "Onay bekliyor" der (`DurumGostergesi` Kol U'nundur).
- **Açık kalanlar.** Onay beklerken gelen canlı kayıt kullanıcıya bildirilmiyor. Olası çift işaretini
  kaldıran çağrı yok (işaret yalnız kayıt silinince ya da reddedilince düşer).

## İlk açılış ve metinler (D6, mantık)

- **Metin kuralı.** Kullanıcıya görünen metinde "PC" geçmez: servis "Eren servisi", çalıştığı makine
  "bilgisayar" diye anılır. Testli: `KullaniciMetniTest`.
- **`kimlik/GecisMetinleri`** (saf): `baglantiyiKopar()`'ın `KoparmaSonucu`'ndan ve `sonGecis()`'in
  `GecisOzeti`'nden kullanıcı metni kurar (koparma onayı kuyruk sayısıyla, geçiş sonucu); sayısı sıfır olan
  bilgi için cümle kurulmaz. `EslestirmeMetinleri` eşleştirme metinlerini taşır.
- **`alarm/IzinPlani`** (saf karar + Android okuması): açılışta hiçbir izin istenmez; hatırlatmalı ilk kayıtta
  önce bildirim izni (Android 13+; reddedilmişse kayıtta yeniden sorulmaz), sonra kesin alarm (yalnız
  Android 12/12L'de kapatılabilir; sistem penceresi yoktur, ayara yönlendiren açıklama bir kez); ret sonrası
  ana ekrandaki uyarı şeridi sürer, uyarıya dokunmak açık istektir (sistem penceresi ya da ilgili ayar).
  **İzin kuralı:** güncellenmiş kurulumda kalıcı ret ayar ekranına götürür (kalıcı ret ile "hiç sorulmadı"
  Android'de ayırt edilemez; işaret güvenilmezse kalıcı ret sayılır). Bu karar kurulum ve güncelleme zamanına
  göre bir kez verilir ve saklanır.
- **Ekran işi Kol U'da.** Bu bölüm yalnız mantıktır.
- **Açık kalan.** `AnaEkran.onStart` hâlâ açılışta izin istiyor (U `IzinPlani`'na bağlayacak). Kol U'ya
  düşen: `AnaEkran`'daki izin istekleri `IzinPlani.bildirimIzniIste` üzerinden geçmeli.

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
- Form kararları (`govdeyi_hazirla`, ayrıntısı `kural/metin.rs` başında): her metin önce
  `ajanda_metni_temizle`; tek satırlık alanda (`baslik`, `zaman.ifade`) satır sonu/sekme içeren boşluk öbeği
  tek boşluğa iner; açıklamada `\r\n` ve `\r` -> `\n` (sekme kalır); kenar boşluğu JS `trim()` anlamıyla
  kırpılır; kırpma sonrası boş kalan isteğe bağlı alan (`aciklama`, `an`/`gun`/`donem` `ifade`'si) yok
  sayılır, zorunlu alanın boşluğu sorundur; uzunluk aşımı kesilmez, `GirdiSorunu` döner; son söz
  `KayitGovdesi::dogrula`'nındır. Motor `ekle` ve `duzenle`'de gövdeyi yeniden bundan geçirir.

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
- **Durum: yazıldı.** Uçtan uca testler `tests/uctan_uca.rs` (köprü yüzeyi + `tests/ortak` sahte PC),
  iç durum testleri `motor/testler.rs` (`esitleme` vektörleri SQLite'a karşı, bozuk kuyruk satırı, telafi
  tamponu), ölçüm `tests/buyuk_kopya.rs`.
- Kanal kararları (`motor/kanal.rs` başı): bağlantı başına tek `welcome`; aşamaya uymayan ya da çözülemeyen
  çerçeve, `error` çerçevesi, PC imzasının QR anahtarıyla tutmaması ve çerçeve işlenirken depo hatası
  bağlantıyı kapatır (`son_hata`). `pair_result{ok}` sonrası aynı bağlantıda `hello` yollanır (servis
  bağlantıyı açık tutar). Güven çapası QR'daki `server_public_key`'dir; `pair_result`'ınki saklanmaz.
- Kuyruk kararları: en çok bir işlem yolda, yalnız `Canli`'da. Yollanan satır kalıcı `yollandi` işaretlenir;
  sonuç gelmeden bağlantı biterse ya da süreç ölürse (sonraki `baglanti_acildi`'de) `Kopma` sayılır.
  Geçici ret aynı `islem_id` ile HEMEN yeniden yollanır (sans-IO motorda zamanlayıcı yok; sınır
  `ISLEM_DENEME`). Başarıda servis `rev` verdiyse ve o `kayit` henüz gelmediyse satır "onaylandı"
  (`bekledigi_rev`) olur: yollanmaz, iyimser hal görünmeye devam eder (sıra garanti değil; sonuç önce gelirse
  kayıt bir an kaybolmasın); sunucu kopyası o revizyona ulaşınca ya da telafi bitince düşer. Çözülemeyen
  (bozuk) satır yollanmadan `gecersiz_islem` ile ret listesine geçer. Görünen hali değiştirmeyecek işlem
  (zaten tamam olana `tamam`, silinmişe `sil`) kuyruğa girmez.
- Ret listesi girdisinin gövdesi: `ekle`'de gönderilen gövde; `guncelle`'de değişikliğin kendinden önceki
  hale uygulanmış hali (kayıt PC'de silinmiş olsa da kullanıcının istediği görünür). Sıra: ret anı, sonra
  kuyruk sırası.
- Sekmeler (`motor/sorgu.rs`): `Silinenler` `kapalilar_dahil`'i yok sayar (bitmiş ama silinmiş kayıt da geri
  yüklenebilsin). Çevrimdışı eklenenin `olusturma_ms`'i kuyruğa giriş anıdır; eşitlenince servisinki gelir
  (art arda uygulananlarda eşit olabilir, "en yeni üstte" sırası o zaman kimliğe düşer).
- Köprü içi (yüzey değişmedi): sorgular okuma bağlantısında; kaçırılan özeti gösterilemezse
  (`kacirilanlari_goster` hata) motor o satırların teslim işaretini kaldırır (`kacirilan_gosterilemedi`),
  sonraki senkron/yeniden kurulum pencere içindeyse yeniden gösterir; `alarmlari_yeniden_kur` tek işlemde.

#### Kotlin parçalarının bilmesi gerekenler (R4)
- Bütün çekirdek çağrıları eşzamanlıdır: ana iş parçacığından çağırma. Geri çağrılardan (özellikle
  `Gozlemci.degisti`, `Tasima.gonder/kapat`, `AlarmKabugu`) çekirdeğe eşzamanlı yeniden girme; işi başka iş
  parçacığına at. `KimlikKabugu` ve `ZamanKabugu` motor kilidi altında çağrılır (hızlı, kilitsiz olsun).
- K1: `eslestirmeQrCoz` -> `eslestirmeBaslat(qr)` (açık bağlantı varsa çekirdek onu kapattırır:
  `Tasima.kapat`) -> `BaglantiYoneticisi.simdiDene`. Sonucu gözlemciden (`Degisim.eslesme`) sonra
  `eslesmeDurumu()` ile oku: `Eslesti` ya da `Reddedildi{kod}` (yeni QR iste). `Bekliyor` > `Reddedildi` >
  `Eslesti` > `Yok` önceliği vardır: eski eşleşme dururken yeni QR reddedilirse `Reddedildi` görünür ama
  bağlantı eskisiyle sürer. `eslesmeyiKaldir` (D2) koparmadır: kopya, ret listesi ve alarmlar kalır, kuyruk, eşleşme bilgisi ve anahtar silinir (yerel kipte yalnız eşleşme bilgisi ve anahtar), açık
  bağlantıyı kapattırır ve `anahtariSil` çağırır.
- K2: `baglantiAdresi()` `null` ise bağlanma. `onOpen` -> `baglantiAcildi(tasima)` (hata: eşleşme yok ya da
  kabuk hatası; soketi kapat, `baglantiKapandi` çağırma). Her `onMessage` -> `cerceveGeldi(nesil, metin)`
  (hata atarsa çekirdek bağlantıyı her aşamada kapattırmıştır; Kotlin de soketi kapatır, günlüğe yazar). `onClosed/onFailure` ->
  `baglantiKapandi(nesil)` (her zaman, `Tasima.kapat` sonrası da). Arka plan işi için tamam ölçütü
  `baglantiDurumu().asama == CANLI && kuyrukta == 0`. Geçici ret çekirdekte hemen yeniden denenir; yeniden
  bağlanma beklemesi K2'nindir.
- K3: alarm/bildirim kabuğu `kacirilanlariGoster`'de gösteremediyse `KabukHatasi.Basarisiz` fırlatmalı
  (sessiz yutma bilgiyi kaybettirir; çekirdek hatada yeniden gösterir). `alarmlariYenidenKur` her açılış,
  önyükleme, saat ve dilim değişiminde.
- K4: `liste`/`kayit`/`retListesi` hızlıdır ve uzun eşitleme sürerken de beklemez; gözlemciden gelen
  `Degisim` ile yeniden sorgula (`tumu`: hepsini; `kayitlar`: o kayıtlar; `retListesi`; `baglanti`;
  `eslesme`; `gecmis`). Bir çağrı en çok bir `Degisim` doğurur. `ekle`/`duzenle` gövdeyi yeniden hazırlar,
  form hatası `GecersizGirdi{alan, neden}`; olmayan kayıt `KayitYok`; mezar taşına `geriYukle`/`sil` dışı
  işlem `GecersizDurum`; serinin örneği olmayan `ornekTarihi` `GecersizGirdi{alan:"ornek_tarihi"}`.
  `KayitGorunumu.bekleyen`: sonucu gelmemiş işlemi var. Ret listesi: `govde` doluysa "düzelt" formu onunla
  açılır, kullanıcı `ekle` ile yeniden ekler (yeni kimlik) ve `retAt(islemId)`. `gecmisIste` yalnız canlıyken.
  Düzenleme formu `duzenle(kayitId, DuzenlemeTemeli(açıldığı revizyon, açıldığı gövde), yeniGövde)` der.

### K1 — Kotlin kimlik ve eşleştirme
- Dosyalar: `kimlik/KeystoreKimlik.kt`, `kimlik/EslestirmeEkrani.kt`, `src/test/.../kimlik/*`.
- Uygular: `KimlikKabugu` (`acikAnahtar` SPKI DER; `imzala` SHA256withECDSA DER; `dogrula`; `rastgele` SecureRandom;
  `anahtariSil`). Keystore takma adı sabit, uygulamaya özgü. Ekran: metin yapıştırma (QR tarama ileride; kamera
  bağımlılığı gerekirse rapora), `eslestirmeQrCoz`, `eslestirmeBaslat`, `eslesmeDurumu`, kaldırma.
- Test: `ajanda-kurallar.json` `imza` vektörü (java.security ile `dogru_metin` doğrulanır, `yanlis_metin` reddedilir;
  JVM testinde Keystore yok: doğrulamayı Keystore'dan ayrı bir işlevde tut). Bağımlılık: R4 (uçtan uca).
- **Durum: yazıldı, birleşti (kapandı).** Mantık saf `EslestirmeMakinesi`'nde (birim testli); ekran yalnız
  çizer. Çekirdek çağrıları ekranın tek arka iş parçacığında; gözlemci yalnız okuma işini oraya atar.
  `eslestirmeBaslat` bitmeden okunan durum yok sayılır, sonra `eslesmeDurumu` + `baglantiDurumu` okunur (R4
  sırası). Eşleştirme başlarken `BaglantiYoneticisi.simdiDene()` der; bağlantının açık/kapalı olması
  ekranın görünürlüğüne bağlıdır (`ag/GorunurlukSayaci.kt`), ekran `basla/birak` demez. Açmak: `EslestirmeEkrani.ac(context)` (yeni tamamlanınca `RESULT_OK`). Pencere `FLAG_SECURE`,
  `adjustResize` + kenardan kenara pay (manifest ve ekran).

### K2 — Kotlin ağ taşıması ve arka plan eşitlemesi
- Dosyalar (yalnız bunlara yazar): `ag/` paketinin tamamı (`AjandaSoketi.kt`, `BaglantiYoneticisi.kt`,
  `EsitlemeIsi.kt`, gerekirse yeni `ag/*.kt`), `src/test/kotlin/dev/eren/ajanda/ag/*`.
- Uygular: `Tasima` (`gonder` -> `webSocket.send`, `false` = yollanamadı; `kapat` -> `close`); OkHttp dinleyicisi ->
  `baglantiAcildi`/`cerceveGeldi`/`baglantiKapandi` (nesil; R4 notundaki K2 kuralları); tek soket; yeniden bağlanma
  (artan bekleme), ağ geri gelince deneme; ping aralığı; `EsitlemeIsi` (JobScheduler, ağ koşullu, periyodik;
  zamanlamayı K2 kurar; tamam ölçütü `asama == CANLI && kuyrukta == 0`; işin içinde ayrıca
  `alarm.AlarmYenidenKurma.simdi(context, YenidenKurmaNedeni.PERIYODIK)`).
- Arayüz: `object BaglantiYoneticisi { fun izle(uygulama: Application); fun simdiDene() }` (ilk dalganın
  `basla/birak`'ı kaldırıldı: son çağrıyı tutan yüz, bırakılmayan eşleştirme ekranında bağlantıyı arka planda
  süresiz tutuyor, ayrı etkinlik olan kayıt ekranında 3 s'de kapatıyordu). `izle` `AjandaUygulamasi`'ndan
  bir kez; görünürlük kuralı `GorunurlukSayaci`'ndadır (Kotlin bölümü). İkisi de her iş parçacığından
  çağrılabilir, hemen döner, tekrarlı çağrı zararsızdır; eşleşme yokken hiçbir şey açılmaz.
- Geri çağrılar (`gonder`, `kapat`) çekirdeğin etki kilidi altında gelir: bloklama, çekirdeğe yeniden girme.
  Çekirdek çağrıları OkHttp iş parçacığında (ana iş parçacığı değil).
- Hazır olan: OkHttp 4.12 Gradle'da; manifestte INTERNET, ACCESS_NETWORK_STATE, cleartext, `ag.EsitlemeIsi`
  (`BIND_JOB_SERVICE`), RECEIVE_BOOT_COMPLETED (kalıcı iş için).
- Bağımlılık: R4 (uçtan uca), K1 (eşleşme). Doğrulama: aşağıdaki iki komut ve `KopruTest` yeşil kalır.

### K3 — Kotlin alarm, bildirim, alıcılar
- Dosyalar: `alarm/AlarmPlanlayici.kt`, `alarm/AlarmAlici.kt`, `alarm/AcilisAlici.kt` (+ `alarm/Bildirimler.kt`),
  `src/test/.../alarm/*`.
- Uygular: `AlarmKabugu` (strateji TEK yerde: varsayılan `setAlarmClock` ya da `setExactAndAllowWhileIdle`,
  izin yoksa `setAndAllowWhileIdle`; ölçüm sonucu yalnız bu sınıfı değiştirir), bildirim kanalı, hatırlatma ve
  kaçırılan özet bildirimi (dokununca `AnaEkran`), alıcılar `goAsync` + arka plan iş parçacığı.
- Bağımlılık: R3.
- **Durum: yazıldı, birleşti (kapandı).** Kurulamayan alarm ve gösterilemeyen kaçırılan özeti
  `KabukHatasi.Basarisiz` fırlatır (çekirdek satırı siler / teslim işaretini kaldırır) ve `SorunKaydi`'ne yazılır.
  Açılış alıcısı `SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED`'i de dinler (`PERIYODIK` nedeniyle).
  Başkalarının kullanacağı yüz: `AlarmYenidenKurma.arkaPlanda(context, neden)` (ana iş parçacığından, sıraya
  koyar) ve `simdi(context, neden)` (zaten arka plandaysan); `HatirlatmaDurumu.oku(context)` (ekranda
  gösterilecek sorunlar, ana iş parçacığında okunabilir), `goruldu`, `bildirimIzniIstenmeli`, `cozumNiyeti`;
  bildirime dokununca başlatıcı etkinlik `Bildirimler.KAYIT_ID` ekstrasıyla (varsa) açılır.

### K4 — Kotlin ekranlar
- Dosyalar (yalnız bunlara yazar): `ekran/` paketinin tamamı (`AnaEkran.kt`, `KayitEkrani.kt`, eklenecekler),
  `src/test/kotlin/dev/eren/ajanda/ekran/*`.
- Kullanır: `liste(ListeSorgusu(Sekme.TARIHLI|TARIHSIZ|TASLAKLAR|SILINENLER, kapalilarDahil))`, `kayit`,
  `ekle`, `duzenle`, `durumDegistir`, `onayla`, `sil`, `geriYukle`, `retListesi`, `retAt`, `gecmisIste`/`gecmis`,
  `baglantiDurumu`, `eslesmeDurumu`, `gozlemciEkle/Cikar`, `varsayilanHatirlatmalar`, `metniTemizle`,
  `govdeyiHazirla`. İki ana sekme; taslak işareti ve onay; tamamla/geri al; ret listesi (düzelt -> form, at);
  metin düz gösterilir. Eşleşme yoksa `kimlik.EslestirmeEkrani.ac(context)`; açılışta
  `alarm.AlarmYenidenKurma.arkaPlanda(context, UYGULAMA_ACILDI)`. Bağlantıyı ekranlar açıp kapatmaz
  (`ag/GorunurlukSayaci.kt`). Kayıt formu kaydedilmemiş içeriği (bütün alanlar + düzenleme temeli)
  `onSaveInstanceState`'te saklar (`FormKaydi`): döndürme, tema değişimi ve süreç ölümünden sonra geri gelir.
- Bildirim izni (13+) ve hatırlatma sorunları: `HatirlatmaDurumu` (K3 bölümü). Bildirimden gelen niyette
  `Bildirimler.KAYIT_ID` varsa o kaydı aç. Android 15+ kenardan kenara: `WindowInsets` payını uygula.
- `AnaEkran` bugün `KopruKaniti`'ni gösteriyor; K4 onu kendi ekranıyla değiştirir (`KopruKaniti` debug alıcısı
  ve `KopruTest` için kalır, K4 ona dokunmaz). Yeni Activity yerine aynı Activity içinde görünüm/diyalog
  kullanırsa manifeste gerek kalmaz; gerekirse rapora.
- Bağımlılık: R4 (veri), K1 (eşleştirme ekranı), K2 (yalnız `BaglantiYoneticisi` imzası).

## Ortak dosyalar ve dokunma sırası

Dondurulmuş (üçüncü dalgada — K2 ve K4 paralel — yalnız şef, iki parça birleştikten sonra, sırayla
değiştirir): `Cargo.toml` (çalışma alanı ve `cekirdek/`), `Cargo.lock`, `cekirdek/` (bütün Rust: köprü yüzeyi
dahil), `android/build.gradle.kts`, `android/app/build.gradle.kts`, `gradle.properties`, `settings.gradle.kts`,
`AndroidManifest.xml` (main ve debug), `CekirdekErisimi.kt`, `KopruKaniti.kt`, `kabuk/JavaZaman.kt`,
`src/debug/**`, `KopruTest.kt`, `README.md`, bu belge. Kapanmış paketler de dondurulmuştur: `kimlik/` (K1),
`alarm/` (K3) ve testleri; K2 ile K4 bunları yalnız çağırır.

- K2 ile K4 birbirinin paketine yazmaz; aralarındaki tek sözleşme `BaglantiYoneticisi.izle/simdiDene` imzasıdır.
- Yeni crate, Gradle bağımlılığı, izin, bileşen, köprü yöntemi, `CekirdekHatasi` değişkeni, model düzeltmesi
  ya da kapanmış pakette değişiklik gereken parça bunu raporunda (gerekçe + tam değişiklik) yazar, dosyaya
  dokunmaz; şef dalga sonunda tek tek uygular, her birinden sonra iki komut yeşil.
- Doğrulama (her parça, bitirmeden önce): `apps/ajanda` içinden `cargo test -p ajanda-cekirdek` ve
  `apps/ajanda/android` içinden `gradlew.bat --no-daemon --offline assembleDebug testDebugUnitTest`
  (`ANDROID_HOME` verilerek; aynı anda tek Gradle). İkinci dalga sonunda ikisi de tamamen yeşil.
- Manifestte hazır: INTERNET, ACCESS_NETWORK_STATE, SCHEDULE_EXACT_ALARM (≤32), USE_EXACT_ALARM,
  RECEIVE_BOOT_COMPLETED, POST_NOTIFICATIONS, cleartext; bileşenler `ekran.AnaEkran` (başlatıcı),
  `ekran.KayitEkrani`, `kimlik.EslestirmeEkrani` (`adjustResize`), `alarm.AlarmAlici`, `alarm.AcilisAlici`
  (açılış, paket, saat, dilim, kesin alarm izni), `ag.EsitlemeIsi`.
- `depo/sema.rs` R4'ündür; `kurulu_alarmlar` değişikliği R3 raporuyla. Yayımdan önce göç 2 yerinde
  düzeltilebilir; yayımdan sonra yalnız yeni göç.
- Birleştirme sırası: R1, R2 -> R3 -> R4 -> K1, K3 (ikinci dalga, birleşti) -> K2, K4 (üçüncü dalga, paralel;
  birleştirmede önce K2).

## Bilinen ayrışmalar ve açık noktalar

- `serde_json` JSON'daki eşsiz vekil kaçışını (`"\ud800"`) ve taşan sayıyı (`1e400`) ayrıştırmaz; JS ayrıştırır.
  Sonuç farkı yalnız kuralsız alanlarda (`error.detail`, `pair_request.etiket`, zarfın `islem` gövdesi) ve
  `v:1e400`'de; ikisi de reddeder ya da kapatır. Vektörlerde yok (`model/cerceve.rs` başı).
- `ZoneId.systemDefault().id` bazı cihazlarda IANA biçiminde olmayabilir (`GMT+03:00`): elle eklemede
  `SaatDilimi` şemasından geçmezse K4 kullanıcıya dilim seçtirir.
- `alarm_no` SQLite AUTOINCREMENT'tir; Kotlin `toInt()` ile istek kodu yapar (2^31'e erişilmez).
- (R4) Geçici ret (`ic_hata`) beklemesiz yeniden denenir: servis kalıcı olarak `ic_hata` veriyorsa işlem
  birkaç milisaniyede `ISLEM_DENEME`'ye ulaşıp ret listesine düşer (kaybolmaz). Gecikmeli deneme köprüye bir
  zamanlayıcı ya da "şimdi dene" yöntemi ister (yüzey değişikliği).
- (R4) Çevrimdışı reddedilen `ekle`'nin arkasından aynı kayda kuyruklanmış işlemler servise gidip
  `kayit_bulunamadi` alır: kullanıcı ret listesinde birden çok satır görür (hiçbiri kaybolmaz).
- (K3) Kesin alarm izni değişimi (`SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED`) köprüde ayrı neden
  olmadığından `YenidenKurmaNedeni.PERIYODIK` ile gelir (çekirdek nedeni davranışta kullanmaz). Ayrı değer
  köprü yüzeyi değişikliğidir; yapılmadı.
- (K3) Kaçırılan özeti kalıcı olarak gösterilemiyorsa (bildirimler kapalı) her senkronda yeniden denenir ve
  her deneme `SorunKaydi.gosterilemedi`'ye yazılır: sayaç büyür, kimlik listesinde aynı kayıt yinelenebilir
  (en çok 20). Çalan TEK hatırlatma gösterilemezse çekirdek onu teslim edilmiş sayar (yalnız `SorunKaydi`'de
  izi kalır); geri alma yolu köprüde yok.
- (K1) Eski eşleşme dururken yeni QR reddedilirse `eslesmeDurumu` `Reddedildi` döner (öncelik); eşleştirme
  ekranı açılışta (`Yukleniyor`) bunu başarısızlık olarak gösterip girişe döner, "eşleşmiş" görünmez.
  Bağlantı eskisiyle sürer; ana ekran (K4) eşleşmeyi `baglantiAdresi() != null` ile de anlayabilir.
- (Ekranlar) `targetSdk 36`: Android 15+ cihazda pencere kenardan kenaradır; `adjustResize` tek başına
  pencereyi küçültmez. `kimlik.EslestirmeEkrani` sistem çubuğu ve klavye payını kendisi uygular; K4'ün
  ekranları da `WindowInsets` (systemBars + ime) payını uygulamalıdır.
