# Ajanda: ortak sözleşme

Ayrı bir Android uygulaması (ajanda) görev, randevu ve notları gösterir; asıl kayıt PC'dedir, `eren-servis` tek yazardır. Kayıtlar ilk dilimde iki yoldan doğar: telefondaki sohbetin ana oturumunun aracı ve uygulamadan elle ekleme. Şemaların tek kaynağı `protocol/src/ajanda.ts` (kayıt, işlem, `/ajanda` çerçeveleri, kapsam), `ajanda-zaman.ts` (zaman, hatırlatma, tekrar), `ajanda-arac.ts` (araçlar, ajanda borusu), `ajanda-metin.ts` (modele giden metin); sınırlar `sinirlar.ts` `AJANDA_SINIRLARI`, `AJANDA_AZAMI_CERCEVE`; dil bağımsız vektörler `protocol/vektorler/ajanda-mesaj.json`, `ajanda-kurallar.json`. Bu belge kod içermez.

## Kararlar

- **Mevcut baytlar değişmez.** `PROTOKOL_SURUMU` (1), `SOHBET_SURUMU` (5), `HATA_KODLARI`, `eren-auth-v1` imza metni, `Kanal`, mevcut boru (`KOPRU_BORU_ADI`, `KOPRU_ROLLERI`, `ROL_FIILLERI`) aynen kalır; kurulu APK yeniden derlenmeden çalışır. Ajandanın kendi sürüm sabiti vardır: `AJANDA_SURUMU` = 1. Kural README "Sürümleme" ile aynı: alan, mesaj, kapalı liste öğesi eklemek ya da sınır değiştirmek artıştır.
- **Kayıt eylemsiz veridir.** URL, intent, komut alanı yoktur (katı şema fazla alanı reddeder). Tek satırlık metinlerde satır sonu ve sekme; bütün metinlerde kontrol, sıfır genişlik ve yön karakterleri (`gorunmezBirimMi`: C0/C1, U+00AD, U+061C, U+200B-200F, U+2028-202E, U+2060-206F, U+FEFF) ve eşsiz vekil reddedilir. Uygulama metni düz gösterir, bağlantıya çevirmez; girişte bu karakterleri temizler (ZWJ'li emoji dahil). Ana oturuma geri okunurken kayıt metni `kacir` ile tek satırda tırnak içinde kalır ve liste gövdesi çağrıya özel çitle (`citleSar`) sarılır.
- **Hata kümesi ayrıdır.** `/ajanda` el sıkışma hataları `HATA_KODLARI`'nın v1 altkümesidir (`AJANDA_KANAL_HATALARI`); işlem retleri ayrı kapalı listededir (`AJANDA_RET_NEDENLERI`), `HATA_KODLARI`'na girmez.
- **Ajanda borusu ayrıdır.** Mevcut testler `ROL_FIILLERI.eren` ve `KOPRU_ROLLERI`'ni birebir sabitler; omurgadaki "köprünün `eren` rolüne fiil ekle" bunu kırardı. Ajanda kendi borusunda (`AJANDA_BORU_ADI` = `\\.\pipe\eren-ajanda`), kendi rolüyle (`ana_oturum`) konuşur; zarf aynıdır (`kopru_hello`, `istek`, `iptal`, `kopru_welcome`, `kopru_ret`, `yanit`, `v` = 1).

## Kapsam ve eşleştirme

- `CIHAZ_KAPSAMLARI` = `sohbet` | `ajanda`. Kapsamı telefon beyan etmez (`pair_request` kapsam alanı taşıyamaz): PC'deki eşleştirme komutu açtığı pencereye yazar (ör. `eren eslestir --ajanda`), eşleşen cihaz kaydına geçer. Kapsam sütunu olmayan eski kayıt `ESKI_CIHAZ_KAPSAMI` = `sohbet`.
- `KAPSAM_KANALLARI`: `sohbet` → `/sohbet`, `/cihaz`; `ajanda` → `/ajanda`. Kesişmez. Gateway `hello`'da cihaz kaydını taze okur; `kanalKapsamdaMi(kayit.kapsam, kanal)` yanlışsa `kanal_desteklenmiyor` + kapat (bugünkü iPad-`/cihaz` dalı gibi, sınama başlamadan). Böylece ajanda cihazı `/sohbet`'ten insan mesajı gönderemez, eski cihaz `/ajanda` açamaz.
- Eşleştirme kapsamın kanalında yapılır (`KAPSAM_ESLESTIRME_KANALI`). Açık pencerenin kapsamı bağlantının kanalınınki değilse `eslestirme_kapali` (pencerenin varlığı sızdırılmaz). Dikkat: ajanda `pair_request`'i `/sohbet`'in v1 `PairRequest` şemasına da uyar; ayrımı şema değil bu pencere denetimi yapar (testle sabit). `pair_result` `kapsam:"ajanda"` taşır. QR: `AjandaEslestirmeQr` (`EslestirmeQr` + `kanal:"ajanda"`); iki uygulama birbirinin QR'ını reddeder.
- Kimlik: `ajandaKimlikImzaMetni` = `eren-ajanda-auth-v1`, rol, `kanal:ajanda`, `kapsam:ajanda`, `device_id`, iki nonce (satır sonuyla). Önek ve satırlar farklı olduğu için ajanda imzası `/sohbet` ya da `/cihaz` imzası yerine geçemez. IP eşleşmesi, 10 sn süre, kimlik öncesi 16 KiB sınırı, PC'nin kendi adresinden eşleştirme reddi ve kaldırma (`--kaldir`) bugünkü gibidir.

## Kanal akışı (`/ajanda`, `AJANDA_SURUMU`)

1. Eşleşme yoksa `pair_request` → `pair_result`; bağlantı açık kalır.
2. `hello{device_id, son_rev, depo_id?, client_nonce}` → `auth_challenge` → `auth_response` → `welcome{depo_id, bas_rev, tam, server_time_ms}`.
3. Telafi: `tam` doğruysa (depo kimliği yok ya da farklı, ya da `son_rev > bas_rev`) uygulama yerel kopyasını atar ve 0'dan her şey gelir (mezar taşları dahil); değilse revizyonu `son_rev`'ten büyük kayıtlar. Her kayıt bir `kayit{kayit}` çerçevesidir (son hali; ara haller gelmez), revizyon kesin artan sırayla. Sonda `esitlendi{rev}`; sonrası canlıdır. Servis bağlantı başına son gönderdiği revizyonu tutar, telafi sürerken doğan değişikliği sıraya alır, aynı revizyonu iki kez yollamaz.
4. Uygulama bir `kayit`'i yalnız gelen revizyon yereldekinden büyükse uygular ve `son_rev`'i her çerçevede ilerletir (kopma ortada olsa da sürdürülebilir).
5. İşlem: `islem{islem_id, islem}` → `islem_sonucu{islem_id, ok, kayit_id?, rev?, code?}`. İşlemler: `ekle` (kimliği uygulama üretir), `guncelle` (kısmi; `null` alanı kaldırır; `temel_revizyon` bilgi içindir), `durum` (`ornek_tarihi` ile tek örnek), `onayla` (taslağı kesinleştirir), `sil` (mezar taşı), `geri_yukle`. Uygulama işlemi önce yerelde iyimser uygular ve kalıcı kuyruğa koyar; bağlanınca sırayla yollar. Servis `(device_id, islem_id)` ile tekrarsızdır: aynı kimlik aynı sonucu alır, ikinci kez uygulanmaz. `ok:false` yeniden yollanmaz, iyimser değişiklik geri alınır. `kayit` ile `islem_sonucu` arasında sıra garanti edilmez; gerçek `kayit`'tir. Her başarılı değişiklik tam bir kaydın revizyonunu tek artan sayaçtan artırır ve geçmişe bir satır yazar. Aynı değer, zaten silinmiş kayda `sil` gibi yan etkisiz işlemlerde `ok`, `rev` yok.
6. Geçmiş: `gecmis_iste{istek_id, kayit_id, once_rev?}` → `gecmis{girdiler (en çok GECMIS_SAYFA, rev azalan), devami}`. Her girdi yazarı (`yol`, `tur_kokeni`), değişen alanların öncesi ve sonrasını (`AjandaParca`) taşır.

## Çakışma ve otomasyon kuralları

- **Tek yazar, varış sırası.** Bütün değişiklikler serviste tek modülden ve tek işlem sırasıyla geçer. İki insan düzenlemesinde PC'ye son varan kazanır (alan alan; reddetme yok).
- **Alan izi.** İnsan yolunda (`INSAN_YOLLARI`: `elle`, `sesli_not`) değişen alanlar `elle_alanlar`'a girer ve çıkmaz. Otomasyon (araç ve arka plan, insan turunda bile) bu alanları değiştiremez: alan atlanır, `korunan_alanlar` ile bildirilir, model kullanıcıya uygulamadan değiştirmesini söyler. Birleştirme `ajandaDegisikligiUygula`'dır; sonuç `AjandaKaydi` ile doğrulanır, bozulursa işlem `tutarsiz_kayit`.
- **Silme otomasyonu yener.** Mezar taşına `geri_yukle` dışında her işlem `kayit_silinmis`. Modelin silme fiili yoktur.
- **Sentetik tur.** İnsan kökenli olmayan turdan gelen ekleme `taslak:true` doğar; sentetik turdan taslak olmayan kayda değişiklik `sentetik_turda_izinsiz`. Tur kökenini servis belirler (turu doğrulanmış `/sohbet` insan mesajı mı başlattı), araç girdisinde yoktur.
- **Tekilleştirme.** Servis otomatik eklemede `ajandaTekilAnahtari({kapsam:"sohbet:<id>", tur, baslik, zaman})` hesaplar; silinmemiş eşi varsa `zaten_var`.

## Zaman ve hatırlatma

- Zaman yerel duvar saati + IANA dilimidir. `kesinlik`: `an` (gün+saat, isteğe bağlı `sure_dk`), `gun` (saat yok), `donem` (gün aralığı), `belirsiz` (yalnız ifade). Söylenmeyen saat ya da gün uydurulmaz; kullanıcının ifadesi `ifade`'de birebir durur. Dilim adının varlığını servis denetler (`saat_dilimi_bilinmiyor`).
- Hatırlatma: `once{dk}` olayın anından (duvar saati, dilimiyle ana çevrilmiş) `dk` dakika önce, yalnız `an`'da; `mutlak{tarih, saat, saat_dilimi}` bir kez. Duvar saatinden ana çeviri java.time `ZonedDateTime.of` varsayılanıdır: yaz saati boşluğunda boşluk kadar ileri, çakışmada önceki ofset.
- Hatırlatmayı uygulama, PC'den bağımsız, kendi kopyasından kurar; yalnız `hatirlatmaEtkinMi` (taslak değil, silinmemiş, `acik`) iken; tekrar eden kayıtta `ornekler`'de `tamam`/`iptal` olan örnek atlanır. Araç girdisinde `hatirlatmalar` yoksa ve zaman `an` ise servis `AJANDA_VARSAYILAN_HATIRLATMALAR`'ı (1 saat önce) koyar; `[]` hiç kurmaz.

## Araç yolu (ilk dilim)

- Konuşma modülü sohbetin ana oturumuna `eren` köprüsünün yanında ajanda borusuna bağlanan bir köprü ve `ana_oturum` jetonu verir (kapsam: `sohbet_id` + nesil; aynı MCP sunucusuna ikinci jetonla ya da ayrı sunucu olarak). Fiiller `ajanda_ekle`, `ajanda_guncelle`, `ajanda_listele`; girdi/çıktı `AJANDA_ARACLARI`. Model kimlik, kaynak, taslak, tekrar veremez. Kaynak izini servis kurar: `yol:"sohbet_araci"`, `sohbet_id`, `tur_kokeni`, insan turunda `kaynak_msg_id`; `alinti` yalnız turun insan mesajında birebir geçiyorsa saklanır.
- Model metni: `ajandaListesiMetni(cit, cikti)` (çit köprüde her çağrıda üretilir, gövdede geçerse yeniden), `ajandaEkleMetni`, `ajandaGuncelleMetni`. Kayıt metni modele yalnız kaçışlı ve listede çitli gider; ekleme ve güncelleme metni kayıt metni taşımaz.
- Kabul senaryosu: "yarın 3'te dişçi" → `ajanda_ekle{tur:randevu, zaman:{an, yarın, 15:00, ifade}}` → `kayit` çerçevesi → uygulama gösterir ve 14:00 hatırlatmasını kurar → PC kapanır, hatırlatma çalar; elle ekleme, `durum:tamam` ve `durum:acik` (geri alma) uygulamadan.

## Bağlanma noktaları

- **Sunucu ajanda modülü:** `AjandaKaydi`, `AjandaIslem`, `AjandaDegisiklik`, `AjandaGecmisGirdisi`, `AjandaParca`, `AjandaYazar`, `AjandaKaynagi`, `ajandaDegisikligiUygula`, `ajandaTekilAnahtari`, `otomasyonMu`, `AJANDA_RET_NEDENLERI`, `AJANDA_SINIRLARI` (`KAYIT_ADET`, `ORNEK_ADET`, `GECMIS_SAYFA`), `AJANDA_VARSAYILAN_HATIRLATMALAR`.
- **Gateway ve eşleştirme:** `/ajanda` yolu, `ajandaYukariCoz`/`ajandaAsagiCoz`, `AjandaYukari`/`AjandaAsagi`, `ajandaKimlikImzaMetni`, `CihazKapsami`, `KAPSAM_KANALLARI`, `kanalKapsamdaMi`, `KAPSAM_ESLESTIRME_KANALI`, `ESKI_CIHAZ_KAPSAMI`, `AjandaEslestirmeQr`, `AJANDA_KANAL_HATALARI`, `AJANDA_AZAMI_CERCEVE.KANAL`. Depoya: `cihazlar.kapsam`, `eslestirme.kapsam` (ek göç).
- **Köprü:** `AJANDA_BORU_ADI`, `AjandaKopruRolu`, `AJANDA_ROL_FIILLERI`, `ajandaFiilRoldeIzinliMi`, `AJANDA_ARACLARI`, `ajandaKopruYukariCoz`/`ajandaKopruAsagiCoz`, `jsonSemasi`, `ajandaListesiMetni`, `ajandaEkleMetni`, `ajandaGuncelleMetni`.
- **Uygulama:** kanal şemaları ve vektörler, `hatirlatmaEtkinMi`, `ajandaDegisikligiUygula` (iyimser uygulama), `INSAN_YOLLARI`, zaman şemaları.

## Sonraya bırakılanlar

- PC'deki normal Claude Code oturumları için köprü rolü (`pc_araci` yolu ve `oturum_id` şimdiden şemada; rol listeye o dilimde eklenir).
- Yalnız insan mesajlarından araçsız arka plan çıkarımı, gölge modda (`arka_plan` yolu şemada).
- Çevrimdışı sesli hızlı not (`girdi_yolu:"sesli_not"` şemada).
- Tekrar arayüzü ve tekrar üretimi: `Tekrar` ve `ornekler` kabloda kabul edilir ama ilk dilimde üreten yoktur (araç girdisinde `tekrar` yok); örnek açma kuralı RFC 5545 altkümesidir (aylıkta olmayan gün atlanır). Üretici gelmeden uygulama tekrar hatırlatmasını desteklemelidir.
- Örnek başına zaman değişikliği (taşınan örnek), ek kanal yetenekleri (`?yetenek=`), iOS.

## Kalan açıklar

- İnsan turunda model, aynı turda okuduğu güvenilmez metne (web, ekran, rapor) dayanarak kayıt ekleyebilir; kayıt taslak olmaz. Etki eylemsiz bir kayıt ve yanlış bir hatırlatmadır; kaynak izi ve geçmiş bunu gösterir.
- Kullanıcı bir alanı uygulamadan bir kez değiştirdiyse sohbetten ("dişçiyi 4'e al") o alanı değiştiremez; bu bilinçli seçimdir (model bunu söyler).
