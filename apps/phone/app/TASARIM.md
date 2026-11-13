# Telefon uygulaması modülleri

`app/` tek Android sürecidir; modüller birbirini görmeden, bu belgeye ve donmuş sözleşmeye karşı
yazılır — tıpkı `server/MODULLER.md` + `server/src/sozlesme.ts` deseni gibi. Bir modülü yazmak için
şunlar yeter: bu belge, ilgili sözleşme dosyası (`modules/eren-device/cekirdek/.../Sozlesme.kt` ya da
`app/src/cekirdek/sozlesme.ts`) ve `@eren/protocol`. Davranışın kaynağı `runtime/uygulama-kararlar.md`;
her kuralı aşağıda bir dosyanın değişmezine dönüşür. Çelişkide öncelik: `protocol/` kablo için,
`docs/GUVENLIK.md` güvenlik için, bu belge davranış için, sözleşme dosyaları imza için.

Etiketler değişmezin kaynağıdır: `[karar]` = `uygulama-kararlar.md`; `[protocol]` = `@eren/protocol`,
`CIHAZ.md`; `[guvenlik]` = `docs/GUVENLIK.md`; `[bu-belge]` = burada alınan karar.

Görünen asistan adı derleme anında `EREN_KIT_ASSISTANT_NAME`'den gelir (varsayılan "Claude"; Expo config `extra.asistanAdi`). Bu belgede ekran metinlerindeki `{ad}` o adın yerine geçer.

## Üç katman

1. **Saf Kotlin çekirdek** — `modules/eren-device/cekirdek/`, ayrı JVM Gradle projesi. `android.jar`
   yok, `org.json` yok, kendi katı JSON ayrıştırıcısı. Bütün kapı mantığı, el sıkışma, izin ve kablo
   üretimi burada; dış dünya altı porttan gelir. `[karar]`
2. **Android adaptörü** — `android/src/main/java/dev/eren/cihaz/`. Portları gerçekler, ön plan servisi,
   Keystore, erişilebilirlik, Expo modülü. Çekirdeği içe aktarır; çekirdek onu içe aktarmaz. `[karar]`
3. **JS** — `app/src/`, yalnız `/sohbet`. `cekirdek/` saf TS'tir ve React Native'i içe aktarmaz. `[karar]`

Tek Android süreci; ön plan servisi Expo ve React bağlamından bağımsız düz `Service`, `BOOT_COMPLETED`
ile RN olmadan kalkar; Expo modülü yalnız istemcidir. Telefonda yalnız release APK, wake lock varsayılan
kapalı, minSdk 30. `[karar]`

## Genel kurallar

1. **Dosya sahipliği.** Yalnız sana verilen dosyalara yazarsın; "ufak düzeltme" dahil başka dosyaya
   dokunmazsın. Donmuş sözleşme dosyaları (aşağıdaki "Sahiplik") hiç kimse tarafından değiştirilmez;
   gerekiyorsa yazma, raporla. Sözleşme değişikliği paralel yazımı durdurur: tek sahibi vardır, herkes
   yeniden okur.
2. **Çekirdekte Android yok.** `cekirdek/` kaynaklarında `android.`, `androidx.`, `expo.`, `org.json`,
   `java.awt`, `kotlinx.coroutines` içe aktarması olmaz; yalnız Kotlin stdlib ve portlar. Tek bağımlılık
   testlerde JUnit'tir. `[karar; guvenlik]`
3. **JS'te `cekirdek/` RN içe aktarmaz.** `app/src/cekirdek/**` dosyaları `react`, `react-native`,
   `expo-*` ya da yerel modülü içe aktarmaz; `node --test` ile koşar. Platforma bağlı her şey porttan
   gelir. Yerel modülü içe aktaran tek dosya `app/src/cihaz/erenDevice.ts`'tir. `[karar]`
4. **Kablo.** Tip kopyalanmaz. Kotlin tarafı `protocol`'u kullanmaz, JSON'u kendi işler ama kapalı
   listeleri (`DeniedNeden`, `CmdAdi`, `Sinirlar` ...) `protocol/src/*.ts` ile birebir tutar; `SozlesmeTest`
   bunu sınar. JS tarafı tipleri `@eren/protocol`'den `import type` ile alır, çözmeyi `sohbetAsagiCoz`
   ile yapar. `[karar; protocol]`
5. **Fabrika biçimi.** JS modülleri `export const <ad>Kur: <Ad>Fabrikasi` verir, bağımlılıklarını
   (portlar) parametre alır; modül düzeyinde durum, yan etki, tekil nesne yoktur. Kotlin çekirdeğinde
   sınıflar portları kurucuda alır, modül düzeyinde durum tutmaz.
6. **Güvenilmez metin.** Telefon metni, ekran metni (`ad`/`deger`/başlık), yazılan metin, rapor, plan,
   model çıktısı, uygulama adı; jeton ve nonce günlüğe/denetime **yazılmaz**. Denetime yalnız kimlik,
   kapalı liste değeri ve paket adı girer. `[karar; guvenlik]`
7. **Kişisel veri yok.** Kaynakta ve testte gerçek ad, kullanıcı yolu, IP, cihaz adı olmaz; örnekler
   `com.ornek.*`, `100.64.0.1` gibi uydurma ve geneldir. `[karar; guvenlik]`
8. **Test komutları.**
   - Çekirdek + JVM testleri: `cd app/modules/eren-device/cekirdek; .\gradlew.bat test`. Tek birim:
     `.\gradlew.bat test -Pbirim=Kapi` (yalnız `Portlar.kt`, `Sozlesme.kt`, `Kapi*.kt`, `Sahte*.kt` derlenir;
     paralel yazımda başka birimin yarım dosyası testi kırmaz). Bitince `.\gradlew.bat --stop`.
   - JS çekirdeği: `node --test` ile `app/src/cekirdek/**`.
   - Tip: `app` içinde `npx tsc --noEmit`. Paralel agent'ların yarım dosyaları başka dosyada hata
     gösterebilir; yalnız kendi dosyaların temiz olmalı.
   - Üretim ve test ayrı agent'larda yazılır; üretim agent'ı test dosyasına, test agent'ı üretim
     dosyasına yazmaz. JVM negatif testleri önceliklidir (aşağıda).

## Sahiplik haritası

**Donmuş sözleşme (bu iş; yeniden dondurulmadan değiştirilmez):**

| Dosya | İçerik |
|---|---|
| `modules/eren-device/cekirdek/src/main/kotlin/.../Portlar.kt` | Altı port: `EkranPortu`, `EylemPortu`, `SaatPortu`, `RastgelePortu`, `DenetimPortu`, `AnahtarPortu` ve veri tipleri (`AnlikDurum`, `Pencere`, `Dugum`, `GoruntuSonucu`, `DenetimSatiri`...). |
| `modules/eren-device/cekirdek/src/main/kotlin/.../Sozlesme.kt` | Kapalı listeler (`CmdAdi`, `Tus`, `KaydirmaYonu`, `IzinModu`, `UygulamaDurumu`, `DeniedNeden`, `CihazHatasi`, `GrantNedeni`), `Cmd`+`CmdArg`, `Karar`, `IzinKaydi`, `OnPlan`, `Element`, `CmdPayload`, `CmdSonucu`, `KomutIsleyici` arayüzü. Hepsi gövdesiz. |
| `modules/eren-device/cekirdek/src/main/kotlin/.../Sinirlar.kt` | `PROTOKOL_SURUMU`, `Sinirlar`, `AzamiCerceve`: `protocol/src/sinirlar.ts` birebir kopyası. |
| `modules/eren-device/cekirdek/src/main/kotlin/.../IcSozlesme.kt` | Çekirdek birimlerinin iç yüzeyi, gövdesiz: `Sozlesme.kt`'de olmayan kapalı listeler (`HataKodu`, `BildirimTuru`, `IsTuru`, `McpProfili`, `ImzaRolu`, `Kanal`), `CekirdekSinirlari` (kararlardaki süre/bütçe/aralık sayıları), her birimin arayüzü, veri ve sonuç tipleri, fabrika tipleri. Giriş adları aşağıdaki tablonun son sütunundadır ve birimin kendi dosyasında tanımlanır. `-Pbirim` süzgeci yalnız `Portlar`/`Sozlesme`'yi eklediği için her birim `IcSozlesme`'yi, `Sinirlar` kullanan `Sinirlar`'ı da yazar: `-Pbirim=Sema,Json,Sinirlar,IcSozlesme`. |
| `modules/eren-device/cekirdek/src/test/kotlin/.../SozlesmeTest.kt` | Duman testi: tipler derlenir; kapalı listeler ve `Sinirlar` protocol ile aynı. |
| `modules/eren-device/cekirdek/{settings,build}.gradle.kts`, `gradle.properties`, `gradle/wrapper/*`, `gradlew*` | Saf Kotlin JVM projesi (Gradle 8.14, Kotlin 2.2.20, JUnit Jupiter 6.1.3, Java 17). |
| `modules/eren-device/src/ErenDevice.types.ts` | Köprü API'sinin TS tipleri. |
| `app/src/cekirdek/sozlesme.ts` | JS çekirdeği portları (`WsPortu`, `KimlikPortu`, `DepoPortu`, `SaatPortu`) ve dışa açık tipler. Dilim 2'den beri modüller arası değişen yüzeyler de burada: `Outbox`, `SohbetDefteri`, `SecimDeposu`, ekran yüzeyi `Cekirdek`/`Sohbet` (aşağıda "Dilim 2"). |
| `app/TASARIM.md` | Bu belge. |

`Sozlesme.kt` `Cmd`/`Karar`/`IzinKaydi` ve bütün kapalı listeleri **tanımlar**; hiçbir davranış dosyası
bunları yeniden tanımlamaz. `Sinirlar.kt` donmuş sayısal sözleşmedir; `uygulama-kararlar.md`'de ayrı bir
dosya olarak anılır ama saf sabit olduğu için burada dondurulmuştur ve eşitliği `SozlesmeTest` sınar
(ayrı bir Node testi gerekmez). `[bu-belge]`

**Çekirdek davranış dosyaları (paralel agent'lar; bir dosya = bir sorumluluk):**

| Dosya | Sorumluluk | Bağımlılık | Dışa açtığı (`IcSozlesme.kt`) |
|---|---|---|---|
| `Json.kt` | Katı JSON ayrıştırıcı: yinelenen anahtar, 32'den derin yapı, güvenli olmayan sayı (`1e400`, `12.5`, `-0`) reddi. `org.json` yok. `[karar]` | yok | `object Json : JsonIslemi`: `coz(metin): JsonSonucu`, `yaz(JsonDeger): String`. `12.5` tam sayı alanında reddedilir, `wait.seconds` için `Ondalik` olarak geçer |
| `Kanonik.kt`, `PlanHash.kt` | `protocol/src/kanonik.ts` portu: kanonik JSON + SHA-256; `plan-hash.json` vektörleri geçer. `[protocol]` | `Json` | `object Kanonik : KanonikIslemi` (`kanonik`, `sha256Hex`), `object PlanHash : PlanHashIslemi` (`planHash(JsonDeger): String?`) |
| `Sema.kt` | Ham JSON → `Cmd`/`Plan`/`TelefonIzinIstegi` çözümü ve giden çerçeve kurucuları. `Sozlesme.kt`'nin tiplerini **yeniden tanımlamaz**; yalnız üretir. `[karar]` | `Json`, `Sinirlar`, `Sozlesme` | `object Sema : SemaIslemi`: `gelen(ham): GelenCerceve`, `planCoz(ham): Plan?`, giden kurucular |
| `Izinler.kt` | Bellekteki izin kümesi (`IzinKaydi`), jeton sabit zamanlı karşılaştırma, bütçe ve monotonik süre düşümü. Jeton diske/günlüğe girmez. `ekle`'nin tek çağıranı onay akışıdır. `[karar; guvenlik]` | `Portlar`(Saat, Denetim), `Sozlesme` | `val izinlerKur: IzinlerFabrikasi` → `Izinler` (`ekle`, `bul`, `harca`, `geriCek`, `suresiGecenler`, `aktifler`, `eskiSurectenKalanlar`) |
| `Listeler.kt` | Uygulama durum listeleri: `degismez` ret listesi (bu uygulamanın kendisi, Ayarlar, kurucu, Play, izin denetleyicisi, üretici güvenlik uygulaması, Tailscale, kilit ekranı, systemui, HOME çözen tüm paketler ve varsayılan klavye — sabit adlar + intent çözümü), `hassas`, `yeni` (0.4.3: kurulu değil ya da imzası okunamayan paket; sıradan kurulu uygulama varsayılan açık, banka/para/kimlik uygulaması ve sistem bileşeni (başlatıcı simgesi olmayan sistem paketi) otomatik hassas). `[karar]` | `Sozlesme` | `val listelerKur: ListelerFabrikasi` → `Listeler` (`durum`, `uygulamalar`, `guncelle`) |
| `Etiket.kt` | Gönder/sil/öde sözlüğü; Türkçe İ/ı katlama; görünmez karakter atma. `[karar]` | yok | `object Etiket : EtiketIslemi` (`katla`, `eslesir`, `etiketli`, `parolaAlani`) |
| `Kapi.kt` | Saf karar: aşağıdaki "Kapı kural sırası". Port çağırmaz, `Karar` döner. `[karar]` | `Portlar`, `Izinler`, `Listeler`, `Etiket`, `Sozlesme` | `object Kapi : KapiIslemi`: `izinDenetimi` (1-5), `durumDenetimi` (6-7), `ekranDenetimi` (8-10, 11), `goruntuDenetimi` (12) |
| `KomutIsleyici.kt` | `isle(ham): List<String>`: çöz → kapı → port → giden çerçeve. `KomutIsleyici` arayüzünü gerçekler. `[karar]` | hepsi + `Sema` | `val komutIsleyiciKur: KomutIsleyiciFabrikasi` → `KomutIsleyici`; yalnız `cmd` çerçevesi alır |
| `CihazOturumu.kt` | El sıkışma durum makinesi (`hello`→`auth_challenge`→`auth_response`→`welcome`→`device_state`/`app_list`/`grant_issued`). Sıra dışı mesaj `yetkisiz`+kapat. `[protocol]` | `KimlikMetni`, `Portlar`(Anahtar), `Sema` | `val cihazOturumuKur: CihazOturumuFabrikasi` → `CihazOturumu : OturumBilgisi`; `gelen(ham): OturumCiktisi` (giden, olaylar, `komut`, `kapat`) |
| `KimlikMetni.kt` | `kimlikImzaMetni` portu: rol+kanal+device_id+nonce'lar, `\n` ile, sonda satır sonu yok. `[protocol]` | yok | `object KimlikMetni : KimlikMetniIslemi`: `metin(rol, kanal, deviceId, clientNonce, serverNonce): String?` |
| `DenetimKaydi.kt` | `DenetimSatiri` üretimi/biçimi; güvenilmez metin girmez. `[karar; guvenlik]` | `Portlar`(Denetim) | `val denetimKaydiKur: DenetimKaydiFabrikasi` → `DenetimKaydi`; `object DenetimBicimi : DenetimBicimIslemi` (`yaz`, `coz`) |

**Çekirdek testleri (test agent'ları; JVM negatif testleri öncelik 1):** `src/test/.../Sahte*.kt`
(ortak sahteler: `SahtePc` yazılım P-256 anahtarıyla gerçek kablo yollar; `SahteEkran` senaryolu —
ikinci okumada paket değişir; `SahteEylem` her eylemi kaydeder; ilerletilebilir `SahteSaat`), ve birim
başına `<Birim>Test.kt`. Ana iddialar: her ret dalında `SahteEylem` boş; giden çerçevede jeton, parola,
izin dışı başlık yok; 10.000 rastgele mutasyonlu dizide "eylem gönderildiyse geçerli izin + izinli ön
plan + sıfırdan büyük bütçe vardı" değişmezi. Giden çerçeveler `build/cikti.jsonl`'e yazılır (build
dosyası `eren.cikti` sistem özelliği verir), bir Node testi `cihazYukariCoz` ile doğrular; gelen
sınıflandırma `protocol/vektorler/cihaz-mesaj.json`, hash `plan-hash.json`. Saldırı listesinin tamamı
(el sıkışma, kablo, izin/bütçe, ön plan, okuma modu, yazma modu, kapanma/kopma) bu testlerde geçer.
`[karar]`

**Android adaptörü (`android/src/main/java/dev/eren/cihaz/`):** `CihazServisi` (specialUse ön plan,
kalıcı bildirim + Durdur, izin aktifken sayaç), `Baglanti` (OkHttp WS, `pingInterval` OkHttp düzeyinde,
protokolde ping mesajı yok; servis her bağlantıya 30 sn'de bir WebSocket ping atar, bu çerçeve düzeyindedir:
uygulama mesajı değildir ve JS tarafında görünmez), `ErisimServisi`+`EkranOkuyucu`+`Eylemci` (`EkranPortu`/`EylemPortu`
gerçeklemesi), `PaketBilgisi` (imza özeti, `PACKAGE_ADDED`), `AnahtarDeposu` (Keystore P-256,
`AnahtarPortu`), `DenetimDosyasi` (`DenetimPortu`), `AcilisAlici`, `DurdurAlici`, aktiviteler
`OnayActivity`/`EslestirmeActivity`/`UygulamaListesiActivity`/`DenetimActivity`/`TanilamaActivity`,
Expo modülü `ErenDeviceModule.kt` (`ErenDevice.types.ts` yüzeyini gerçekler). `[karar]`

**JS modülleri (`app/src/`):** `cekirdek/baglanti.ts` (hello/auth/welcome, geri çekilme 1→30 sn),
`cekirdek/telafi.ts` (önce olay günlüğe, `last_seq` olay başına yazılmaz: bkz. "Telafi"; `seq <= last_seq` atılır), `cekirdek/outbox.ts`
(`client_msg_id` kalıcı sayaçtan; kimlikten sonra sırayla; `ack` siler; `ok:false` yeniden yollanmaz),
`cekirdek/akis.ts` (snapshot + offset'li delta), `cekirdek/olaylar.ts` (olaydan görünüm modeli;
`planHash` tutmazsa kart gizlenir), `depo/dosyaDepo.ts` (`DepoPortu`, expo-file-system, geçici dosya +
taşıma), `cihaz/erenDevice.ts` (yerel modülü içe aktaran tek dosya; iPad'de `desteklenmiyor`),
`ekranlar/` (Sohbet, PlanKarti, SoruKarti, RaporKarti düz metin otomatik bağlantısız, Durum, Kurulum).
RaporKarti altında tek satır iş tüketimi gösterir; ayrıntı "Tüketim" bölümünde.
Her JS modülü yalnız `cekirdek/sozlesme.ts`'ten tip, `@eren/protocol`'den değer alır; kendi fabrika
tipini kendi dosyasında bildirir. `[karar]`

## Kapı kural sırası (`Kapi.kt` değişmezi — ilk takılan döner) `[karar; protocol; guvenlik]`

0. **Çerçeve (hiçbir port çağrılmaz):** >10 MiB, bozuk JSON, yinelenen anahtar → `error`+kapat;
   `v` farklı → `protokol_uyumsuz`; bilinmeyen `name` → `desteklenmeyen_komut`; `args` uymuyor →
   `gecersiz_arg`; `open_app` hedefi paket biçimi değilse `url_intent_yasak`.
1. `mesgul` (çalışan komut varken ikinci). 2. `deadline_gecti` (yalnız tazelik, PC saati). 3. `izin_yok`/
   `izin_geri_cekildi` (mezar taşı listesi). 4. `jeton_yanlis` (sabit zamanlı). 5. `izin_suresi_bitti`
   (telefonun monotonik saati; PC saati uzatamaz). 6. `erisilebilirlik_kapali`. 7. `kilit_ekrani`.
8. **Ön plan (taze anlık):** aktif kök, son olay, odak paketi uyuşmazsa `on_plan_izin_disi`; istisna (0.5.0): aktif kök ve odak aynı izinli paketteyse SystemUI'den (`com.android.systemui`) gelen son olay ön plan değişimi sayılmaz (HyperOS'ta bildirim balonu kapanırken gelen olay her okumayı reddettiriyordu; ölçüm 2026-11-09, YouTube ve Instagram işleri); gerçekten SystemUI öne gelirse aktif kök ve odak da SystemUI olur, zincir `degismez_ret` verir. Görüntü sırasında son olay değişirse resmin atılması kuralı katı kalır. Ön plan retlerinde logcat'e `ErenKapi` etiketiyle yalnız paket adları ve pencere türleri yazılır;
   `degismez_ret` → `hassas_uygulama` → `yeni_uygulama` (paket kurulu değil ya da imzası okunamıyor) → izin dışı paket
   `on_plan_izin_disi`. `open_app` aynı zinciri hedefe uygular. `screenshot`/`zoom`: durum ve gezinti
   çubuğu dışında görünen her pencere izinli pakette olmalı; perde, heads-up, klavye, balon, PiP görünürse
   `izin_disi_pencere`. `x,y` tıklamada noktadaki en üst pencere, `element` tıklamada tazelenmiş düğüm
   izinli pakette olmalı.
9. **Mod:** `oku`'da `type_text`/`key` → `yalniz_oku_yazma`; `x,y` tıklama/`drag`/uzun basma/çift dokunma/
   yatay ya da `x,y`'li kaydırma → `yalniz_oku_ham_dokunma`; düğüm, tıklanabilir atası ya da üç kat çocuğu
   sözlükle eşleşirse → `yalniz_oku_etiket`. `yaz`'da parola alanı ya da şifre/PIN/OTP ipucu →
   `parola_alani`; metin `izinli_metin`'de birebir (UTF-16, normalizasyon yok) yoksa ya da madde
   kullanıldıysa → `metin_kilidi` (madde tek kullanım; `ACTION_SET_TEXT` baştan yazar). `serbest_metin`
   ayrı, sert uyarılı onay.
10. `butce_doldu` (yalnız eylem komutları; retler bütçe yemez). 11. Eylemden hemen önce 8 yeniden.
   12. Görüntüden sonra 8 yeniden; değiştiyse resim atılır → `on_plan_izin_disi`; `SECURE_WINDOW` ya da
   %99 siyah → `ekran_korumali`.

**Sonuç değişmezleri:** `ok:true` yalnız "gönderildi"; `ok:true` eylemin sonucunu kanıtlamaz. İzin dışı
ön planda `foreground.baslik` boştur. `elements` izin dışı paket düğümlerini ve parola değerlerini düşürür.
Okunan metin yapısal döner (çit PC köprüsünde kurulur, telefonda değil). `[guvenlik]`

**Bütçe/süre:** onayda seçilir — okuma 30 dk / 100 eylem, yazma 10 dk / 30 eylem varsayılan; üst sınır
60 dk / 300. Eylemler arası en az 250 ms, görüntüler arası en az 1 sn. İzinler yalnız bellekte; diskte
jetonsuz izin kimlikleri (`DenetimPortu.izinKimlikleri`), süreç yeniden açılınca bunlar için
`grant_revoked{suresi_bitti}`. Erişilebilirlik koparsa hepsi `erisilebilirlik_kapandi`. İzin yokken
erişilebilirlik olayları işlenmez. Kurulu olmayan ya da imzası okunamayan paket `yeni`; kurulu sıradan uygulama varsayılan `acik`, banka/para/kimlik uygulaması ve sistem bileşeni otomatik `hassas` (0.4.3). `[karar]`

## Köprü API ve yapısal sınırlar

`ErenDevice.types.ts` yüzeyi `uygulama-kararlar.md` "Köprü API'si" ile birebirdir (Dilim 3 ekleri "Dilim 3"
bölümünde) ve `ErenDeviceModule.kt` onu gerçekler. **Yapısal sınır:** köprü yüzeyinde `cmd`, `cmd_result`,
`payload`, `token` alanı ve genel `imzala(bayt)` yoktur; `/cihaz` kablosu JS'e geçmez; jeton JS'e hiçbir
yoldan dönmez (`otoIzin` yalnız opak `grant_id` döner). **İzin iki yerde doğar** (Dilim 3'ten beri): onay
ekranında (`izinIste` → `OnayActivity`, kullanıcı onaylar) ve tam yetki açıkken Kotlin'deki `OtoIzinKapisi`'nda
(`otoIzin`, onay ekranı yok). `Izinler.ekle`'nin çağıranı yalnız bu ikisidir. Değişmezler ve onları tarayan
dosya (`app/test/yapisal.test.ts`, kaynak metni tarar; yorum ve dizge sayılmaz, her değişmezin "sahte ihlal"
testi vardır):

| # | Değişmez | İzinli dosya |
|---|---|---|
| 1 | `izinler.ekle(` çağrısı | `OnayActivity.kt`, `OtoIzinKapisi.kt` |
| 2 | `Settings.Secure.put*` çağrısı | `ErisimAnahtari.kt` |
| 3 | `Kanal.CIHAZ` (adaptörde) | `Baglanti.kt` |
| 4 | Köprü yüzeyinde `cmd`, `cmd_result`, `token` adı yok; yöntem/olay adları izin listesine karşı taranır, eşleşme 0 ise de başarısız | `ErenDevice.types.ts` (hiç) |
| 5 | `TamYetki.ac(` çağrısı (tanım `fun ac(` çağrı sayılmaz) | `TamYetkiActivity.kt` |
| 6 | `KisayolDeposu.koy(` çağrısı | `KisayolActivity.kt` |

Nonce'lar base64 düzenli ifadesinden geçer. `[karar; guvenlik; bu-belge]`

**Onay ekranı (`OnayActivity`):** FLAG_SECURE, `filterTouchesWhenObscured`, gizlenmiş dokunuş reddi,
API 34+ `setAccessibilityDataSensitive`; başka erişilebilirlik servisi etkinse uyarı; yazma izni ve
`serbest_metin` için `BIOMETRIC_STRONG|DEVICE_CREDENTIAL`; uygulama adları PackageManager'dan; kendi
paketimiz değişmez rette. Plan JS'ten gelir, `plan_hash` burada yeniden hesaplanır. Dilim 3'ten beri onaydan
sonra önce `ErisimAnahtari.ac` çalışır; izin yalnız `ACIK` sonucundan sonra doğar. `[karar; guvenlik]`

## Doğrulama ayrımı

**Cihazsız (bu CI):** çekirdek JVM testleri, kablo uyumu (vektörler, `cihazYukariCoz`), JS çekirdeği
sahte WS ile, köprü taraması, `tsc`, `expo prebuild`, `assembleRelease`, birleşik manifest (`aapt`: izin
listesi, SYSTEM_ALERT_WINDOW yok, `allowBackup=false`, `QUERY_ALL_PACKAGES` var, `exported` bayrakları,
release'te `ws://` için cleartext açık). **Yalnız telefonda:** modülün gerçekten çağrılması, gece
dayanıklılığı, üretici arayüzünün pencere türleri, gerçek tıklama ve `SET_TEXT`, Keystore + biyometri, açılışta
servis + her zaman açık VPN, saldırı listesinin cihazda tekrarı. `[karar]`

## Yazım sırası

Bütün modüller sözleşmeye karşı yazıldığı için çoğu paraleldir. Sıra yalnız test yardımcıları ve gerçek
kullanım içindir.

| Adım | İş | Biçim | Neden |
|---|---|---|---|
| 0 | Donmuş sözleşme (bu iş): `Portlar.kt`, `Sozlesme.kt`, `Sinirlar.kt`, iki `sozlesme.ts`, `ErenDevice.types.ts`, Gradle projesi, `SozlesmeTest`, `TASARIM.md` | Bitti | Herkes buna karşı yazar |
| 1 | Çekirdek + JVM negatif testleri: `Json`, `Kanonik`/`PlanHash`, `Etiket`, `Listeler`, `KimlikMetni`, `Sema`, `Izinler`, `Kapi`, `KomutIsleyici`, `CihazOturumu`, `DenetimKaydi` ve `Sahte*`/`*Test` | Paralel; önce | En sıkı sınır burada; cihazsız kanıtlanır |
| 2 | Android adaptörü (port gerçeklemeleri, servis, aktiviteler, `ErenDeviceModule.kt`) ve `cihaz/erenDevice.ts`, `depo/dosyaDepo.ts` | Paralel | Çekirdek ve `ErenDevice.types.ts` arayüzüne yaslanır |
| 3 | JS `cekirdek/` (`baglanti`, `telafi`, `outbox`, `akis`, `olaylar`) ve `ekranlar/` | Paralel | Portlara ve `@eren/protocol`'e karşı |

Sözleşme değişikliği gerekirse paralel yazım durur: tek sahibi vardır, herkes yeniden okur.

Dilim 2'nin sırası ve dosya başına işleri: aşağıda "Dilim 2 iş listesi".

## Kararlardan ayrılan / kararlarda eksik noktalar

- **JUnit sürümü:** Kararlar "JUnit 5" diyor; çekirdek JUnit **Jupiter 6.1.3** kullanır (API aynı:
  `org.junit.jupiter.api.*`). Neden: yerel Gradle önbelleğinde 5.10.1 motor jar'ı eksik, 6.1.3 tam ve
  çevrimdışı derleniyor. İstenirse 5.x'e sabitlemek tek satırlık BOM değişimi. `[bu-belge]`
- **`Sinirlar.kt` eşitliği:** Kararlar "bir Node testi eşitliği sınar" diyor; burada eşitlik `SozlesmeTest`
  içinde JVM tarafında (TS kaynağını okuyarak) sınanıyor. Ayrı Node testi gerekmiyor. `[bu-belge]`
- **`protocol/vektorler/cihaz-mesaj.json` yok** (yalnız `plan-hash.json` var). Çekirdeğin gelen-mesaj
  sınıflandırma negatif testleri bu vektör dosyasına dayanıyor (kararlar, "JVM negatif testleri"). Protocol
  alanı olduğu için bu işte yazılmadı; protokol agent'ının eklemesi gerekir.
- **`CIHAZ.md` denetim sırası:** `mesgul` ve `gecersiz_arg`'ın yeri `CIHAZ.md`'nin "Denetim sırası"
  satırında açıkça sıralanmıyor (kararların protokol notu da bunu bekliyor). `Kapi.kt` sırası
  `uygulama-kararlar.md` §"Kapı kural sırası"nı izler; `CIHAZ.md` güncellemesi protokol işi, kapıyı
  etkilemez.

## Dilim 2: çoklu sohbet

Kullanıcı isteği: telefon uygulamasında yeni sayfa açıp birden fazla ayrı sohbetle konuşabilmek. Sohbet, aynı asistanın
ayrı bir konuşmasıdır (ayrı bağlam, ayrı süreç zinciri); kişilik farkı yoktur. Etiketler: `[karar2]` =
şefin Dilim 2 kararları (M1-M5), `[protocol]` = `protocol/src/sohbet.ts` (commit `e1653e9`, `SOHBET_SURUMU`
3, değişmez), `[tasarim]` = `docs/TASARIM.md` (görsel dil, 6.1-6.16). İmzalar `app/src/cekirdek/sozlesme.ts`
"Dilim 2" bölümünde donmuştur; burası davranıştır.

### İlkeler

1. **Tek kanal.** Tek WebSocket, tek telafi günlüğü, tek outbox, tek `last_seq`; `seq` bütün sohbetlerde
   küreseldir. Sohbet, olayların ve mesajların `sohbet_id`'siyle ayrılır. `[protocol]`
2. **Sohbet anahtarı** her kayıtta (olay, yukarı mesaj, günlük satırı) `sohbetAnahtari(kayit)` ile okunur:
   alanı olmayan (eski ya da küresel, ör. `system_notice`) kayıt `ana`'nındır. Elle `"ana"` yazılmaz;
   gerekiyorsa `ANA_SOHBET_ID`. `[protocol]`
3. **Kimliği telefon üretir**: `Outbox.sohbetIdUret()` → `s-<donem>-<sayac>`, `client_msg_id` ile aynı
   kalıcı sayaçtan. Böylece `chat_create` çevrimdışıyken kuyrukta bekleyebilir, cihazda bir kimlik iki kez
   verilmez, silinen kimlik geri gelmez (servis silinmiş kimliğe `sohbet_bulunamadi` der). `[karar2 M2]`
4. **Liste olaylardan kurulur.** Ayrı liste isteği yoktur: yaşam döngüsü olayları (`chat_created`,
   `chat_renamed`, `chat_deleted`) + `server_status.sohbetler` (yalnız ana oturum durumu) + telefonun kendi
   kuyruğu. Yaşam döngüsü olayları telefonda da hiç silinmez. `[protocol]`
5. **`ana` silinemez**, yalnız temizlenir ve adlandırılır; ilk adı `ANA_SOHBET_ADI` (nötr varsayılan "Claude"; uygulamada `anaKaydi` derleme anındaki asistan adını kullanır, sunucudan gelen ad her zaman önceliklidir), olayı yoktur.
   Silinmemiş sohbet sayısı en çok `SOHBET_SINIRLARI.SOHBET_ADET` (8, `ana` dahil). `[karar2 M1]`
6. **Sohbet adı kullanıcı metnidir** (Genel kural 6): günlüğe, denetime yazılmaz; ekranda düz metin.

### Modüller (Dilim 2)

| Dosya | Dilim 2'deki rolü | Arayüz (`sozlesme.ts`) |
|---|---|---|
| `cekirdek/outbox.ts` | v3 kuyruk; yeni iş türleri; `chat_delete` geçici; v1/v2 → v3 yükseltme; `sohbetIdUret`; `kaldir` | `Outbox`, `IsMesaji`, `GidenGovde`, `GidenHatasi`, `YuklemeOzeti` ... |
| `cekirdek/baglanti.ts` | İş türü kümesi `IsMesajiTuru`'nun tamamı | değişmez (`Baglanti`) |
| `cekirdek/telafi.ts` | Kırpmada yaşam döngüsü olayları kalır; `chat_deleted` sohbetin geri kalanını kırpar | değişmez (`Telafi`) |
| `cekirdek/sohbetler.ts` (yeni) | Saf: sohbet defteri, liste özeti, ad hazırlama, otomatik ad, ana oturum kaynaklı öğe | `SohbetDefteri`, `OzetleriKur`, `AdHazirla`, `OtomatikAdUret`, `ErenKaynakliMi` |
| `cekirdek/secim.ts` (yeni) | En son açık sohbet ve okunmuş sınırlarının kalıcılığı (`DepoPortu` üstünde) | `SecimDeposu`, `SecimKaydi` |
| `cekirdek/index.ts` | Birleştirme; olay yönlendirme; sohbet başına `olaylar` + `akis` örneği; ekran yüzeyi | `Cekirdek`, `Sohbet`, `CekirdekDurumu`, `SohbetDurumu` ... |
| `cekirdek/akis.ts`, `cekirdek/olaylar.ts` | **Değişmez.** `index` her sohbet için ayrı örnek kurar (`akisKur()`, `olaylarKur()`); bir örnek tek sohbetin olaylarını görür, mezar taşı mantığı örnek içinde doğru kalır | kendi dosyalarında (donmuş) |

Ayrı platform portu eklenmez: seçim kaydı yeni bir `DepoPortu` anahtarıdır (`sohbet_secimi`).
`depo/dosyaDepo.ts`, `platform/*`, `cihaz/erenDevice.ts` ve bütün Kotlin (`modules/eren-device/**`)
değişmez: `/cihaz`, eşleştirme (`pair_*` v1), `HataKoduV1` (32 kod) ve `/sohbet` el sıkışma imzası Dilim 2'de
aynıdır. `[protocol]` Not (`depo/dosyaDepo.ts`, yalnız davranış düzeltmesi): `ekle`, dosya yeni satırla bitmiyorsa
(yarım kalmış kayıt) yeni kaydı satır başından başlatır; süreç başına dosyanın satır sonuyla bitip bitmediği
bellekte tutulur, bilinmiyorsa son bayt bir kez okunur.

### Olay yönlendirme (`index`)

- **Yaşam döngüsü olayı** (`SohbetYasamOlayi`) → `SohbetDefteri.olay`. Görünüme gitmez. `chat_deleted`
  ayrıca "Silinen sohbet" adımlarını tetikler (aşağıda).
- **Görünüm olayı** (`GorunumOlayi`, geri kalan her şey) → `sohbetAnahtari(o)` sohbetinin `olaylar.ekle` ve
  `akis.olay` örneği. Örnek ilk olayda kurulur. Defterde silinmiş sohbetin olayı yok sayılır.
- **`assistant_delta` / `stream_snapshot`** → `c.sohbet_id` sohbetinin `akis.cerceve`'si (silinmişse yok sayılır).
- **`server_status`** → `sunucu` (`v`/`type` atılmış); `sunucu.sohbetler` yalnız ana oturum durumu verir.
- **Kopma** → bütün `akis` örneklerinde `koptu()`; telafi, outbox Dilim 1'deki gibi.
- **Bir yukarı mesajın sohbeti** (`mesajSohbeti`, `index` içinde): `sohbet_id` alanı varsa o;
  `plan_decision`/`question_answer`/`job_cancel` için kartın bulunduğu sohbet (`olaylar.plan`/`soru`/`is`
  hangi örnekte bulunursa); bulunamazsa `ana`. Sohbet başına `bekleyenler`, `hatalar`, mezar taşında hata
  temizliği ve silmede artık temizliği hep bununla yapılır.

### Sohbet listesi (`sohbetler.ts` `ozetleriKur`, `CekirdekDurumu.sohbetler`)

1. **Defter.** Başta yalnız `ana` (`ANA_SOHBET_ADI`, `olusturma_seq` 0). `chat_created` kayıt ekler (varsa ya
   da silinmişse yok sayılır), `chat_renamed` bilinen kaydın adını değiştirir (en yenisi geçerli; bilinmeyen
   ya da silinmiş kimlik yok sayılır; `ana` adlandırılabilir), `chat_deleted` kaydı kaldırır ve kimliği
   silinmişlere koyar (`ana` için yok sayılır). `seq`'i son uygulanandan büyük olmayan olay yok sayılır.
2. **Kimlik kümesi ve kurulum.** Sırayla, ilk tutan kazanır:
   - defterde kaydı var → `kuruldu`;
   - `teslimler`'de (ack ok almış, olayı henüz gelmemiş) `chat_create`'i var → `kuruldu`;
   - kuyrukta `chat_create`'i var → `bekliyor`;
   - `hatalar`'da `chat_create`'i var → `kurulamadi`.
   `server_status.sohbetler`'de olup bu kümede olmayan kimlik listeye girmez (eşitleme sürerken olabilir).
3. **Geçerli ad.** Taban: defterdeki ad, yoksa `chat_create`'in adı. Üstüne sırayla `teslimler`'deki, sonra
   kuyruktaki `chat_rename`'ler uygulanır (son gelen kazanır). Hata almış `chat_rename` yok sayılır (ad geri döner,
   hata sohbetin `hatalar`'ında görünür).
4. **Türetilen alanlar.** `eren`: `sunucu`'da o kimliğin durumu, yoksa `null`. `yaziyor`: `akis !== null` ya da
   `eren === "tur_suruyor"`. `okunmamis`: aşağıda. `calisanIs`: `tur:"is"`, `durum:"suruyor"` öğe sayısı.
   `sonMesaj`: son `kullanici` ya da `asistan` öğesi. `sonEtkinlikMs`: defter kaydı varsa
   `max(olusturma_ms, son öğenin ts_ms'i)`, yoksa `null`.
5. **Sıra.** Önce defterde kaydı olmayanlar (teslim, bekliyor, kurulamadı), en yeni önce (teslim, kuyruk,
   hata sırasının tersi). Sonra kayıtlılar `sonEtkinlikMs` azalan, eşitse `olusturma_seq` azalan. Tarih grubu yok.
6. **Kimlik:** `index`, yeni satır öncekiyle sığ eşitse eski nesneyi korur (başka sohbetteki akış, açık
   sohbetin `SohbetDurumu`'nu yenilemesin).

### Okunmamış

- **Tanım:** bir sohbetin `okunmamis`'i, o sohbetin görünüm öğelerinden `seq > okunduSeq` ve ana oturum kaynaklı
  olanların sayısıdır. `okunduSeq = max(taban_seq, okundu[sohbet_id] ?? 0)` (`SecimKaydi`). Ana oturum kaynaklı
  (`erenKaynakli`): `asistan`, `plan`, `plan_gizlendi`, `soru`, `rapor`, `tur_kesildi`, `devir`, `seviye`'si
  `bilgi` olmayan `sistem` (`docs/TASARIM.md` 6.10 ile aynı küme). Akış sayılmaz (satırda "{ad} yazıyor").
- **Okundu:** `Sohbet.okundu()` → `okundu[id] = telafi.sonSeq()`; değişmediyse yazılmaz. Ekran yalnız şu
  koşulların hepsinde çağırır: sohbet ekranda açık, uygulama ön planda (`AppState` `active`), liste altta
  (`alttaMi()`). Açılışta ilk inişten sonra, altta iken öğe gelince ve kullanıcı alta inince.
- **Taban:** seçim kaydı hiç yoksa (ilk Dilim 2 açılışı) `taban_seq = telafi.sonSeq()` (yüklemeden sonra):
  eski geçmiş okunmamış görünmez. Yerel sıfırlamadan (`welcome` "geride") sonra ilk `welcome.head_seq`
  taban olur ve `okundu` boşalır. Silinen sohbetin `okundu` girdisi kalkar.
- **Sayım ve önbellek:** okunmamış sayısı sondan geriye sayılır ve `okunduSeq`'te durur; bir görünüm dizisinden
  türetilen sonuçlar dizinin kimliğine bağlı önbellekte tutulur. Ön koşul: görünüm dizisi `seq` sırasındadır ve
  yerinde değiştirilmez.
- Rozet açık (seçili) sohbette gösterilmez; başka sohbette okunmamış varsa üst çubuktaki menü simgesinde
  nokta. `[tasarim 6.1, 6.12]`

### Seçili sohbet ("en son açık sohbet hatırlanır")

- `CekirdekDurumu.secili` her zaman `sohbetler`'deki bir kimliktir ve `SecimKaydi.acik` olarak kalıcıdır.
- `baslat` sonunda kayıttaki `acik` listede yoksa `ana` olur (yazılır). Yerel sıfırlamadan sonra da aynı.
- `sec(id)` listede olmayan kimliğe `false`. `sohbetAc` başarıda yeni sohbeti seçer.
- Seçili sohbet silinince (`chat_deleted` ya da kurulamamışın yerel kaldırılması) listede kalan ilk sohbet
  (en son etkin) seçilir: defterde kaydı olan ilk satır (kayıtlılar `sonEtkinlikMs` azalan; başta duran
  kayıtsız satırlar atlanır); `ana` hep vardır, liste boş kalmaz. `[tasarim 6.14]`

### Outbox v2 → v3 (`outbox.ts`)

- Giden her mesaj `v: SOHBET_SURUMU` (Dilim 2'de 3, Dilim 3'te 4, 0.5.0'dan beri 5). İş türleri `IsMesajiTuru`'nun tamamı; `outbox.ts` ve `baglanti.ts`
  kümeleri `Record<IsMesajiTuru, true>` gibi bir yapıyla tipe bağlanır (biri eksik kalırsa `tsc` kırılır).
- **Geçici** (`GeciciIsTuru`: `chat_clear`, `chat_delete`): `ekle` seçeneğinden bağımsız hep geçici; kopunca
  yeniden yollanmaz (hatalara `baglanti_koptu` düşer, `index` gizler); yüklemede önceki süreçten kalanı
  kuyruktan da hatalardan da atılır (`atilan`).
- `chat_create`, `chat_rename` kuyrukta bekleyebilir (geçici değil), sırayla yollanır: aynı sohbetin
  `chat_create`'i, ilk `user_message`'ından önce kuyruktadır.
- **Yükseltme** (`kayitliMesajCoz`, kuyruk ve hatalar): v3 olduğu gibi çözülür. `v` 1 ya da 2 ise `v` 3
  yapılır; `type` `user_message`, `interrupt` ya da `chat_clear` ise ve `sohbet_id` yoksa `sohbet_id:
  ANA_SOHBET_ID` eklenir; sonra yeniden çözülür, geçmezse atılır. `plan_decision`/`question_answer`/
  `job_cancel` yalnız `v` değiştirir (şema `sohbet_id`'yi reddeder). Kimlik ve sıra değişmez; yükseltilen
  kayıt bir sonraki yazımda v3 yazılır. Diskteki kayıt biçimi (`{donem, sayac, ogeler, hatalar}`) aynıdır.
- `sohbetIdUret()`: `s-${donem}-${sayac + 1}`, sayaç artar; `yukle`'den önce atar.
- `kaldir(kosul)`: kuyruktan (yollanmış dahil) ve hatalardan uyanları kaldırır, `GeciciIsTuru`'na dokunmaz;
  koşul çağrı anında değerlendirilir; tek yazım. Diskte tutulan `chat_create` kopyası da (aşağıda) uyarsa gider.
- **`chat_create` kalıcılığı:** `ack ok` alan `chat_create` görünür kuyruktan çıkar ama `chat_created`
  uygulanana dek diskte (kuyruğun başında) tutulur; süreç ölürse sohbet adıyla kaybolmasın. Yeniden
  yüklemede kuyruğa döner ve aynı kimlikle yeniden yollanır (servis aynı `ack`'i döner). Disk kopyası şu
  durumlarda silinir: (1) `chat_created` canlı uygulanınca (telafi günlüğüne yazıldıktan sonra); (2) `ack ok`
  geldi ama teslime girmediyse (olayı zaten uygulandı ya da sohbet silindi); (3) yerel sıfırlamada
  (bellekten düşen teslimlerin kopyası); (4) açılışta olayı zaten günlükte olan sohbetin kopyası (silinmiş
  sohbetlerin artıklarıyla birlikte, tek `kaldir`). Kurulamamış sohbetin şeridindeki "Kaldır" iki adımlı
  onaydan geçer (menüdeki silme onayıyla aynı diyalog), onaylanınca yerel kaldırma çalışır.

### Outbox v3 → v4 (`outbox.ts`, Dilim 3)

Aynı kalıp, bir sürüm yukarı. `/sohbet` v4: `GIRDI_YOLLARI` `["yazi","dikte","kisayol"]`, `user_message` ve
`user_echo`'da isteğe bağlı `baglam{paket, ad}` (yalnız `input:"kisayol"` iken). `[protocol]`

- **Yükseltme** (`kayitliMesajCoz`): güncel sürüm olduğu gibi çözülür. `v` 1-4 ise `v` güncel sürüm (0.5.0'dan beri 5) yapılır, yeniden
  çözülür, geçmezse atılır. `sohbet_id` eklemesi yalnız v1/v2 içindir (`SOHBET_IDSIZ_SURUMLER`); v3 kaydı
  v4'ün alt kümesidir, yalnız `v` değişir. Kimlik ve sıra değişmez; yükseltilen kayıt bir sonraki yazımda
  güncel sürümle yazılır. `YuklemeOzeti.yukseltilen` v3'ü de sayar.
- **Bozuk kayıt:** eski sürümde olamayacak v4 alanını taşıyan kayıt (`input:"kisayol"` ya da `baglam`
  anahtarı) eski `v` ile gelmişse bozuktur: atılır (`atilan`), yükseltilmez.
- **`mesajYolla(metin, input, baglam?)`** (`Sohbet`): `baglam` yalnız `input === "kisayol"` ile kabul edilir
  ve `user_message.baglam` olur; başka girdi yoluyla verilirse hiçbir şey yazılmaz, `gecersiz`. Şema
  (paket deseni, `ad` 1-80, kontrol karakteri yok) outbox'ta kablo şemasıyla doğrulanır; geçmezse yine
  `gecersiz`, kuyruğa bir şey girmez. Kısayolda `baglam` yine isteğe bağlıdır. Tip: `MesajBaglami`
  (= `KisayolBaglami`).
- **Görünüm:** `olaylar.ts` `user_echo.baglam`'ı `KullaniciBalonu.baglam?` olarak taşır (alan yoksa yoktur);
  görünüm modelinde kullanıcı mesajı `baglam?` taşır.

### Outbox v4 → v5 (`outbox.ts`, 0.5.0)

`/sohbet` v5 yalnız plan şemasını değiştirdi (`kesin_yapilacaklar` ve `kesin_yapilmayacaklar` kalktı; aşağı olaylardaki plan). Yukarı mesajlar aynıdır: diskteki v4 kaydı yalnız `v` değişerek v5'e yükselir (`ESKI_SOHBET_SURUMLERI` 1-4); kısayol alanları yalnız v1-v3 kayıtta bozuk sayılır (`KISAYOLSUZ_SURUMLER`).

### Plan kartı durumu (0.5.0, `planKartiDurumu.ts`)

Kart yalnız gerçekten karar beklenirken "Onayını bekliyor" der ve karar düğmelerini gösterir (`onayBekleniyor`). Onay ya da otomatik deneme yoldaysa "Başlatılıyor", ret yoldaysa "Reddediliyor"; `onaylandi` iken kartın `is_id`'sinin iş kartı durumu gösterilir (Çalışıyor, Bitti, Hatayla bitti, Yarım kaldı, Limitte durdu, İptal edildi), iş kartı henüz yoksa "Başladı". Tam yetkiyle hemen başlayacak PC planı `plan_resolved` gelene dek "bekliyor" görünebilir (`plan_proposed` onay beklenip beklenmediğini taşımaz). Eski biçimli (iki listeli) plan olayları v5 şemasından geçmez: telefonda eski plan kartları geçmişten düşer.

### Telafi (`telafi.ts`)

Arayüz değişmez. Günlük kırpmasında bir satırın kalma kuralı (`kalirMi`), sırayla:

1. JSON nesnesi değilse ya da `seq` sayı değilse kalmaz.
2. `type` `SOHBET_YASAM_OLAYLARI`'ndan biriyse **her zaman kalır** (silinmiş sohbetinki dahil). Dilim 1
   kırpması `sinir_seq`'ten eski yaşam döngüsü olaylarını da silerdi; bu düzeltilir.
3. `sohbetAnahtari(satir)` silinmiş bir sohbetse kalmaz (o sohbetin mezar taşları dahil).
4. Mezar taşı kuralı Dilim 1'deki gibi, yalnız o sohbetin satırlarına: o sohbetin en yeni mezar taşı ve
   sonrası kalır, `seq > sinir_seq` olan mezar taşı olmayanlar kalır, eski mezar taşları gider.

`yukle` silinmiş kümeyi günlükteki geçerli `chat_deleted`'lardan (`ana` hariç) kurar, mezar taşlarıyla
birlikte kırpar ve kırpılmış listeyi döner. Canlı `chat_deleted` (ve canlı mezar taşı) olay günlüğe
eklenip `last_seq` ilerledikten sonra günlüğü kırpar (`satirlariYaz`); `last_seq` değişmez; kırpma
yazılamazsa olay yine uygulanır, sonraki `yukle` kırpmayı yineler. `[protocol]`

**`last_seq` yazımı:** değer artık olay başına yazılmaz; iki yerde yazılır: (a) açılıştaki kırpma günlükteki en
büyük `seq`'i düşürecekse kırpmadan ÖNCE, (b) olay sırası boşalınca bir kez. Açılışta değer
`max(günlükteki en büyük seq, dosya)` olarak hesaplanır; dosyaya yazılan değer her zaman önceden günlüğe
eklenmiş bir `seq`'tir.

### Bağlantı bekçisi ve karar teslimi (`index`)

**Bağlantı bekçisi:** cevabı gelmemiş bir gönderim varken kurulur, yoksa zamanlayıcı çalışmaz. Kısa gönderimlerde
(`user_message`, `interrupt`, `question_answer`, `chat_create`, `chat_rename`) 20 sn boyunca hiç çerçeve gelmezse
bağlantı koparılır ve yeniden bağlanılır; mesaj aynı `client_msg_id` ile yeniden gider. Geç cevaplı gönderimlerde
(`plan_decision`, `job_cancel`) 10 sn sessizlikte bir `usage_request` yoklaması gider, 10 sn daha çerçeve gelmezse
koparılır. Silme istekleri kendi 20 sn'lik sürelerini korur (`GECMIS_SIL_SURESI_MS`). Sabitler `BEKCI_SURELERI`'nde
(`YANIT_MS` 20 sn, `YOKLAMA_MS` 10 sn).

**Karar teslimi:** `plan_decision`, `question_answer`, `job_cancel` için kararın `ack ok`'u geldiğinde kart hâlâ
bekliyorsa karar `bekleyenler`'de `teslim_edildi` olarak durur; aynı karar yeniden gönderilmek istenirse
`zaten_yollandi` döner. Kayıt, kart sonuçlanınca, silinince, yerel sıfırlamada ya da `ack` anına kadar alınmış
olaylar uygulandığı hâlde kart hâlâ bekliyorsa düşer.

### Mezar taşı ve silinen sohbet (`index`)

- **Mezar taşı** (`chat_cleared`, canlı ya da yüklemede): Dilim 1 kuralı, yalnız o sohbet için: o sohbetin
  `olaylar` örneği kendini kırpar; `teslimler`'den o sohbetin `user_message`'ları kalkar; o sohbetin `sinir`'i
  güncellenir; canlıysa `mesajSohbeti` o sohbet olan hatalar kapatılır. Başka sohbetlere dokunulmaz.
- **Silinen sohbet** (`chat_deleted`): (1) canlıysa ve yüklemeden sonraysa `outbox.kaldir(m =>
  mesajSohbeti(m) === id)` (örnek silinmeden önce: plan/soru/iş kartı araması o an yapılabilsin); (2) o
  sohbetin `olaylar`/`akis` örneği, `sinir`'i ve `teslimler`'i kalkar; (3) `okundu[id]` kalkar; (4) seçiliyse
  "Seçili sohbet" kuralı. Yüklemede, bütün olaylar uygulandıktan sonra bir kez `outbox.kaldir(m =>
  defter.silindiMi(mesajSohbeti(m)))`.
- Silinmiş sohbete gelen sonraki görünüm olayı, delta ya da snapshot yok sayılır.

### Yönetim işlemleri (`Cekirdek`, `Sohbet`)

| İşlem | Kablo | Kuyruk | Yerel ret | Sonuç |
|---|---|---|---|---|
| `sohbetAc(ad?)` | `chat_create{sohbet_id, ad}` | bekleyebilir | `baslamadi`; `ad` verilip `adHazirla`'dan geçmezse `gecersiz`; kurulamamışlar hariç sohbet sayısı 8 ise `sohbet_siniri` | diske yazılınca `{ok, sohbet_id}`, sohbet seçilir |
| `adlandir(ad)` | `chat_rename{sohbet_id, ad}` | bekleyebilir | `gecersiz`, `sohbet_bulunamadi` (yok ya da kurulamadı) | `{ok:true, degisti}`; aynı adda hiçbir şey yollanmaz |
| `gecmisiSil()` | `chat_clear{sohbet_id}` | geçici, yalnız bağlı | `bagli_degil`, `zaten_yollandi`, `sohbet_bulunamadi` | `ack`'te çözülür; 20 sn'de `zaman_asimi` + bağlantı yenilenir |
| `sil()` | `chat_delete{sohbet_id}` | geçici, yalnız bağlı | `ana` → `sohbet_silinemez`; `bagli_degil`, `zaten_yollandi`, `sohbet_bulunamadi` | `ack`'te çözülür (aynı 20 sn); `kurulamadi` ise kablosuz yerel kaldırma, `{ok:true}` |
| `mesajYolla` | `user_message{sohbet_id, ...}` | bekleyebilir | `sohbet_bulunamadi` + Dilim 1 retleri | Dilim 1 + otomatik ad |
| `kes` | `interrupt{sohbet_id, turn_id?}` | hedefsiz ise geçici | `sohbet_bulunamadi` + Dilim 1 | Dilim 1 |

- **Tek silme yuvası:** aynı anda en çok bir `chat_clear` ya da `chat_delete` yoldadır (hangi sohbette
  olursa olsun); ikincisi `zaten_yollandi`. `ack`, kopma ya da 20 sn (`GECMIS_SIL_SURESI_MS`) çözer.
- **`ack` ve olay sırası** garanti değildir. `chat_create`/`chat_rename` `ack ok` ve `seq` ile gelir de
  `telafi.sonSeq() < seq` ise mesaj `teslimler`'e girer; o sohbet için `seq`'i `ack.seq`'ten küçük olmayan
  bir yaşam döngüsü olayı uygulanınca çıkar. Yan etkisiz `ok`'ta (`seq` yok) girmez.
- **Kurulamamış sohbet:** `chat_create` `ok:false` (ör. `sohbet_siniri`, `sohbet_bulunamadi`) aldıysa sohbet
  `kurulamadi`dır; mesaj, ad, temizleme `sohbet_bulunamadi`; `sil()` ya da `chat_create` hatasının
  `hataKapat`'ı `outbox.kaldir(m => mesajSohbeti(m) === id)` ile bütün yerel artıklarını kaldırır.
- **`bekleyenler`** yalnız `user_message`, `interrupt`, `plan_decision`, `question_answer`, `job_cancel` gösterir;
  **`hatalar`** bunlara ek `chat_create`/`chat_rename` hatalarını; `GeciciIsTuru` hiçbirinde görünmez.
- **Otomatik ad** (`[karar2 M5]`, `[tasarim 6.12]`): `mesajYolla` başarıyla kuyruğa yazınca, sohbet `ana`
  değilse, geçerli adı `VARSAYILAN_SOHBET_ADI` ise ve bu mesajdan önce o sohbette ne `kullanici` öğesi ne
  kuyrukta/teslimde `user_message` varsa `chat_rename{otomatikAd(metin)}` kuyruğa girer (`null` ise girmez,
  sonucu yutulur). `otomatikAd`: boşluk dizileri (satır sonu dahil) tek boşluk, `gorunmezBirimMi` birimleri
  atılır, kırpılır; 40 UTF-16 birimine sığıyorsa olduğu gibi; sığmıyorsa ilk 40 birimin son boşluğundan
  kesilip (boşluk yoksa 40'tan; yarım vekil çift atılır) sonuna "…" eklenir. Sonuç `SohbetAdi` değilse ya da
  `VARSAYILAN_SOHBET_ADI`'na eşitse `null`.

### Ekran akışları

- **`App.tsx`:** `cekirdekKur` ile tek çekirdek. `secili` sohbetin tutamacı `cekirdek.sohbet(cd.secili)`;
  `<SohbetEkrani key={cd.secili} .../>` (sohbet değişince ekranın yerel durumu sıfırlanır). Çekmece
  satırları `cekmeceSohbetleri(cd)`'den. Tek bir `SohbetYonetimi` (menü + diyaloglar) App'te durur; hem
  çekmece satırının `nokta3`'ü / uzun basması hem sohbet ekranının `nokta3`'ü onu `hedef` kimliğiyle açar.
- **Çekmece** (`[tasarim 6.12]`): "Yeni sohbet" düğmesi `sohbetAc()`; başarıda sohbet ekranı açılır,
  çekmece kapanır; `sohbet_siniri`nde düğmenin altında "En çok 8 sohbet açılabilir. Birini sil." Satır
  dokunuşu `sec(id)`. Önizleme önceliği: `kurulamadi` → "Oluşturulamadı" (`hata`); `yaziyor` → "{ad} yazıyor"
  (`bilgi`); `calisanIs > 0` → "{n} iş sürüyor" (`bilgi`); `bekliyor` → "Bağlanınca oluşturulacak"; yoksa son
  mesaj (kullanıcınınsa "Sen: " önekli; boşluklar tek, 120 karakter). Zaman `sonEtkinlikMs`; rozet `okunmamis`.
- **Eylem menüsü** (`[tasarim 6.13]`, adım 1): başlık sohbet adı; satırlar "Yeniden adlandır", "Geçmişi sil"
  (tehlikeli), "Sohbeti sil" (tehlikeli). Kapalı satır nedeni açıklamada:
  - `ana`: "Sohbeti sil" kapalı, "Ana sohbet silinemez, yalnız geçmişi silinebilir."
  - `bekliyor`: "Geçmişi sil" ve "Sohbeti sil" kapalı, "Sohbet henüz PC'ye ulaşmadı."
  - `kurulamadi`: "Yeniden adlandır" ve "Geçmişi sil" kapalı; "Sohbeti sil" yerine "Sohbeti kaldır",
    açıklama "PC'de oluşturulamadı, yalnız bu telefondan kalkar."
  - bağlı değil: "Geçmişi sil" ve "Sohbeti sil" kapalı, "Bağlantı yok. Yalnız bağlıyken silinir."
- **Ad diyaloğu** (`[tasarim 6.14]`): "Sohbeti yeniden adlandır"; girdi `autoFocus`, `selectTextOnFocus`,
  `maxLength={SOHBET_SINIRLARI.SOHBET_ADI}`, tek satır, `returnKeyType="done"`; "Kaydet" `adHazirla(metin)`
  `null` ya da geçerli adla aynıysa kapalı. `ok` → kapanır; ret → diyalogda hata satırı.
- **Silme, iki adım** (`[karar2 M5]`, `[tasarim 6.14]`): adım 1 menü satırı, adım 2 onay diyaloğu (tehlikeli
  düğme açılıştan sonra 600 ms kapalı, beklerken diyalog kapanmaz, hata diyalogda kalır). "Sohbet silinsin
  mi?" gövdesi silmenin gerçekte neyi sildiğini söyler: "\"{ad}\" sohbeti ve içindeki bütün mesajlar telefondan
  ve bilgisayardan silinir; bu sohbetin ana oturumu kapanır ve konuşmayı unutur. Silinmeyenler: iş kayıtları ve
  klasörleri, iş oturumlarının dökümleri, ana oturumun yazdığı dosyalar, Telegram notları ve telefondaki denetim
  günlüğü. Geri alınamaz." Onay bekleyen plan varsa uyarı "Onay bekleyen {n} plan iptal edilir." Düğme
  "Sohbeti sil". Kurulamamışta başlık "Sohbet kaldırılsın mı?", gövde "\"{ad}\" PC'de oluşturulamadı; yalnız
  bu telefondan kalkar, gönderilmeyi bekleyen mesajları da silinir.", düğme "Kaldır". Başarıda toast yok:
  sohbet listeden kalkar, seçiliyse çekirdek başka sohbete geçer. "Geçmişi sil" Dilim 1 akışıdır, gövdede
  sohbet adı geçer.
- **Sohbet ekranı:** başlık `ozet.ad`; alt başlık bu sohbetin `akis` ve `ozet.eren`'inden; sağda "Yeni sohbet"
  (`arti`) ve "{ad} seçenekleri" (`nokta3`); menü simgesinde başka sohbette okunmamış noktası. İş hapı ve
  "Çalışan işler" bütün sohbetlerin işleri (`cd.calisanIsler`; bağlıyken sayı `sunucu.aktif_is`); başka
  sohbetin işine dokununca o sohbet seçilir, kendi işine dokununca liste kayar. `ozet === null` ise boş durum
  "Bu sohbet artık yok."; `kurulamadi` ise hata şeridi "Sohbet PC'de oluşturulamadı." + "Seçenekler".
- **Durum ekranı:** küresel satırlar (kilit, aktif iş, RAM, limit) + "Sohbetler" bölümü: her sohbet için ad ve
  ana oturum durumu (`Uyuyor`, `Sırada` dahil); `kapali`/`sirada` dikkat renginde.
  Asistan/limit bölümünden sonra "Tüketim" bölümü gelir (bkz. "Tüketim" bölümü).

### Dilim 2 iş listesi

**Kural:** her satır tek dosya, tek agent. Üretim ve test ayrı satırlar, ayrı agent'lar (Genel kurallar 8).
Herkes `sozlesme.ts` "Dilim 2" bölümünü ve bu bölümü okur; sözleşmede eksik görürse yazmaz, raporlar.
Testler `cd app; node --test "test/**/*.test.ts"` (tek dosya: `node --test test/cekirdek/<ad>.test.ts`), tip
`cd app; npx tsc --noEmit -p tsconfig.json` ve `-p tsconfig.test.json`. "Tip temiz" = çıktıda kendi
dosyan yok.

**Dalga 0 (bitti):** `app/src/cekirdek/sozlesme.ts`, `app/TASARIM.md`.

| # | Dosya | Tür | Dalga | Bağımlılık | Paralel |
|---|---|---|---|---|---|
| O1 | `app/test/cekirdek/sahte.ts` | test, **ortak** | 1a (ilk, tek başına) | `@eren/protocol` v3 | — |
| Y1 | `app/app.json` | yapılandırma, **ortak** | 1 (herhangi an) | yok | evet |
| Ç1 | `app/src/cekirdek/outbox.ts` | üretim | 1 | sözleşme | evet |
| Ç2 | `app/src/cekirdek/baglanti.ts` | üretim | 1 | sözleşme | evet |
| Ç3 | `app/src/cekirdek/telafi.ts` | üretim | 1 | sözleşme | evet |
| Ç4 | `app/src/cekirdek/sohbetler.ts` (yeni) | üretim | 1 | sözleşme | evet |
| Ç5 | `app/src/cekirdek/secim.ts` (yeni) | üretim | 1 | sözleşme | evet |
| Ç6 | `app/src/cekirdek/index.ts` | üretim, **ortak giriş** | 1 (yazım); tip/test Ç1-Ç5 bitince | Ç1-Ç5 arayüzleri (sözleşmede) | evet |
| T1 | `app/test/cekirdek/outbox.test.ts` | test | 1b | O1 | evet |
| T2 | `app/test/cekirdek/baglanti.test.ts` | test | 1b | O1 | evet |
| T3 | `app/test/cekirdek/telafi.test.ts` | test | 1b | O1 | evet |
| T4 | `app/test/cekirdek/sohbetler.test.ts` (yeni) | test | 1b | O1 | evet |
| T5 | `app/test/cekirdek/secim.test.ts` (yeni) | test | 1b | O1 | evet |
| T6 | `app/test/cekirdek/index.test.ts` | test | 1b | O1 | evet |
| E1 | `app/src/ekranlar/baglam.ts` | üretim | 2 | Ç6 dışa açımı | evet |
| E2 | `app/src/ekranlar/baglantiDurumu.ts` | üretim | 2 | Ç6 | evet |
| E3 | `app/src/ekranlar/UstCubuk.tsx` | üretim | 2 | yok | evet |
| E4 | `app/src/ekranlar/Cekmece.tsx` | üretim | 2 | Ç6 | evet |
| E5 | `app/src/ekranlar/SohbetDiyaloglari.tsx` | üretim | 2 | Ç6, E1 | evet |
| E6 | `app/src/ekranlar/SohbetEkrani.tsx` | üretim | 2 | Ç6, E1, E2, E3, E5 (imzalar burada) | evet |
| E7 | `app/src/ekranlar/Balonlar.tsx` | üretim | 2 | Ç6 | evet |
| E8 | `app/src/ekranlar/DurumEkrani.tsx` | üretim | 2 | Ç6, E1 | evet |
| E9 | `app/src/ekranlar/KurulumEkrani.tsx` | üretim | 2 | Ç6 | evet |
| E10 | `app/test/ekranlar/baglantiDurumu.test.ts` (yeni) | test | 2 | E2 imzası | evet |
| K1 | `app/App.tsx` | üretim, **ortak bağlama** | 3 (son) | hepsi | hayır |
| D1 | doğrulama (dosya yok) | — | 4 | hepsi | hayır |

**Değişmeyenler (dokunulmaz, raporda "değişmez" diye geçer):** `cekirdek/akis.ts`, `cekirdek/olaylar.ts`,
`test/cekirdek/akis.test.ts`, `test/cekirdek/olaylar.test.ts` (O1'den sonra yeşil kalmalı; kalmazsa test
agent'ı raporlar), `ekranlar/PlanKartiEkrani.tsx`, `SoruKartiEkrani.tsx`, `RaporKartiEkrani.tsx` (`Sohbet`
tutamacı aynı yöntemleri taşır), `Diyalog.tsx`, `AltSayfa.tsx`, `AltaIn.tsx`, `Bilesenler.tsx`, `Ikonlar.tsx`,
`Markdown*`, `markdown.ts`, `tema.ts`, `depo/dosyaDepo.ts`, `platform/*`, `cihaz/erenDevice.ts`,
`modules/eren-device/**` (**Kotlin değişmez**: `/cihaz` ve eşleştirme v1, `HataKoduV1` aynı; `SozlesmeTest`
`HATA_KODLARI`'nı okumaz), `package*.json`. (`depo/dosyaDepo.ts` notu: `ekle`, dosya yeni satırla bitmiyorsa
yeni kaydı satır başından başlatır; bitiş bilgisi süreç başına bellekte tutulur, bilinmiyorsa son bayt bir kez okunur.)

#### O1 `app/test/cekirdek/sahte.ts` (ortak, önce)

- **Sorumluluk:** v3 kablo kalıpları. Var olanlar: `sunucuDurumu(extra)` → `eren` yerine
  `sohbetler: [{sohbet_id: "ana", eren: "hazir"}]`; `delta(turn_id, offset, text, sohbet_id = "ana")`,
  `snapshot(turn_id, text, sohbet_id = "ana")`, `chatClear(client_msg_id, sohbet_id = "ana")`;
  `mezarTasiOlayi(seq, sinir_seq, sohbet_id?)`, `yankiOlayi(seq, client_msg_id?, text?, sohbet_id?)`,
  `asistanOlayi(seq, turn_id, text, sohbet_id?)` (son parametre verilmezse alan yazılmaz: eski ya da `ana`).
  Yeni: `chatCreate(client_msg_id, sohbet_id, ad = "Yeni sohbet")`, `chatRename(client_msg_id, sohbet_id, ad)`,
  `chatDelete(client_msg_id, sohbet_id)` (yukarı çerçeveler, `v`), `sohbetAcildiOlayi(seq, sohbet_id, ad =
  "Yeni sohbet")`, `adDegistiOlayi(seq, sohbet_id, ad)`, `sohbetSilindiOlayi(seq, sohbet_id)`. `v` yorumu v3.
  `SahteDepo` değişmez.
- **Bitti:** her kalıbın çıktısı `@eren/protocol` şemasından geçer (olaylar `Olay`, aşağı çerçeveler
  `SohbetAsagi`, yukarılar `SohbetYukari`); dosya `tsconfig.test.json` ile tip temiz. Başka test dosyasına
  dokunmaz (onları T1-T6 düzeltir).

#### Y1 `app/app.json` (ortak)

- `expo.android.versionCode` 2 → **3**, `expo.version` "0.2.0" → "0.3.0" (`versionName`). `android/` klasörü
  `expo prebuild` üretimidir ve git'te yoktur; elle düzenlenmez.
- **Bitti:** JSON geçerli; D1'de APK'da `versionCode=3`.

#### Ç1 `app/src/cekirdek/outbox.ts`

- **Sorumluluk:** "Outbox v2 → v3" bölümü. Tipleri (`IsMesaji`, `GidenGovde`, `OutboxOgesi`, `GidenHataKodu`,
  `GidenHatasi`, `EkleSonucu`, `AckCercevesi`, `AckSonucu`, `EkleSecenekleri`, `YuklemeOzeti`, `Outbox`,
  `OutboxBagimliliklari`, `OutboxFabrikasi`) `sozlesme.ts`'ten alır, yerel tanımları siler, `export type {...}
  from "./sozlesme.ts"` ile yeniden açar (eski içe aktaranlar kırılmasın). `OUTBOX_ANAHTARI`, `isMesajiMi`,
  `outboxKur` kalır. Yeni: `sohbetIdUret`, `kaldir`; `chat_delete` geçici; yükseltme.
- **Bağımlı:** `sozlesme.ts` (`Outbox`), `@eren/protocol` (`ANA_SOHBET_ID`, `SOHBET_SURUMU`, `SohbetYukari`).
- **Bitti:** tip temiz; T1 yeşil.

#### Ç2 `app/src/cekirdek/baglanti.ts`

- **Sorumluluk:** `IS_TURLERI` `IsMesajiTuru`'nun tamamı (`chat_create`, `chat_rename`, `chat_delete` eklenir;
  tipe bağlı küme). Başka değişiklik yok; `BaglantiHatasi` ve `Baglanti` arayüzü donmuştur.
- **Bitti:** tip temiz; T2 yeşil.

#### Ç3 `app/src/cekirdek/telafi.ts`

- **Sorumluluk:** "Telafi" bölümü: `kalirMi` dört kuralı, `yukle`'de silinmiş küme, canlı `chat_deleted`
  kırpması. `SOHBET_YASAM_OLAYLARI` `@eren/protocol`'den okunur, tür adı elle yazılmaz. `Telafi` arayüzü,
  `TELAFI_ANAHTARLARI` değişmez.
- **Bitti:** tip temiz; T3 yeşil.

#### Ç4 `app/src/cekirdek/sohbetler.ts` (yeni)

- **Sorumluluk:** saf, port yok. Dışa açar: `sohbetDefteriKur: SohbetDefteriFabrikasi`, `ozetleriKur:
  OzetleriKur`, `adHazirla: AdHazirla`, `otomatikAd: OtomatikAdUret`, `erenKaynakli: ErenKaynakliMi`,
  `OTOMATIK_AD_UZUNLUGU = 40`. Kurallar: "Sohbet listesi" 1-5, "Okunmamış" tanımı, "Otomatik ad".
  `adHazirla`: kırp, boşsa `null`, `SohbetAdi.safeParse` geçmezse `null`. Değerler `@eren/protocol`'den
  (`ANA_SOHBET_ID`, `ANA_SOHBET_ADI`, `VARSAYILAN_SOHBET_ADI`, `SohbetAdi`, `gorunmezBirimMi`).
- **Bitti:** tip temiz; T4 yeşil.

#### Ç5 `app/src/cekirdek/secim.ts` (yeni)

- **Sorumluluk:** `SECIM_ANAHTARI = "sohbet_secimi"`, `secimDeposuKur: SecimDeposuFabrikasi`. Disk:
  `{"surum":1,"acik":...,"taban_seq":...,"okundu":{...}}`. `yukle`: anahtar yok, okuma atarsa, JSON bozuk,
  `surum !== 1`, `acik` `SohbetId` değil ya da `taban_seq` güvenli tamsayı ≥ 0 değilse `null`; `okundu`'da
  geçersiz girdi (kimlik ya da değer) tek tek atılır. `yaz`: sırayla, arkadan, son yazılan kazanır (sırada
  bekleyen eski yazım atlanabilir), hata yutulur. `bosalt`: sıra boşalınca çözülür.
- **Bitti:** tip temiz; T5 yeşil.

#### Ç6 `app/src/cekirdek/index.ts`

- **Sorumluluk:** `export const cekirdekKur: CekirdekFabrikasi` (`sohbetKur` ve `SohbetPortlari` kalkar).
  Yerel `SunucuDurumu`, `BekleyenDurumu`, `BekleyenOge`, `SohbetHatasi`, `SohbetDurumu`, `GonderRedNedeni`,
  `GonderSonucu`, `PlanKarari`, `GecmisSilHatasi`, `GecmisSilSonucu`, `Sohbet` tanımları silinir, hepsi
  `sozlesme.ts`'ten. Yeniden dışa açar: sözleşmenin ekran tipleri (`Cekirdek`, `CekirdekDurumu`,
  `CekirdekPortlari`, `Sohbet`, `SohbetDurumu`, `SohbetOzeti`, `SohbetKurulumu`, `SonMesaj`, `CalisanIs`,
  `BaglantiOzeti`, `BekleyenOge`, `BekleyenDurumu`, `SohbetHatasi`, `SunucuDurumu`, `GonderRedNedeni`,
  `GonderSonucu`, `PlanKarari`, `AdlandirSonucu`, `GecmisSilHatasi`, `GecmisSilSonucu`, `SohbetSilHatasi`,
  `SohbetSilSonucu`, `SohbetAcSonucu`, `IsMesaji`, `GidenHataKodu`, `GidenHatasi`, `AkisDurumu`,
  `BaglantiDurumu`, `GecmisSilindiNotu`, `IptalEt`), Dilim 1'deki `olaylar.ts`/`baglanti.ts` tipleri ve
  `ServisBilgisi`; değer olarak `cekirdekKur`, `GECMIS_SIL_SURESI_MS`, `adHazirla` (sohbetler.ts'ten).
- **Davranış:** bu bölümün "Olay yönlendirme", "Sohbet listesi" 6, "Okunmamış", "Seçili sohbet", "Mezar taşı
  ve silinen sohbet", "Yönetim işlemleri". `baslat` sırası: `telafi.yukle` → `outbox.yukle` →
  `secim.yukle` → olaylar uygulanır → silinmiş sohbet artıkları `kaldir` → seçim kaydı yoksa taban kurulur
  ve yazılır → `acik` listede değilse `ana` → `yuklendi`. Durum nesneleri değişmedikçe aynıdır: `durum()` ve
  her tutamacın `durum()`'u alanları öncekiyle `===` ise eski nesneyi döner. `sohbet(id)` aynı kimliğe aynı
  tutamaç (bir `Map`'te). Toplu telafide bildirim Dilim 1'deki gibi seyreltilir.
- **Bağımlı:** sözleşme (`Outbox`, `SohbetDefteri`, `OzetleriKur`, `SecimDeposu`, `Telafi` telafi.ts'te,
  `Olaylar`/`Akis` kendi dosyalarında, `Baglanti`).
- **Bitti:** tip temiz (`src/cekirdek/**` için hiç hata yok); T6 yeşil.

#### T1 `app/test/cekirdek/outbox.test.ts`

Var olan testler v3'e çevrilir (`user_message`/`interrupt`/`chat_clear`'a `sohbet_id`). Eklenecek iddialar:
diskteki v2 `user_message`/`interrupt`/`chat_clear` `sohbet_id:"ana"` ve `v:3` olur, kimlik ve sıra aynı,
`yukseltilen` sayılır, sonraki yazım v3; v1 öğe de aynı; v2 `plan_decision` yalnız `v` değişir; `chat_delete`
her zaman geçici ve önceki süreçten kalanı atılır (kuyrukta ve hatalarda); `chat_create`/`chat_rename` kopmadan
sonra yeniden yollanır; `sohbetIdUret` `s-<donem>-<n>` verir, `OpakId`'den geçer, ardışık çağrılar farklı,
araya giren `ekle`'nin `client_msg_id`'si ile çakışmaz, yeniden başlatmada (aynı depo) tekrar etmez,
`yukle`'den önce atar; `kaldir` kuyruk ve hatadan uyanları siler, geçicilere dokunmaz, kaldırılan yollanmış
öğenin `ack`'i `null`, diske yazılır.

#### T2 `app/test/cekirdek/baglanti.test.ts`

Var olanlar v3 kalıplarına (O1) çevrilir. Ek: kimlik sonrası `chat_create`, `chat_rename`, `chat_delete`
`gonder` ile gider (`true`); kimlik öncesi gitmez; `hello`/`auth_response` `v:3`.

#### T3 `app/test/cekirdek/telafi.test.ts`

Ek: mezar taşı (`sohbet_id` verili ve alansız) yalnız kendi sohbetini kırpar, başka sohbetin satırları kalır;
`sinir_seq`'ten eski `chat_created`/`chat_renamed` kırpmada kalır; canlı `chat_deleted` sonrası günlükte o
sohbetin yalnız yaşam döngüsü olayları kalır (mezar taşı da gider), `last_seq` aynı; yüklemede aynı kırpma ve
dönen listede o sohbetin görünüm olayı yok; `chat_deleted{sohbet_id:"ana"}` hiçbir şeyi silmez; `satirlariYaz`
hatasında olay yine uygulanır ve sonraki `yukle` kırpar.

#### T4 `app/test/cekirdek/sohbetler.test.ts` (yeni)

Defter: başta yalnız `ana`/asistan adı; `chat_created` → kayıt; `chat_renamed` ad değiştirir (`ana` dahil); silinmiş
kimliğe sonraki `chat_created`/`chat_renamed` yok sayılır; `chat_deleted{ana}` yok sayılır; eski `seq` yok
sayılır; `sifirla`. Özet: kurulum dört dalı (defter, teslim, kuyruk, hata); ad önceliği (kuyruktaki rename >
teslim > defter; hatalı rename yok sayılır); `eren` ve `yaziyor`; `okunmamis` sınır ve küme (bilgi sistem
notu ve kullanıcı balonu sayılmaz); `calisanIs`; `sonMesaj`; sıra (kayıtsızlar başta en yeni önce, sonra
`sonEtkinlikMs`, eşitlikte `olusturma_seq`); `sunucu`'daki bilinmeyen kimlik listeye girmez. `adHazirla`:
boş, boşluklu, 60/61 birim, satır sonu, görünmez karakter. `otomatikAd`: kısa metin aynen, uzun metin sözcük
sınırında + "…" (≤ 41 birim), boşluksuz uzun metin 40'ta, emoji vekil çifti bölünmez, satır sonları tek boşluk,
yalnız boşluk/görünmez → `null`, "Yeni sohbet" → `null`.

#### T5 `app/test/cekirdek/secim.test.ts` (yeni)

Gidiş dönüş; anahtar yok → `null`; bozuk JSON, yanlış `surum`, geçersiz `acik` ya da `taban_seq` → `null`;
`okundu`'da geçersiz girdi tek tek atılır; `oku` atarsa `null`; ardışık `yaz`'larda diskte son kayıt; `yaz`
hatası yutulur ve sonraki `yaz` çalışır; diskte yalnız kimlik ve sayı var.

#### T6 `app/test/cekirdek/index.test.ts`

Var olanlar `cekirdekKur` + `cekirdek.sohbet("ana")` ile çevrilir. Ek senaryolar (sahte portlarla, uydurma
veri): (1) `sohbetAc` çevrimdışı → liste başında `bekliyor`, seçili; bağlanınca `chat_create` ilk mesajından
önce gider; `ack` + `chat_created` → `kuruldu`; `ack` olaydan önce gelince sohbet listeden düşmez. (2) İki
sohbete mesaj; olaylar doğru sohbetin `ogeler`'inde; delta/snapshot doğru sohbetin `akis`'inde; birinin
akışı ötekinin `SohbetDurumu` nesnesini değiştirmez. (3) Okunmamış: seçili olmayan sohbete asistan mesajı
sayılır, `okundu()` sıfırlar ve kalıcıdır (yeniden kurulunca aynı); ilk Dilim 2 açılışında eski geçmiş
okunmamış değil; sıfırlamadan sonra taban `head_seq`. (4) Otomatik ad: "Yeni sohbet" adlı sohbete ilk mesajda
`chat_rename` kuyruğa girer, ikinci mesajda girmez, kullanıcı adlandırdıysa ve `ana`'da girmez. (5) `adlandir`:
geçersiz ad, aynı ad (`degisti:false`, kablo yok), yeni ad (kuyrukta ad hemen görünür). (6) `sil`: `ana` →
`sohbet_silinemez` kablo yok; bağlı değil → `bagli_degil`; yolda silme varken ikinci → `zaten_yollandi`;
`ack ok` + `chat_deleted` → listeden kalkar, seçiliyse en son etkin diğer sohbet seçilir, o sohbetin hataları
kalkar; `ack sohbet_mesgul`; kopma → `baglanti_koptu`, yeniden yollanmaz; 20 sn → `zaman_asimi`. (7)
Kurulamamış: `chat_create` `ok:false sohbet_siniri` → `kurulamadi`, `mesajYolla` `sohbet_bulunamadi`, `sil()`
kablosuz kaldırır. (8) `sohbetAc` sınır: 8 sohbetle `sohbet_siniri`, hiçbir şey yazılmaz. (9) Seçim kalıcı:
`sec` + yeniden kurma aynı sohbeti açar; kayıttaki sohbet artık yoksa `ana`. (10) Disk v2 kuyruğu (Dilim 1
kalıntısı) `ana`'nın bekleyenlerinde görünür ve v3 gider. (11) `server_status.sohbetler` → `ozet.eren`;
kopunca `null`. (12) Mezar taşı yalnız kendi sohbetinin görünümünü ve hatalarını temizler.

#### E1 `app/src/ekranlar/baglam.ts`

`useCekirdekDurumu(c: Cekirdek): CekirdekDurumu` ve `useSohbetDurumu(s: Sohbet): SohbetDurumu` (ikisi de
`useSyncExternalStore`). **Bitti:** tip temiz.

#### E2 `app/src/ekranlar/baglantiDurumu.ts`

İmzalar: `kaliciHataVar(d: BaglantiOzeti)`, `hatHesapla(d: BaglantiOzeti)`, `altBaslikHesapla(d:
BaglantiOzeti, sohbet?: { akis: AkisDurumu | null; eren: SohbetErenDurumu | null } | null)`. Alt başlık
tablosu (ilk tutan): kalıcı hata; kapalı; bağlanıyor; kimlik; eşitleniyor; (yalnız `sohbet` verilince)
`akis !== null || eren === "tur_suruyor"` → "{ad} yazıyor" `basari`, `baslatiliyor` → "{ad} başlatılıyor"
`basari`, `sirada` → "{ad} sırada, mesajın bekliyor" `uyari`, `kapali` → "Bağlı, {ad} kapalı" `uyari`; sonra
"Bağlı" `basari` (`hazir`, `uyuyor`, `null` dahil). **Bitti:** tip temiz; E10 yeşil.

#### E3 `app/src/ekranlar/UstCubuk.tsx`

`sol` ek alanı `nokta?: boolean` (menü simgesinin sağ üstünde 8 dp `vurgu` noktası; erişilebilirlik etiketine
", başka sohbette okunmamış var"). `sag?: SagDugme | readonly SagDugme[] | null`, `export type SagDugme = {
simge: "nokta3" | "arti"; etiket: string; basinca: () => void }`; en çok iki, soldan sağa, her biri 48×48.
Eski çağrılar aynen çalışır. **Bitti:** tip temiz.

#### E4 `app/src/ekranlar/Cekmece.tsx`

`CekmeceSohbet`'e `onizlemeRenk?: RenkAdi` (yoksa `metinSonuk`). Props: `onSecenekler: (id: string) => void`
(satırda `nokta3` 48×48 düğme, `accessibilityLabel="{ad} seçenekleri"`, ayrıca uzun basma), `yeniSohbetNotu?:
string | null` (düğmenin altında `kucuk` `uyari`). Dışa açar: `cekmeceSohbetleri(d: CekirdekDurumu):
readonly CekmeceSohbet[]` ("Ekran akışları / Çekmece" önizleme önceliği ve eşlemesi; `secili` `d.secili`'den,
`zaman_ms` `sonEtkinlikMs`'ten). **Bitti:** tip temiz.

#### E5 `app/src/ekranlar/SohbetDiyaloglari.tsx`

- `EylemMenusu(p: { acik; onKapat; baslik: string; adlandirEngeli: string | null; gecmisSilEngeli: string | null;
  sohbetSilEngeli: string | null; kurulamadi: boolean; onAdlandir(); onGecmisiSil(); onSohbetiSil() })`
  (satırlar ve metinler "Eylem menüsü").
- `AdDiyalogu(p: { acik; onKapat; sohbet: Sohbet; mevcutAd: string })` ("Ad diyaloğu"; `adHazirla` index'ten).
- `GecmisiSilOnayi` aynı props + `ad: string`; gövde `gecmisiSilGovde(ad)` (Dilim 1 metni, başta sohbet adı).
- `SohbetiSilOnayi(p: { acik; onKapat; sohbet: Sohbet; ad: string; kurulamadi: boolean; bekleyenPlan: number })`,
  `sohbetiSilGovde(ad)`, `sohbetSilHataMetni(s: SohbetSilSonucu | null)`: `sohbet_mesgul` → "Önce bu sohbette
  çalışan işin bitmesini, bekleyen sorunun cevaplanmasını ya da ana oturumun cevabını bekle."; `sohbet_silinemez` →
  "Ana sohbet silinemez, yalnız geçmişi silinebilir."; `sohbet_bulunamadi` → "Bu sohbet zaten yok."; diğerleri
  `gecmisSilHataMetni` ile aynı anlam ("silme" yerine "sohbet silme").
- `SohbetYonetimi(p: { cekirdek: Cekirdek; hedef: SohbetId | null; onKapat: () => void })`: `hedef` dolunca
  menü açılır; satır seçilince menü kapanır, ilgili diyalog açılır; diyalog kapanınca `onKapat`. Engeller
  `ozet` ve `baglanti`'dan ("Eylem menüsü" listesi). `hedef`'in özeti listeden kalkarsa (silindi) kapanır.
- `CalisanIslerSayfasi(p: { acik; onKapat; isler: readonly CalisanIs[]; toplam: number | null; acikSohbet:
  SohbetId; sohbetAdi: (id: SohbetId) => string; onIsSec: (c: CalisanIs) => void; onIptal: (c: CalisanIs) =>
  void })`: başka sohbetin işinde alt satırın sonuna ", {sohbet adı}". `IsIptalOnayi` aynı (çağıran işin
  sohbetinin tutamacını verir).
- **Bitti:** tip temiz.

#### E6 `app/src/ekranlar/SohbetEkrani.tsx`

Props: `{ cekirdek: Cekirdek; sohbet: Sohbet; cihaz; onCekmece; onSecenekler: (id: SohbetId) => void;
onKurulum? }`. `SOHBET_ADI` sabiti kalkar; "Ekran akışları / Sohbet ekranı" ve "Okunmamış / Okundu".
`EylemMenusu`/`GecmisiSilOnayi` kullanımı buradan kalkar (App'teki `SohbetYonetimi`). "Yeni sohbet" düğmesi
`cekirdek.sohbetAc()`; `sohbet_siniri`nde not "En çok 8 sohbet açılabilir. Birini sil.". `GONDER_RED`'e
`sohbet_bulunamadi` → "Bu sohbet artık yok.". 455. satırdaki `d.sunucu?.eren` → `d.ozet?.eren`. **Bitti:** tip
temiz.

#### E7 `app/src/ekranlar/Balonlar.tsx`

`MESAJ_ADI`'na `chat_create: "Sohbet oluşturma"`, `chat_rename: "Yeniden adlandırma"`, `chat_delete: "Sohbet
silme isteği"` (son ikisi `hatalar`'da görünmez; tip bütünlüğü). Başka değişiklik yok. **Bitti:** tip temiz.

#### E8 `app/src/ekranlar/DurumEkrani.tsx`

Props `{ cekirdek: Cekirdek; tanilamaAc? }`. `EREN` eşlemesi `SohbetErenDurumu`'nun altısı ("Başlatılıyor",
"Hazır", "Yanıt yazıyor", "Kapalı", "Uyuyor", "Sırada"). "{ad}" bölümü: küresel satırlar + "Canlı {ad}" sayısı
(`baslatiliyor`/`hazir`/`tur_suruyor`); yeni "Sohbetler" bölümü: her sohbet için ad → durum, `kapali`/`sirada`
dikkat. Notlar: bir sohbette kapalı → "Bir sohbette {ad} kapalı."; sırada → "Bazı sohbetler sırada: canlı {ad}
sınırı ya da PC belleği.". **Bitti:** tip temiz.

#### E9 `app/src/ekranlar/KurulumEkrani.tsx`

Props `{ cihaz; cekirdek: Cekirdek }` (yalnız `simdiBaglan`). **Bitti:** tip temiz.

#### E10 `app/test/ekranlar/baglantiDurumu.test.ts` (yeni)

`altBaslikHesapla` tablosunun her satırı, `sohbet` verilmeden ana oturum satırlarının atlanması, `GECICI_HATALAR`
kalıcı hata sayılmaz. Yalnız `baglantiDurumu.ts`'i içe aktarır (RN yok).

#### K1 `app/App.tsx` (son)

"Ekran akışları / App". `sohbetKur` → `cekirdekKur`; `onizleme` ve sabit `sohbetler` kalkar
(`cekmeceSohbetleri`); `SohbetYonetimi` ve `menuHedefi` durumu; Durum/Kurulum üst çubukları ve çekmece alt
bilgisi `hatHesapla(cd)`/`altBaslikHesapla(cd)` (sohbetsiz). Geri tuşu Dilim 1 sırası (menü ve diyaloglar
kendi `Modal`'larıyla kapanır). **Bitti:** `npx tsc --noEmit -p tsconfig.json` ve `-p tsconfig.test.json`
çıktısı boş.

#### D1 Doğrulama (şef, dosya yok)

`tsc` iki yapılandırma boş; `node --test "test/**/*.test.ts"` yeşil; isteğe bağlı Kotlin `gradlew test`
(değişmediğinin kanıtı); `npx expo prebuild --platform android --clean` + `assembleRelease`, `aapt dump
badging` `versionCode='3'`; telefonda: iki sohbet aç, birinde uzun yanıt akarken ötekine yaz; rozet; uçak
modunda yeni sohbet + mesaj, bağlanınca sıra; adlandır; sil (iki adım); uygulamayı kapatıp aç: son açık
sohbet açılır.

## Dilim 3: telefon kullanma, tam yetki, kısayol

Karar (2026-11-09): asistan kullanıcının kendi asistanı, uygulama kullanıcının kendi telefonunda ve kendi kurduğu özel
bir uygulama; onay ekranı yerine tam yetki ("telefonda da serbest"). Kapsam: telefon işinin raporu ana oturuma
gider ve ona dayanan PC işleri onaysız başlar; telefonda okuma, yazma, gönderme onay ekranı olmadan başlar;
kısayoldan (Hızlı Ayarlar kutucuğu, bildirim eylemi) sesle mesaj gider. **Hâlâ geçerli kalanlar:** değişmez
ret listesi (asistanın kendi uygulaması, Ayarlar, kurucu, Play, izin diyalogları, üretici güvenlik, Tailscale, kilit
ekranı), kullanıcının "hassas" listesi (banka/para/kimlik uygulamaları otomatik hassas; 0.4.3), parola alanı, URL/intent yasağı, izin süresi ve bütçesi, kalıcı
bildirim + Durdur, denetim günlüğü. Etiketler: `[protocol]` = `/sohbet` v5 (`SOHBET_SURUMU` 5; Dilim 3'te 4). Sözleşme
dosyaları `Sozlesme.kt`, `Portlar.kt`, `IcSozlesme.kt`, `AdaptorSozlesmesi.kt`, `ErenDevice.types.ts` ve
`sozlesme.ts` yeniden dondurulmuştur; burası davranıştır.

### İki bağımsız anahtar

- **Telefon:** Kotlin'de `TamYetki` bayrağı; varsayılan kapalı; açmak biyometri ister (yalnız
  `TamYetkiActivity`); PC ve JS açamaz; kapatmak serbest ve var olan izinlere dokunmaz.
- **PC:** `ayar.local.json` `tam_yetki` (varsayılan `true`; bkz. `server/MODULLER.md` "Dilim 3").
- `/cihaz` kablosu ve `protocol/vektorler/` değişmez: izin kaynağı (`ONAY`/`OTO`) kabloya girmez
  (`grant_issued` taşımaz, kapı bakmaz). Tek kablo değişikliği `/sohbet` v4'tür ("Outbox v3 → v4").

### Çekirdek (`modules/eren-device/cekirdek/`)

- `enum class IzinKaynagi { ONAY, OTO }` (`Sozlesme.kt`); `OnayliIzin.kaynak` varsayılan `ONAY` (mevcut
  çağıranlar değişmez); `Izinler.ekle` kaynağı `IzinKaydi`'na ve `DenetimKaydi.izinVerildi(grantId, paketler,
  kaynak)`'a geçirir. Sınır denetimi (süre, bütçe, paket sayısı, `yaz`'da tek paket) iki kaynakta aynıdır;
  `OTO` hiçbir sınırı aşamaz.
- **Denetim satırı v2.** `DenetimSatiri.kaynak: IzinKaynagi? = null`, yalnız `IZIN_VERILDI` satırında dolar.
  Kaynaksız satır bayt bayt eskisi gibi `v1` (on alan) yazılır; kaynaklı satır `v2` ve on bir alandır:
  `v2|duvarMs|olay|grantId|cmdId|komut|denied|hata|grantNedeni|paket|kaynak` (`kaynak` enum adı, `ONAY`/`OTO`).
  Sürümü `kaynak` belirler: `v2`'de `~`, bilinmeyen ad ya da sürüm-alan sayısı uyuşmazlığı bozuktur (`null`);
  eski `v1` satırları aynen okunur ve aynen yeniden yazılır. Günlükte jeton yine yoktur.

### Android adaptörü (Dilim 3 dosyaları)

| Dosya | Sorumluluk |
|---|---|
| `ErisimAnahtari.kt` (object) | Uygulamanın erişilebilirlik servisini açıp kapatan tek nesne ve `Settings.Secure`'a yazan TEK yer (değişmez 2). Karar: servis yalnız aktif izin varken açık. Kurulumda bir kez `adb shell pm grant dev.eren.app android.permission.WRITE_SECURE_SETTINGS`. `ac(ctx) { AcmaSonucu }`: `ACIK` / `YETKI_YOK` / `ZAMAN_ASIMI` (4 sn); ana iplikte çağrılır, geri çağrı ana iplikte ve tam bir kez gelir; ayar yazımı kendi sıralı ipliğinde; kapanış sürerken gelen `ac` kopuşu bekler, sonra yeniden açar; `ACIK` verildikten sonra en az 10 sn kapatılmaz (izin `ACIK` ile `izinler.ekle` arasında doğarken servis kapanmasın). `OnayActivity` da artık izni `ACIK`'tan sonra doğurur. `sesKisayoluKur` (0.4.3) kilit ekranı anahtarını (`accessibility_shortcut_on_lock_screen`) yine yazmaz; kısayolun kilitliyken çalışmaması `KisayolErisimServisi` içindedir (bağlanınca `KeyguardManager.isKeyguardLocked` ya da alınamazsa kilitli sayılırsa `KisayolActivity` açılmaz, `disableSelf`). |
| `ErisimServisi`, `EkranOkuyucu`, `Eylemci` | Artık gerçek. `ErisimServisi` ince bağlantı servisi: bağlanma/kopma `ErisimAnahtari`'na ve çekirdeğe, pencere paket adı `EkranOkuyucu.pencereOlayi`'na gider; aktif izin yokken olay işlenmez. `EkranOkuyucu` `EkranPortu`'nu erişilebilirlik ağacından ve `takeScreenshot`'tan gerçekler (pencere türü sınıflaması, parola metni hiç okunmaz). `Eylemci` `EylemPortu`'nu gerçekler (`Gonderildi` yalnız "sisteme verildi"). |
| `TamYetki.kt` (object) | `acik(ctx)`, `ac(ctx)`, `kapat(ctx)`; kalıcı, uygulama içi SharedPreferences (`MODE_PRIVATE`), varsayılan kapalı; ilk okumadan sonra bellekten. Değişince `Adaptor.olaylar?.durumDegisti()`. `ac`'ın tek çağıranı `TamYetkiActivity` (değişmez 5). |
| `TamYetkiActivity.kt` | `exported=false`, FLAG_SECURE, `filterTouchesWhenObscured`, erişilebilirlik tıklaması ve örtülü dokunuş reddi; tam yetkinin ne demek olduğunu Türkçe anlatır; `BIOMETRIC_STRONG or DEVICE_CREDENTIAL`; başarıda `TamYetki.ac`. Sonuç `RESULT_OK` + extra `sonuc`: `"acildi"` ya da `"iptal"`. Köprü `startActivityForResult` ile açar (`OnayActivity` deseni). |
| `OtoIzinKapisi.kt` (object) | `dene(ctx, planJson, planHash, sonuc)`: tam yetkide telefon planını onay ekranı olmadan izne çevirir; `izinler.ekle`'yi `OnayActivity` dışında çağıran TEK yer (değişmez 1). Ana iplikte çağrılır (denetimler, etkin izin araması ve `izinler.ekle` ana iplikte; yalnız son olay tohumunun ekran okuması `anlik()` işçi ipliğinde), sonuç ana iplikte ve tam bir kez gelir. Aynı `plan_id`+`plan_hash` için etkin izin varsa yenisi doğmaz, mevcut `grant_id` döner. `OtoIzinSonucu.Verildi(grantId)` ya da `OnayGerekli(neden)`. Sıra aşağıda. |
| `KisayolDeposu.kt` | `KisayolMesaji(id, metin, paket?, ad?, zamanMs)`. `onPlan(ctx)`: `UsageStatsManager` ile son 60 sn'deki en son `ACTIVITY_RESUMED` (API 29 altı `MOVE_TO_FOREGROUND`) paketi; kendi paketimiz, `com.android.systemui` ve varsayılan başlatıcı hariç; yetki yoksa `null`. En son olay başlatıcı ya da kendi paketimizse de `null` (kullanıcı başka uygulamaya bakmıyor; bayat ön plan gönderilmez). `koy(ctx, metin, paket): String`: paket `null`'sa ya da hassas/değişmez listedeyse paket ve ad `null` (ad PackageManager etiketinden, en çok 80, kontrol karakterleri ayıklı); bellekte TEK yuva (yeni eskisini siler); `Adaptor.olaylar?.kisayolGeldi(id)`; id döner. `al()` yuvadakini verir, tüketmez. `tuket(id)` yalnız `id` yuvadakiyle eşleşirse siler (daha yeni mesaj ezilmez). İş-parçacığı güvenli. `koy`'un tek çağıranı `KisayolActivity` (değişmez 6). |
| `KisayolActivity.kt` | `exported=false`, saydam tema (`res/values/styles.xml`), `taskAffinity=""`, `excludeFromRecents`, `configChanges` (döndürmede yeniden yaratılmaz). `noHistory` bilerek yoktur: tanıyıcı opak pencereyle gelirse `onStop`'ta etkinlik kapanır ve dikte sonucu kaybolurdu. Akış: (1) açılır açılmaz `KisayolDeposu.onPlan` (dikte penceresi öne geçmeden); (2) köprüdeki `dikte()` ile aynı `RecognizerIntent` (tr-TR, RECORD_AUDIO yok); (3) boş olmayan metin gelince (0.4.3'ten beri) kart, geri sayım, Gönder ve İptal yok: `KisayolDeposu.koy` hemen çağrılır ve "<asistanAdi()> oturumuna gönderildi · <bağlam adı>" Toast'u çıkar; `Adaptor.olaylar == null` (JS ayakta değil) ise uygulamanın başlatıcı etkinliği başlatılır; sonra kapanır. Dikte iptal ya da boşsa hiçbir şey gönderilmez, sessizce kapanır; dikte sürerken iptal yalnız tanıyıcının kendi iptali ya da geri tuşuyla olur. Yanlış tanınan dikte de gider. Çift gönderim `bitti` bayrağıyla önlenir. Gönderilen bağlam: ad gösterilemiyorsa paket de gönderilmez. |
| `KisayolKutucugu.kt` | `TileService`, etiket `{ad}` (çalışma anında uygulama etiketinden), alt başlık "Söyle"; `onClick` → `KisayolActivity` (API 34+ `PendingIntent` ile `startActivityAndCollapse`, altı `Intent`); kilitliyse `unlockAndRun` içinde. Manifest: `exported=true` + `BIND_QUICK_SETTINGS_TILE`, simge `@drawable/ic_eren_kutucuk`. |
| `Bildirimler.kt` | Kalıcı bildirime "{ad} ile konuş" eylemi: `PendingIntent.getActivity` (`FLAG_IMMUTABLE`) → `KisayolActivity`. "Durdur" varsa önce kalır, "{ad} ile konuş" sona eklenir. |
| `AdaptorSozlesmesi.kt`, `ErenDeviceModule.kt` | `AdaptorOlaylari`'na `kisayolGeldi(id)`; modül köprü olayı `kisayolGeldi{id}` yayınlar (yalnız kimlik; metin `kisayolAl()` ile çekilir) ve aşağıdaki köprü işlevlerini gerçekler. Manifest: `WRITE_SECURE_SETTINGS` ve `PACKAGE_USAGE_STATS` (ikisi korumalı; kurulumda adb ile: `pm grant ... WRITE_SECURE_SETTINGS`, `appops set ... GET_USAGE_STATS allow`). |

**`OtoIzinKapisi.dene` sırası** (ilk takılan döner; hepsi `OnayGerekli(neden)`, `neden` kapalı listedir):

1. `TamYetki.acik` değilse `tam_yetki_kapali`.
2. Plan `OnayActivity`'deki gibi sıkı çözülür (`Sema.planCoz`), özet yeniden hesaplanıp `planHash` ile
   karşılaştırılır; tür `telefon` değilse, uygulama listesi boşsa ya da `yaz`'da paket sayısı 1 değilse
   `gecersiz`.
3. Çekirdek yoksa `cekirdek_yok`.
4. Plandaki her paket listede `ACIK` olmalı: hassas ya da değişmez varsa `hassas`, yoksa `YENI` (kurulu değil) varsa
   `uygulama_listede_degil` (karışıksa `hassas` önce).
5. `ErisimAnahtari.ac`; sonuç `ACIK` değilse `erisim_acilamadi`.
6. Bekleme sırasında değişmiş olabilecek durum (çekirdek, tam yetki, liste) bir kez daha taze okunur.
7. `izinler.ekle(OnayliIzin(..., kaynak = OTO))`: süre, bütçe ve mod plandan, `OnayActivity`'nin önceden
   seçili varsayılanlarıyla (okuma 30 dk / 100, yazma 10 dk / 30); biyometri yok; `null` dönerse `gecersiz`.
   Bundan önce (6'dan sonra) aynı `plan_id` + `plan_hash` için etkin izin varsa yenisi doğmaz, mevcut
   `grant_id` ile `Verildi` döner (karta ikinci `otoIzin` gelse de süre/bütçe ikiye katlanmaz).
8. `Adaptor.oturumGuncelle?.izinEklendi(izin)`; sonra `ekran.anlik()` (işçi ipliğinde; erişilebilirlik IPC'si
   ana ipliği bloklamasın) aktif kök ve odak paketi plandaki bir pakete eşitse `EkranOkuyucu.pencereOlayi(paket)`
   ile son olay tohumlanır (servis yeni bağlandıysa ve kullanıcı zaten hedef uygulamadaysa pencere olayı
   gelmez). 7'den sonraki hatalar sonucu değiştirmez: `Verildi(grantId)`.

**Durdur ve tam yetki.** `DurdurAlici` önce `TamYetki.kapat`'ı çağırır (ilk adım; gecikme penceresinde
gelen otomatik izin servisi yeniden açamaz), sonra izinleri geri çeker, erişilebilirliği kapatır, servisi
durdurur. Köprü `otoIzin` tam yetki kapalıyken servisi hiç kaldırmadan `tam_yetki_kapali` ile hemen reddeder.
Tam yetkiyi yeniden açmak biyometrili `TamYetkiActivity` ister.

### Köprü yüzeyi ekleri (`ErenDevice.types.ts`)

- `CihazDurumu` + `erisim_yetkisi` (`WRITE_SECURE_SETTINGS` verildi), `kullanim_erisimi` (`GET_USAGE_STATS`
  app-op'u izinli), `tam_yetki`.
- `otoIzin(plan_json, plan_hash): Promise<OtoIzinSonucu>`; `OtoIzinSonucu = { sonuc: "verildi"; grant_id }`
  ya da `{ sonuc: "onay_gerekli"; neden: OtoIzinNedeni }`; `OtoIzinNedeni` = `tam_yetki_kapali` | `gecersiz` |
  `uygulama_listede_degil` | `hassas` | `erisim_acilamadi` | `cekirdek_yok`. Jeton burada da yoktur.
- `tamYetkiAc(): Promise<"acildi" | "iptal">` (yalnız biyometrili ekranı gösterir), `tamYetkiKapat():
  Promise<void>`.
- `kisayolAl(): Promise<KisayolMesaji | null>` (tüketmez), `kisayolTuket(id): Promise<void>`,
  `kisayolKutucuguEkle(): Promise<"eklendi" | "zaten" | "reddedildi" | "desteklenmiyor">` (Android 13+;
  altında `desteklenmiyor`). `KisayolMesaji { id; metin; paket: string | null; ad: string | null; zaman_ms }`.
- Olay `kisayolGeldi: { id }`. `sendEvent` yalnız hızlandırıcıdır; gerçeklik `kisayolAl()` ile çekilir.
- Değişmez: köprü `cmd`/`cmd_result`/`token` taşımaz (`grant_id` dönebilir, jeton asla).

### JS (`app/src/`)

- `cihaz/erenDevice.ts`: yukarıdaki işlevleri mevcut `Sonuc` sarmalıyla açar; ek olarak
  `kisayolGeldiDinle(f): () => void` (modül yoksa ya da hata olursa boş kapatıcı).
- `ekranlar/otoIzin.ts` (oto izin kancası: React'sız yürütücü `otoIzinKur`, kanca `useOtoIzin`). Kurallar:
  - Aday: bütün sohbetlerde `tur:"plan"`, `durum:"bekliyor"`, `plan.tur:"telefon"` kart; kararı zaten
    kuyrukta ya da hatalarda olan kart (kullanıcı ya da önceki süreç karar verdi; `izin_bekleniyor` dahil)
    aday değildir.
  - **Yalnız yeni öneri** (`oneriYeniMi`): kartın önerisi (`plan_proposed.ts_ms`, PC saati) en çok
    `OTO_IZIN_AZAMI_YAS_MS` (2 dk) eski olmalıdır. Zamanı bilinmeyen (sonlu pozitif sayı değil), telefon saatine
    göre `OTO_IZIN_SAAT_PAYI_MS`'ten (30 sn) fazla ileri tarihli ya da telefon saati okunamayan kart denenmez
    (bellekteki iz süreçle ölür; yeniden başlayan süreç eski, bilerek bekletilmiş kartı ayırt edemez).
  - **Kart başına tek deneme** (bellekte iz, anahtar `plan_id` + `plan_hash`).
  - **Yalnız bağlı ve eşitlenmişken** (`yuklendi && baglanti === "bagli" && !esitleniyor`): eksik olaylar
    gelirken "bekliyor" görünen kart aslında sonuçlanmış olabilir.
  - Tur başında `durum().tam_yetki` okunur; kapalıysa aday kartlar denenmeden kullanıcıya bırakılır ve
    sonradan tam yetki açılsa da yeniden değerlendirilmez. **Okunamazsa** (geçici hata) kart işaretlenmez:
    sonraki tetikte, hâlâ yeniyse yeniden değerlendirilir. Her kart köprü beklenirken yeniden doğrulanır
    (kullanıcı arada karar verdiyse atlanır).
  - **Ya otomatik ya elle:** kullanıcı karta elle karar vermeye başlayınca (`elleBasla`) kart otomatik
    denemeden kalıcı çıkar, elle başlatılan kart otomatik denenmez. Otomatik deneme sürerken (`deneniyor`)
    elle yol başlamaz (`elleBasla` `false`), kartta "Otomatik izin deneniyor." notu görünür ve düğmeler
    kapalıdır (`otoIzinKartGorunumu`: `satir`, `kilitli`).
  - `verildi` → o sohbetin `planKarari(plan_id, plan_hash, "onay")`; `onay_gerekli` → kart kullanıcıya kalır
    ("Telefonda izin iste" düğmesi aynen), neden kartta not. Ek notlar: `kopru_hatasi` (`otoIzin` düştü),
    `karar_gonderilemedi` (izin verildi ama `planKarari` kuyruğa giremedi; `zaten_yollandi` ve
    `plan_sonuclandi` not üretmez).
  - Çekirdek kart nesnesine yazılmaz: `App.tsx` yürütücüyü `OtoIzinBaglami` ile verir, `PlanKartiEkrani`
    `useOtoIzinNotu(kart)`/`useOtoIzinDeneniyor(kart)` ile okur ve `otoIzinKartGorunumu` ile küçük
    `metinIkincil` satırı olarak yazar. Sonuçlanmış (bekliyor olmayan) kartta not ve kilit yoktur.
- `ekranlar/kisayol.ts` (kısayol kancası: `kisayolKur`, `useKisayol`). Kurallar:
  - Tetik: `kisayolGeldi` olayı ve çekirdek ilk yüklendiğinde (uygulama açılışı; uygulama kapalıyken yuvada
    mesaj kalmış olabilir): `kisayolAl()` → mesaj varsa yolla → `kisayolTuket(id)`. Tek yürütme; çalışırken
    gelen tetik bir tur daha yaptırır. Aynı `id` iki kez yollanmaz (bellekte iz).
  - **"Telefon" sohbeti** (`TELEFON_SOHBET_ADI`): adı tam "Telefon" olan, kurulamamış olmayan ilk sohbet;
    yoksa `sohbetAc("Telefon")` ile açılır ve mesaj hemen yollanır (çekirdek bekleyen sohbetin mesajını
    kuyrukta `chat_create`'in ardına koyar). **8 sınırı** doluysa (yerelde ya da `sohbetAc` `sohbet_siniri`
    derse) `ana`. Kurulamamış sohbetler sayılmaz.
  - **Seçim korunur:** `sohbetAc` yeni sohbeti seçer; arada kullanıcı başka seçim yapmadıysa önceki seçim
    geri verilir (kullanıcı başka uygulamadan söyledi, baktığı sohbet kalır).
  - Bağlam yalnız `paket` ve `ad` ikisi de varken ve `KisayolBaglami` şemasından geçerse verilir. **Çekirdek
    yine de `gecersiz` derse mesaj bir kez bağlamsız yeniden gönderilir** (mesaj kaybolmasın). Bağlamsız da
    `gecersiz` olan mesaj tüketilir (hiç gidemez, yuvayı tutmasın).
  - Tüketme koşulu `kisayolTuketilirMi`: yollandı (`ok`) ya da `gecersiz`. Geçici hatada (depo, `baslamadi`)
    yuvada kalır; sonraki olay ya da açılış yeniden dener. Hedef arada kurulamadı ya da silindiyse
    (`sohbet_bulunamadi`) hedef bir kez yeniden bulunur. Modül yoksa (`desteklenir` değil) hiçbir şey yapmaz.
  - **Geçici hatada yeniden deneme:** yuvada kalan mesaj için zamanlayıcı üstel aralıkla (`KISAYOL_ILK_ARALIK_MS`
    5 sn'den `KISAYOL_EN_COK_ARALIK_MS` 60 sn'ye) yeniden dener; bağlantı bağlanınca ya da eşitleme bitince
    hemen dener. Gönderilip tüketilene ya da kalıcı hataya (`gecersiz`) dek sürer; kanca kapanınca zamanlayıcı
    temizlenir.
- `ekranlar/KurulumEkrani.tsx`: **"Tam yetki"** bölümü: satır "Tam yetki" (`Açık` `uyari` renginde / `Kapalı` /
  `Bilinmiyor`), açıklama "Açıkken {ad} telefonda onay sormadan okur, yazar, gönderir. Banka/hassas
  uygulamalar, Ayarlar ve parola alanları yine yasak; kalıcı bildirimdeki Durdur her şeyi keser."; düğme
  Aç (`tamYetkiAc`) ya da Kapat (`tamYetkiKapat`); sonuç notu ("Tam yetki açıldı." / "... açılmadı (iptal
  edildi)." / "... kapatıldı."). **"Telefon ayarları"** bölümünde: "Erişilebilirlik servisi" satırı
  (`erisim_yetkisi` varsa "Hazır (iş varken açılır)", yoksa servis elle açıksa "Elle açık", değilse "Kurulum
  adımı eksik" + PC'de `node kurulum/telefon.ts` açıklaması; "Hazır"da Aç düğmesi yok), "Kullanım erişimi"
  satırı (`kullanim_erisimi`: "Hazır" / "Kurulum adımı eksik"; yalnız gösterir) ve "Hızlı Ayarlar'a kutucuk ekle"
  düğmesi (`kisayolKutucuguEkle`; `desteklenmiyor`'da elle ekleme tarifi yazılır).
- `ekranlar/Balonlar.tsx`: kısayoldan gelen kullanıcı balonunun üstünde **çip** (`KisayolCipi`). Koşul girdi
  yolu `input === "kisayol"`'dur (bağlamsız da çip çizilir): `user_echo.baglam` varsa "Kısayol · <ad>", yoksa "Kısayol". `ad` güvenilmez metindir: kontrol karakterleri boşluğa çevrilir,
  40 karaktere kısaltılır, tek satır, düz metin (bağlantı değil); erişilebilirlik etiketi "Kısayoldan, <ad>
  açıkken".

### Yapısal sınırlar ve test

Değişmezler "Köprü API ve yapısal sınırlar" tablosunda (1, 5 ve 6 Dilim 3'ün). Tarayan dosya
`app/test/yapisal.test.ts`. Dilim 3 testleri: `app/test/ekranlar/otoIzin.test.ts`,
`app/test/ekranlar/kisayol.test.ts`, `app/test/cekirdek/outbox.test.ts` (v3 → v4), `index.test.ts`,
`olaylar.test.ts`, `baglanti.test.ts`; çekirdekte `IzinlerTest`, `DenetimKaydiTest`, `SemaTest`
(`grantIssued` kaynağı kabloya taşımaz). Cihazsız doğrulanamayanlar (Doğrulama ayrımı geçerli):
`ErisimAnahtari` ile servisin gerçekten açılıp kapanması, üretici arayüzlerinde kutucuk ve `startActivityAndCollapse`,
`UsageStats` ön plan tespiti, biyometri.

## Tüketim: token tüketimi gösterimi

Telefon, PC servisinden token tüketim raporunu ister ve Durum ekranı ile iş rapor kartında gösterir. Dilim 2'deki
"değişmeyenler" listesinde geçen `RaporKartiEkrani.tsx` bu özellikle değişti: kartın altına tek satır tüketim
eklendi (aşağıda).

### Çekirdek (`app/src/cekirdek/`)

- **`sozlesme.ts`:** `TuketimRaporu` (`usage_report`'tan `v`, `type`, `istek_id` çıkarılmış gövde), `TuketimDurumu`
  (`yok` | `bekleniyor` | `hazir` | `hata`; `bekleniyor`/`hata`'da eldeki son rapor da taşınır, `hazir` ayrıca
  `alindiMs` taşır), `CekirdekDurumu.tuketim`, `Cekirdek.tuketimIste()`.
- **`tuketim.ts` (yeni):** istek-yanıt durum makinesi (`tuketimKur`). Tek bekleyen istek (`tuketim-N`); zaman aşımı
  15 sn (`TUKETIM_ZAMAN_ASIMI_MS`) sonra `hata`; son rapor 10 sn (`TUKETIM_TAZE_MS`) içindeyse `iste()` yeni istek
  yollamaz; `iste(zorla)` tazelik kuralını atlar ama bekleyen varken yine yollamaz. `rapor` yalnız bekleyen
  `istek_id` ile eşleşeni kabul eder. `koptu()` bekleyeni düşürür (zamanlayıcı iptal, `hata` temizlenir); eldeki
  rapor `hazir` kalır. Ağdan okunan değer yok, kalıcı depo yok (yalnız bellek).
- **`baglanti.ts`:** `sorguGonder(UsageRequest)` yalnız `bagli` aşamada gönderir; `client_msg_id` yok, ack yok,
  outbox'a girmez, yazma hatasında bağlantı normal biçimde kapanır ve `false` döner.
- **`index.ts`:** kimlik tamamlanınca bir `tuketim.iste()`; canlı `job_finished` (`seq > canliEsikSeq`) 3 sn
  (`IS_BITTI_TUKETIM_MS`) sonra zorlamalı tek istek planlar (arada biten işler aynı isteğe birleşir); `usage_report`
  modüle gider; bağlantı kopunca `tuketim.koptu()` ve iş-bitti zamanlayıcısı iptal edilir. Ekran `tuketimIste()`
  ile (zorlamasız) ister.

### Ekranlar (`app/src/ekranlar/`)

- **`tuketimMetni.ts` (yeni, saf):** `tokenKisalt`, `maliyetMetni`, `toplamToken` (girdi + cache yazma + cache okuma
  + çıktı), `isTuketimi(rapor, is_id)`. `Intl` kullanılmaz (Hermes), ondalık ayırıcı virgül.
- **`DurumEkrani.tsx`:** ekran açılınca bir `tuketimIste()`. "Tüketim" bölümü: Bugün / Son 7 gün x sohbet / iş
  satırları (değer + dört sayaçlı alt satır), "Sohbet başına" (sohbet + iş toplamı; adı bilinmeyen `sohbet_id`
  ham yazılır) ve varsa "Silinmiş sohbetler"; hata durumunda eldeki rapor üstünde uyarı şeridi "Güncellenemedi; son
  bilinen değerler."; rapor yokken tek metin: `yok` "Henüz ölçüm yok.", `bekleniyor` "Yükleniyor…", `hata`
  "Tüketim alınamadı."; en altta nominal maliyet notu (liste fiyatı, abonelikte ayrıca ödenmez).
- **`RaporKartiEkrani.tsx` / `Balonlar.tsx` / `SohbetEkrani.tsx`:** kartın altında tek küçük satır "Tüketim: ≈ $0,11 ·
  1,2 Mn token" (maliyet yoksa yalnız token). `SohbetEkrani` eldeki raporu `Balonlar` üzerinden `tuketim` prop'u
  olarak geçirir; kart çekirdeğe abone olmaz. İşin raporda kaydı yoksa satır görünmez.

### Metin biçimi

`tokenKisalt`: 850 -> "850", 12.345 -> "12,3 bin", 1.240.000 -> "1,24 Mn" (yuvarlama üst birime taşarsa üst birim).
`maliyetMetni`: yok -> `null`; 0 -> "$0"; 0 < x < 0,01 -> "< $0,01"; aksi "≈ $2,34".

### Bilinen eksikler / cihazda bakılacaklar

Gerçek cihazda henüz görülmedi: uzun değerlerde satır sarması, dört sayaçlı alt satırın dar ekranda kırılması,
büyük yazı boyutu.

## 0.6.0: sesli cevap ve canlı etkinlik

İki özellik de kablo sürümünü artırmaz (`SOHBET_SURUMU` 5 kalır). Sesli cevap yalnız telefondadır; canlı etkinlik servis çerçevesine (`assistant_activity`, `protocol/README.md` "Etkinlik çerçevesi") dayanır. Uygulama sürümü 0.6.0, `versionCode` 9.

### Sesli cevap

Kullanıcı sesle (dikte düğmesi ya da kısayol) mesaj gönderdiyse asistanın cevabı Android'in `TextToSpeech` motoruyla, `tr-TR` ile okunur. Yazıyla gönderilen mesajın cevabı ve geçmiş okunmaz. Yeni izin ve bağımlılık yok; manifestte yalnız motor servisine bağlanmak için `TTS_SERVICE` sorgusu (`<queries>`) eklendi.

- **Kotlin çekirdeği:** `SesParcalari.kt` (saf; uzun metni motorun tek istek sınırına göre cümle sınırlarından böler, UTF-16 vekil çiftini bölmez). Test: `SesParcalariTest.kt`.
- **Android adaptörü:** `Seslendirici.kt`: tek `eren-ses` ipliği; ilk parça `QUEUE_FLUSH`, ötekiler `QUEUE_ADD`; kabul edilen her okuma için tam bir `true`, sonra tam bir `false` bildirimi; müzik kısılır (`AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK`), odak kaybında (arama, dikte tanıyıcısı) okuma kesilir. Dikteden önce okuma kesilir (köprü `dikte` kendi örneğinin `durdur`'unu, `KisayolActivity` `Seslendirici.etkiniDurdur()`'u çağırır): asistan kendi sesini dinlemesin.
- **Modül yüzü** (`ErenDevice.types.ts`): `seslendir(metin, dil): Promise<boolean>` (okumanın bitmesi beklenmez; motor yok, dil yok, boş metin ya da başlatılamadıysa `false`, reddetmez), `seslendirmeyiDurdur(): Promise<void>`, olay `seslendirmeDurumu{konusuyor}`. JS geçidi: `erenDevice.ts` `ErenCihaz.sesPortu()` (dil `tr-TR`).
- **Çekirdek (`app/src/cekirdek/`):**
  - `SesPortu` (`sozlesme.ts`): `seslendir(metin)`, `durdur()`, `durumDinle(f)`; `cekirdekKur` bağımlılığında isteğe bağlı `ses`: verilmezse çekirdek hiçbir şey okumaz.
  - `konusmaMetni.ts` (saf): Markdown cevabı okunacak düz metne çevirir (kod bloğu yerine "kod bloğu" der, bağlantı adresi "bağlantı" olur; içeriği tek başına bir adres olan satır içi kod ve `<http(s)://…>` da "bağlantı" olur; başlık/liste/vurgu işaretleri ve tablo çizgileri atılır).
  - `sesliYanit.ts` (saf durum makinesi, port/saat/zamanlayıcı yok): hangi cevabın okunacağına karar verir. Bağ servisten açıkça gelir: `assistant_activity.kaynak_msg_id` turu başlatan insan mesajının `client_msg_id`'sidir (servis/sentetik turda alan yoktur). Yüz: `sesliGonderildi(client_msg_id)` (bu cihaz bu çalışmada sesle gönderdi), `unut(client_msg_id)` (reddedildi), `turKaynagi(turn_id, kaynak_msg_id)`, `olay(o)`, `sifirla()`. Üç küme birbirinden ve çağrı sırasından bağımsız dolar: `sesliler`, `kaynaklar` (`turn_id` → kaynak), `bitenler`. Karar yalnız `assistant_message` anında verilir: turun bildirilmiş kaynağı `sesliler`'de ise metin okunur; `turn_aborted` okutmaz; aynı cevap ikinci kez dönmez. Çerçeve sırası, `server_status` ya da yankı tahmini kullanılmaz. Bellek sınırları `SESLI_YANIT_SINIRLARI` (sesli 32, kaynak 64, biten 64). Bilinen sınırlar (hepsi okumama yönünde): (1) yeni servis gerekir; etkinlik çerçevesi göndermeyen eski serviste hiçbir şey okunmaz; (2) tur tamamen bağlantı kopukken başlayıp bittiyse kaynak bilinmez, cevap okunmaz (yanlış okumaktansa okumamak); (3) servis yeniden başladığında önceki ömürden kuyrukta kalmış mesajın turu kaynak taşımaz ve okunmaz. Sentetik tur, yazıyla gönderilen ve başka cihazın mesajı hiçbir sırayla okunmaz (`docs/GUVENLIK.md` 34).
  - `seslendirici.ts`: port sarmalayıcısı (`oku`, `durdur`, `konusuyor`); metni `konusmaMetni`'yle çevirir, portun hatasını yutar, iki okuma isteği iç içe girmez.
  - `index.ts`: gönderim `ok` ise önce süren okuma kesilir, giriş yolu `dikte` ya da `kisayol` ise mesaj sesli işaretlenir; reddedilen (`ack ok:false`) mesaj unutulur; yerel geçmiş sıfırlanınca sesli kayıtlar silinir. Dışarı açılanlar: `CekirdekDurumu.seslendiriyor` ve `Cekirdek.sustur()`.
- **Ekran (`SohbetEkrani.tsx`):** okuma sürerken (`seslendiriyor === true`) giriş çubuğunun üstünde tek satır "Sesli okunuyor" + "Sustur" düğmesi; okuma sohbete değil çekirdeğe bağlıdır. Yeni mesaj, dikte/kısayol tanıyıcısının açılması ve "Sustur" okumayı keser (tanıyıcı açılmadan `cekirdek.sustur()` çağrılır; yerel taraf da keser).
- **Testler:** `konusmaMetni.test.ts`, `sesliYanit.test.ts`, `seslendirici.test.ts`, `sesliCevapBaglama.test.ts`.

### Etkinlik gösterimi

Tur sürerken "yazıyor" yerine asistanın o anki işi görünür. Telefon `/sohbet` adresine `?yetenek=etkinlik1` ekler (`baglanti.ts` `sohbetAdresi`); eski serviste çerçeve hiç gelmez ve ekran bugünkü gibi çalışır.

- **Çekirdek:** `etkinlik.ts` deposu (`etkinlikKur`): `assistant_activity` gelince `{turn_id, etkinlik, baslangic_ms}` tutar (`kaynak_msg_id` varsa `index.ts` onu `sesliYanit.turKaynagi`'na geçirir, sohbet denetiminden önce); `assistant_activity_end{sohbet_id, turn_id}` gelince `bitti(turn_id)` etkinliği siler (servis turu hangi nedenle kapatırsa kapatsın gönderir; bitiş olayından önce de sonra da gelebilir); `baslangic_ms` telefonun saatiyle, `simdiMs - gecen_ms` olarak kurulur (servis saati ile telefon saati karşılaştırılmaz). Kalıcı değildir: diske yazılmaz, `seq`'e ve sesli yanıta dokunmaz. Turu bitiren kalıcı olay (`assistant_message`, `turn_aborted`) de durumu siler; ikisinden hangisi önce gelirse gelsin o `turn_id`'nin geç gelen çerçevesi durumu diriltmez (64 tur hafızası); bağlantı kopunca durum atılır; silinmiş sohbetin çerçevesi yok sayılır. `SohbetDurumu.etkinlik` bu durumu ekrana verir.
- **Metin (`ekranlar/etkinlikMetni.ts`, saf):** etiketler: `dusunuyor` "düşünüyor", `yaziyor` "yazıyor", `komut` "komut çalıştırıyor", `dosya_okuma` "dosyalara bakıyor", `dosya_yazma` "dosya düzenliyor", `web` "internette arıyor", `plan` "iş başlatıyor", `is_bilgisi` "işlere bakıyor", `ekran` "bilgisayarı kullanıyor", `arac` "araç kullanıyor". **Sayaç:** süre eki 5 sn'den sonra gelir ("komut çalıştırıyor · 42 sn", dakikadan sonra "· 1 dk 5 sn"); `yaziyor` süre taşımaz.
- **Karar (`baglantiDurumu.ts`, saf):** `gorunenEtkinlik` tur sürüyorsa (akış var ya da `eren === "tur_suruyor"`) ve etkinlik süren akışın turuna aitse (akış yoksa her tura) etkinliği verir, yoksa `null` (ekran bugünkü halinde kalır). `etkinlikSayaciGerekli` yalnız süreli bir etkinlik gösterilirken doğrudur. `etkinlikEtiketiHesapla`: görünen metin büyük harfle başlar ve süre taşır; erişim etiketi süresizdir (her saniye duyurulmasın) ve asistan adını taşır.
- **Üst çubuk:** `altBaslikHesapla` tur sürerken "{ad} yazıyor" yerine "{ad} komut çalıştırıyor · 42 sn" gibi yazar.
- **Akış balonu (`Balonlar.tsx` `AkisBalonu`):** `etkinlik` verilirse "Yazıyor" etiketinin yerine etkinlik metni; `YaziyorGostergesi` ekran okuyucu etiketini bundan alır.
- **Metinsiz balon (`SohbetEkrani.tsx`):** metin gelmeden önce de gösterilecek bir etkinlik varsa metinsiz akış balonu çizilir: üç nokta + etiket + "Turu kes". Akış yokken "Turu kes" turu etkinlikten alır (`sohbet.kes(tur)`).
- **Sayaç (`SohbetEkrani.tsx` `useSaniyeSaati`):** saniyelik saat yalnız süreli etkinlik gösterilirken ve uygulama ön plandayken çalışır; tur bitince ya da ekran kapanınca durur. Saat kaynağı `Date.now()`'dır (çekirdeğin saat portuyla aynı).
- **Testler:** `etkinlik.test.ts`, `etkinlikMetni.test.ts`, `baglantiDurumu.test.ts`, `baglanti.test.ts`, `index.test.ts`.
