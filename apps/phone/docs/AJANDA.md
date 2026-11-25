# Ajanda: ortak sözleşme

Ayrı bir Android uygulaması (ajanda) görev, randevu ve notları gösterir; asıl kayıt PC'dedir, `eren-servis` tek yazardır. Kayıtlar ilk dilimde iki yoldan doğar: telefondaki sohbetin ana oturumunun aracı ve uygulamadan elle ekleme. Şemaların tek kaynağı `protocol/src/ajanda.ts` (kayıt, işlem, `/ajanda` çerçeveleri, kapsam), `ajanda-zaman.ts` (metin, zaman, hatırlatma, tekrar), `ajanda-kural.ts` (servis ve uygulamanın aynı vermesi gereken kararlar), `ajanda-arac.ts` (araçlar, ajanda borusu), `ajanda-metin.ts` (modele giden metin); sınırlar `sinirlar.ts` `AJANDA_SINIRLARI`, `AJANDA_AZAMI_CERCEVE`; dil bağımsız vektörler `protocol/vektorler/ajanda-mesaj.json`, `ajanda-kurallar.json`. Kimin neyi yapacağı tek yerde: "Ekiplerin gereksinimleri". Bu belge kod içermez.

## Kararlar

- **Mevcut baytlar değişmez.** `PROTOKOL_SURUMU` (1), `SOHBET_SURUMU` (5), `HATA_KODLARI`, `eren-auth-v1` imza metni, `Kanal`, mevcut boru (`KOPRU_BORU_ADI`, `KOPRU_ROLLERI`, `ROL_FIILLERI`) aynen kalır; kurulu APK yeniden derlenmeden çalışır. Ajandanın kendi sürüm sabiti vardır: `AJANDA_SURUMU` = 1. Kural README "Sürümleme" ile aynı: alan, mesaj, kapalı liste öğesi eklemek ya da sınır değiştirmek artıştır.
- **Kayıt eylemsiz veridir.** URL, intent, komut alanı yoktur (katı şema fazla alanı reddeder). Tek satırlık metinlerde satır sonu ve sekme yoktur. Bütün metinlerde `AJANDA_GORUNMEZ_ARALIKLARI` (kod noktasıyla: kontrol karakterleri, Unicode `Default_Ignorable_Code_Point` kümesinin tamamı, satır ayırıcıları, U+FFF9-FFFB, U+13430-1343F) ve eşsiz vekil reddedilir. Tek istisna gündelik emojinin parçası olan `AJANDA_EMOJI_BIRLESTIRICILERI`'dir ve yalnız bağlamında (`ajandaGorunmezVarMi`): sunum seçicisi (U+FE0E, U+FE0F) bir taban karakterin (tabloda değil, boşluk değil) hemen ardından, birleştirici (U+200D) taban ya da U+FE0F ile taban arasında. Zincir, baş, son ve boşluk yanı yoktur; öteki değişken seçiciler (U+FE00-FE0D, U+E0100-E01EF) ve etiketler bayt kaçırma yolu oldukları için hiçbir bağlamda yoktur. Tablo kapalıdır ve vektörde birebir durur.
- **Kayıt metni modele yalnız kaçışlı ve çitli gider.** `ajandaKacir` metni tek satırda tırnak içinde tutar ve tablodaki her kod noktasını (kabul edilen emoji birleştiricileri dahil) görünür kaçışa çevirir (`️`, `\u{e0049}`); liste gövdesi çağrıya özel çitle (`citleSar`) sarılır. Araç çıktılarının kayıt özeti metin taşımaz (şema `ifade`'yi de reddeder); köprü modele yalnız `ajandaMcpSonucu`'nun tek metin içeriğini verir. Veriden okunan metin hiçbir zaman komut olmaz. Eski kanalların `gorunmezBirimMi` ve `kacir`'ı değişmez.
- **Hata kümesi ayrıdır.** `/ajanda` el sıkışma hataları `HATA_KODLARI`'nın v1 altkümesidir (`AJANDA_KANAL_HATALARI`); işlem retleri ayrı kapalı listededir (`AJANDA_RET_NEDENLERI`), `HATA_KODLARI`'na girmez.
- **Ajanda borusu ayrıdır.** Mevcut testler `ROL_FIILLERI.eren` ve `KOPRU_ROLLERI`'ni birebir sabitler; ajanda kendi borusunda (`AJANDA_BORU_ADI` = `\\.\pipe\eren-ajanda`), kendi rolüyle (`ana_oturum`) konuşur; zarf aynıdır (`kopru_hello`, `istek`, `iptal`, `kopru_welcome`, `kopru_ret`, `yanit`, `v` = 1).

## Kapsam ve eşleştirme

- `CIHAZ_KAPSAMLARI` = `sohbet` | `ajanda`. Kapsamı telefon beyan etmez (`pair_request` kapsam alanı taşıyamaz): PC'deki eşleştirme komutu açtığı pencereye yazar (ör. `eren eslestir --ajanda`), eşleşen cihaz kaydına geçer. Kapsam sütunu olmayan eski kayıt `ESKI_CIHAZ_KAPSAMI` = `sohbet`.
- `KAPSAM_KANALLARI`: `sohbet` → `/sohbet`, `/cihaz`; `ajanda` → `/ajanda`. Kesişmez: ajanda cihazı `/sohbet`'ten insan mesajı gönderemez, eski cihaz `/ajanda` açamaz.
- Eşleştirme kapsamın kanalında yapılır (`KAPSAM_ESLESTIRME_KANALI`). Ajanda `pair_request`'i `/sohbet`'in v1 `PairRequest` şemasına da uyar; ayrımı şema değil pencere denetimi yapar (testle sabit). QR: `AjandaEslestirmeQr` (`EslestirmeQr` + `kanal:"ajanda"`); iki uygulama birbirinin QR'ını reddeder.
- Kimlik: `ajandaKimlikImzaMetni` = `eren-ajanda-auth-v1`, rol, `kanal:ajanda`, `kapsam:ajanda`, `device_id`, iki nonce (satır sonuyla); `/sohbet` ya da `/cihaz` imzası yerine geçemez. IP eşleşmesi, 10 sn süre, kimlik öncesi 16 KiB sınırı, PC'nin kendi adresinden eşleştirme reddi ve kaldırma (`--kaldir`) bugünkü gibidir.

## Kanal akışı (`/ajanda`, `AJANDA_SURUMU`)

1. Eşleşme yoksa `pair_request` → `pair_result{kapsam:"ajanda"}`; bağlantı açık kalır.
2. `hello{device_id, son_rev, depo_id?, son_rev_izi?, client_nonce}` → `auth_challenge` → `auth_response` → `welcome{depo_id, bas_rev, tam, server_time_ms}`. Telafi alanları uygulamanın görünen kopyasından gelir (`ajandaHelloAlanlari`); `son_rev_izi` revizyonu `son_rev` olan kaydın kimliği ve `guncelleme_ms`'idir.
3. Telafi. `tam` `ajandaTelafiTamMi`'dir: depo kimliği yok ya da farklı, `son_rev > bas_rev`, iz yok, ya da servisin geçmişindeki `son_rev` satırı izle tutmuyor (aynı `depo_id`'yle yedekten geri yüklenip revizyonlar yeniden kullanılınca). `tam`'da 0'dan her şey (mezar taşları dahil), değilse revizyonu `son_rev`'ten büyük kayıtlar gelir; her biri son halini taşıyan bir `kayit` çerçevesidir, revizyon kesin artan sırayla; sonda `esitlendi{rev}`, sonrası canlıdır. Uygulama tarafı `ajandaEsitlemeAdimi`'dir: `kayit` yalnız revizyonu yereldekinden büyükse uygulanır, `son_rev` her çerçevede ilerler (kesilen artımlı telafi kaldığı yerden sürer). `tam` telafide gelenler ayrı toplanır; görünen kopya, kurulu alarmlar, `son_rev` ve `depo_id` `esitlendi`'ye kadar değişmez, `esitlendi`'de toplanan kopyanın yerine geçer (gelmeyen kayıt düşer), kopmada atılır ve sonraki `hello` eski kopyanın iziyle gider.
4. İşlem: `islem{islem_id, islem}` → `islem_sonucu{islem_id, ok, kayit_id?, rev?, code?}`. İşlemler: `ekle` (kimliği uygulama üretir), `guncelle` (kısmi; `null` alanı kaldırır; `temel_revizyon` bilgi içindir), `durum` (`ornek_tarihi` ile tek örnek: `ajandaOrnekDurumuUygula`), `onayla`, `sil` (mezar taşı), `geri_yukle`. Servis `(device_id, islem_id)` ile tekrarsızdır: aynı kimlik aynı sonucu alır, ikinci kez uygulanmaz; geçici ret (`ic_hata`, `ajandaRetGeciciMi`) tekrarsızlık kaydına yazılmaz. Zarfı geçerli ama gövdesi servisin şemasından geçmeyen işlem bağlantıyı kapatmaz: `ajandaYukariCoz` `islem_id`'yi verir, servis kalıcı `gecersiz_islem` döner. `kayit` ile `islem_sonucu` arasında sıra garanti edilmez; gerçek `kayit`'tir. Her başarılı değişiklik bir kaydın revizyonunu tek artan sayaçtan artırır ve geçmişe bir satır yazar; yan etkisiz işlem (aynı değer, zaten silinmiş kayda `sil`) `ok`, `rev` yok.
5. Kuyruk (`ajandaKuyrukKarari`). Uygulama işlemi önce yerelde iyimser uygular ve kalıcı kuyruğa koyar; `esitlendi`'den sonra sırayla ve birer birer yollar. Başarı işlemi çıkarır. Kalıcı ret onu ret listesine yollar: iyimser değişiklik geri alınır, işlem içeriği ve nedeniyle kullanıcıya görünür (düzeltip yeniden ekler ya da atar). Geçici ret ve sonucu gelmeden kopma (servis çerçeveyi reddedip kapatsa da) denemeyi artırır, işlem başta kalır ve aynı `islem_id` ile yeniden gider; `ISLEM_DENEME` (5) sonuçsuz denemede ret listesine geçer (`ic_hata` ya da `teslim_edilemedi`). Tam telafi hiçbir işlemi atmaz: yollanmış ama sonucu gelmemiş olanlar dahil kuyruk taze kopya üstüne yeniden iyimser uygulanır. İşlem kuyruktan yalnız sonucu ya da ret listesiyle çıkar; tek işlem kuyruğu kalıcı tıkayamaz, hiçbir işlem sessizce kaybolmaz.
6. Geçmiş: `gecmis_iste{istek_id, kayit_id, once_rev?}` → `gecmis{girdiler (en çok GECMIS_SAYFA, rev azalan), devami}`. Her girdi yazarı (`yol`, `tur_kokeni`), değişen alanların öncesi ve sonrasını (`AjandaParca`) taşır.

## Çakışma ve otomasyon kuralları

- **Tek yazar, varış sırası.** Bütün değişiklikler serviste tek modülden ve tek işlem sırasıyla geçer. İki insan düzenlemesinde PC'ye son varan kazanır (alan alan; reddetme yok).
- **Alan izi.** Kullanıcının emri (`kullaniciEmriMi`): insan yolu (`INSAN_YOLLARI`: `elle`, `sesli_not`) ya da turu doğrulanmış insan mesajının başlattığı araç çağrısı (`ARAC_YOLLARI`, `tur_kokeni:"insan"`). Emirle değişen alan uygulanır ve `elle_alanlar`'a girer. Emir olmayan otomasyon (sentetik turdaki araç çağrısı, insan mesajından da olsa arka plan çıkarımı) bu alanları değiştiremez: alan atlanır, `korunan_alanlar` ile bildirilir. Birleştirme `ajandaDegisikligiUygula`'dır; sonuç `AjandaKaydi` ile doğrulanır, bozulursa `tutarsiz_kayit`. Her değişiklik geçmişe yazılır, geri alınabilir.
- **Silme otomasyonu yener.** Mezar taşına `geri_yukle` dışında her işlem `kayit_silinmis`. Modelin silme fiili yoktur.
- **Sentetik tur.** İnsan kökenli olmayan turdan gelen ekleme `taslak:true` doğar; sentetik turdan taslak olmayan kayda değişiklik ya da herhangi bir onay `sentetik_turda_izinsiz`. Taslağı kullanıcı emri kesinleştirir: uygulamada `onayla`, insan turunda `ajanda_guncelle{onayla:true}` ya da aynı kaydı yeniden istemek. Tur kökenini servis belirler, araç girdisinde yoktur.
- **Tekilleştirme.** Aynı kayıt: aynı kapsam (`sohbet:<id>`), aynı tür, birebir aynı başlık ve aynı çözülmüş zaman; kullanıcının sözü (`ifade`) ve süre (`sure_dk`) girmez (`zamanCekirdegi`), "yarın 3'te" ile ertesi gün söylenen "bugün 3'te" aynı kayıttır. Anahtar (`ajandaTekilAnahtari`) saklanacak halden (dilim doldurulmuş) hesaplanır, kayıt doğarken `kaynak.tekil_anahtar`'a yazılır ve değişmez; eşler aynı anahtarı saklayan kayıtlardır. Karar `ajandaTekilKarari`'dır. Kullanıcı emrinde yalnız açık eş engeller: eş taslaksa onaylanır (`onaylandi`), değilse `zaten_var`; bitmiş, iptal ya da silinmiş eş yeni isteği engellemez. Emirde açık eşe kullanıcının bu turda söylediği yansır (`ajandaEsDegisikligi`: verilen `aciklama` ve `hatirlatmalar`, yeni `sure_dk`; eşin `ifade`'si korunur, varsayılan hatırlatma uygulanmaz); çıktı `uygulanan_alanlar` taşır. Emir olmayan otomasyonda silinmiş ve bitmiş dahil her eş engeller ve eş değişmez: kullanıcının sildiği ya da bitirdiği kaydı otomasyon başka sözle de yeniden yaratmaz. Anahtar tekil indeks değildir.

## Zaman ve hatırlatma

- Zaman yerel duvar saati + IANA dilimidir. `kesinlik`: `an` (gün+saat, isteğe bağlı `sure_dk`), `gun` (saat yok), `donem` (gün aralığı), `belirsiz` (yalnız ifade). Söylenmeyen saat ya da gün uydurulmaz; kullanıcının ifadesi `ifade`'de birebir durur. Dilim adının varlığını servis denetler (`saat_dilimi_bilinmiyor`).
- Hatırlatma: `once{dk}` olayın anından `dk` dakika önce; zaman `an` değilken kaydedilebilir ama bekler (çalmaz), saat gelince kurulur. `mutlak{tarih, saat, saat_dilimi}` bir kez. Duvar saatinden ana çeviri java.time `ZonedDateTime.of` varsayılanıdır: yaz saati boşluğunda boşluk kadar ileri, çakışmada önceki ofset.
- Varsayılan: girdide `hatirlatmalar` yoksa servis, zaman kesinliği ne olursa olsun `AJANDA_VARSAYILAN_HATIRLATMALAR`'ı (1 saat önce) koyar; `[]` hiç kurmaz ve öyle kalır. Birleştirme hatırlatma listesine dokunmaz.
- Kurulum: `kurulacakHatirlatmalar(kayit, şimdi)`, `hatirlatmaEtkinMi` (taslak değil, silinmemiş, `acik`) iken tetiği şimdiden kesin sonra olanlar; tekrarda her `once` için kapalı olmayan, tetiği şimdiden sonraki ilk örnek. Alarmın kimliği `(kayit_id, tetik_ms)`'dir (aynı tetikli iki hatırlatma tek bildirim).
- Geçmiş tetik. Hiç kurulmamış hatırlatma (doğduğunda ya da değiştiğinde tetiği zaten geçmiş: 14:30'da "bugün 3'te", 14:00 varsayılanı) hiç çalmaz. Kurulmuş ama teslim edilmemiş hatırlatma (telefon kapalıydı, yeniden başladı, kurulum tam tetik anında yenilendi) tetiği son `KACIRILAN_PENCERE_DK` (6 saat) içindeyse yeniden kurulumda bir kez kaçırılan olarak gösterilir, birden çoksa tek özet bildirimde (`kacirilanHatirlatmalar`); daha eskisi sessizce düşer. Böylece yeniden kurulum ve tam eşitleme bildirim yağmuru yaratmaz, kurulmuş hatırlatma da kaybolmaz.
- Tekrar örnek günleri `tekrarOrnekleri`'dir (çapa günü listede yoksa örnek değildir, ayda olmayan gün atlanır, `adet` çapadan sayılır). `tekrar` ya da `zaman` uygulanınca seriye ait olmayan örnek satırları budanır ve geçmişe `ornekler` olarak yazılır. `ORNEK_ADET` dolunca bugünden önceki en eski satırlar atılır, seri kilitlenmez.

## Araç yolu (ilk dilim)

- Konuşma modülü sohbetin ana oturumuna `eren` köprüsünün yanında ajanda borusuna bağlanan bir köprü ve `ana_oturum` jetonu verir (kapsam: `sohbet_id` + nesil). Fiiller `ajanda_ekle`, `ajanda_guncelle`, `ajanda_listele`; girdi/çıktı `AJANDA_ARACLARI`. Model kimlik, kaynak, taslak, tekrar veremez; taslağı yalnız insan turunda onaylayabilir. Kaynak izini servis kurar: `yol:"sohbet_araci"`, `sohbet_id`, `tur_kokeni`, insan turunda `kaynak_msg_id`; `alinti` yalnız turun insan mesajında birebir geçiyorsa saklanır.
- **Mesaj anı.** Göreli ifade ("yarın", "bu akşam", "1 saat sonra") kullanıcının mesajının servise ulaştığı ana göre çözülür. Ana oturum uzun yaşar ve saat bilmez; mesaj meşgul ya da uyuyan oturuma geç iletilir, araç daha da sonra çağrılır; ikisi de dayanak olamaz. Turun mesaj anı: insan turunda mesajın varışı; birleşik sentetik turda en yeni satırın varışı; kuyruktan gelmeyen devir ve kurtarma turunda turun açıldığı an. Varışta kullanıcının o anki dilimiyle bir kez yerel ana (`AjandaYerelAn`) çevrilip saklanır; damga ve denetim bu tek değeri kullanır. Ana oturuma giden her kullanıcı rolündeki mesajın başında `mesajAniDamgasi` satırı durur (`[mesaj_ani: 2026-11-25 Çarşamba 23:58 Europe/Istanbul]`); telefona giden ve saklanan metne girmez, `alinti` denetimi damgasız metinle yapılır. Zaman ya da `mutlak` hatırlatma taşıyan `ajanda_ekle`/`ajanda_guncelle` `dayanak{tarih, saat}` ister; servis `dayanakGecerliMi` ile mesaj anının yerel günüyle aynı gün ve en çok `DAYANAK_SAPMA_DK` sapma denetler, değilse kayıt yazmaz ve `dayanak_uyusmuyor` döner. Her araç çıktısı `mesaj_ani` taşır; ret metni modeli şimdiye değil mesaj anına göre yeniden çözmeye yönlendirir. 23:58'de yazılıp 00:01'de iletilen "yarın 3'te" mesajın ertesi gününe düşer; 00:01 dayanağı reddedilir.
- Çıktılar: `AjandaKayitOzeti` her zaman `taslak`, `durum`, `silindi`, ifadesiz zaman (`AjandaZamanOzeti`) ve `hatirlatmaOzeti`'ni (kurulacak, saatsiz bekleyen, geçmişte kalan) taşır. `ajanda_ekle` sonuçları: `eklendi`, `onaylandi`, `zaten_var`, `ret`. Model metni `ajandaEkleMetni`, `ajandaGuncelleMetni`, `ajandaListesiMetni`; taslakta "kaydedildi deme" der, geçmişte kalan ve saat bekleyen hatırlatmayı, bu turda işlenen alanları ve `tutarsiz_kayit` nedenini söyler.
- Kabul senaryosu: "yarın 3'te dişçi ☕️" → `ajanda_ekle{tur:randevu, zaman:{an, yarın, 15:00, ifade}, dayanak: mesaj anı}` → `kayit` çerçevesi → uygulama gösterir ve 14:00 hatırlatmasını kurar → PC kapanır, hatırlatma çalar (telefon o an kapalıysa açılınca kaçırılan olarak); elle ekleme, `durum:tamam` ve `durum:acik` (geri alma) uygulamadan.

## Ekiplerin gereksinimleri

Sözleşmenin üstüne yazılacak kodun yapması gerekenlerin tek listesi; adlar `protocol`'dendir.

### Servis: ajanda modülü

- Tek yazar, tek sıra; her başarılı değişiklikte tek sayaçtan revizyon ve geçmiş satırı (`guncelleme_ms` = satırın `ts_ms`'i, geçmiş budanmaz); geri yükleme ve içe aktarmada yeni `depo_id`; `KAYIT_ADET` (`kayit_siniri`).
- Değişiklik `ajandaDegisikligiUygula`, örnek durumu `ajandaOrnekDurumuUygula` (`bugun`: kaydın dilimindeki yerel gün); sonuç `AjandaKaydi` ile doğrulanır, budananlar geçmişe yazılır. Silme, sentetik tur ve tur kökeni kuralları yukarıdaki gibidir.
- Ekleme: dilimi doldur ve denetle, varsayılan hatırlatma, `alinti` denetimi; otomatik eklemede `ajandaTekilAnahtari` → `kaynak.tekil_anahtar`, `ajandaTekilKarari`, emirde açık eşe `ajandaEsDegisikligi` (taslaksa aynı işlemde onay, `uygulanan_alanlar`).
- Araçta `dayanakGecerliMi(dayanak, turun mesaj anı)` (`dayanak_uyusmuyor`); çıktıda turun `mesaj_ani`'sı, `ajandaZamanOzeti`, `hatirlatmaOzeti` (java.time kuralıyla `AnCevirici`).
- Tekrarsızlık `(device_id, islem_id)`: kalıcı sonuçlar (`gecersiz_islem` dahil) yazılır, `ic_hata` yazılmaz.

### Servis: gateway ve eşleştirme

- `/ajanda` yolu, `ajandaYukariCoz`/`ajandaAsagiCoz`, sınır `AJANDA_AZAMI_CERCEVE.KANAL`. Kimlik sonrası çözüm `islem_id` taşıyorsa bağlantıyı kapatma: `islem_sonucu{islem_id, ok:false, code:"gecersiz_islem"}` yolla ve tekrarsızlık kaydına yaz; öteki geçersiz çerçeve `gecersiz_mesaj` + kapat.
- `hello`'da cihaz kaydını taze oku, `kanalKapsamdaMi` yanlışsa `kanal_desteklenmiyor` + kapat (sınama başlamadan); eşleştirme penceresi denetimi; `ajandaKimlikImzaMetni`, `AjandaEslestirmeQr`, `AJANDA_KANAL_HATALARI`. Depoya `cihazlar.kapsam`, `eslestirme.kapsam` (ek göç).
- Telafi (`ajandaTelafiTamMi`): bağlantı başına son gönderilen revizyonu tut, telafi sürerken doğanı sıraya al, aynı revizyonu iki kez yollama.

### Konuşma modülü

- Her kuyruk satırının (insan ve sentetik) varış anını kullanıcının o anki dilimiyle `AjandaYerelAn`'a çevirip satırla sakla; ana oturuma giden her kullanıcı rolündeki mesajın başına bundan `mesajAniDamgasi` koy (iletim anı ya da şimdiki saat değil).
- Turun mesaj anını ("Mesaj anı" tanımıyla) ve turun kökenini servise ver.
- Köprüye `ana_oturum` jetonu (kapsam `sohbet_id` + nesil) ve ajanda borusu bağlantısı.

### Köprü

- `AJANDA_BORU_ADI`, `AjandaKopruRolu`, `AJANDA_ROL_FIILLERI`/`ajandaFiilRoldeIzinliMi`, `ajandaKopruYukariCoz`/`ajandaKopruAsagiCoz`; MCP girdi şeması `jsonSemasi(AJANDA_ARACLARI[fiil].girdi)`, `outputSchema` yok.
- Modele yalnız `ajandaMcpSonucu`: tek metin içeriği, `structuredContent` yok; çit her çağrıda güvenli üreteçten (gövdede geçerse yenisi); liste `GUVENILMEZ_META` taşır.

### Uygulama

- Kanal şemaları ve iki vektör dosyası birebir geçmeli (dil bağımsız: kayıt, işlem, metin kuralı, emoji bağlamı, temizlik, tekrar, hatırlatma, kaçırılan, kuyruk, eşitleme).
- Eşitleme `ajandaEsitlemeAdimi`, `hello` alanları `ajandaHelloAlanlari`; `tam` telafide görünen kopya ve alarmlar `esitlendi`'ye kadar değişmez.
- İşlem kuyruğu: iyimser uygulama (`ajandaDegisikligiUygula`, `ajandaOrnekDurumuUygula`), kuyruk ve deneme sayısı kalıcı, `esitlendi`'den sonra birer birer, kararlar `ajandaKuyrukKarari`; ret listesi (`AJANDA_KUYRUK_RET_NEDENLERI`) kullanıcıya görünür, düzeltip yeniden ekleme ya da atma.
- Alarmlar, PC'den bağımsız: her kayıt değişikliğinde, tam eşitlemenin sonunda, açılışta, yeniden başlatmada ve saat ya da dilim değişiminde `kurulacakHatirlatmalar` ile yeniden kur; kurulan kimlikleri teslim edilene dek kalıcı sakla; yeniden kurulumda `kacirilanHatirlatmalar` (tek özet bildirim, teslim edildi işareti, eskileri sessizce sil); tekrarda bir örnek çalınca sıradakini kur (tekrar üreticisi gelmeden de).
- Metin girişi: `ajandaMetniTemizle` (emoji korunur, gizli karakter atılır), sonra alanın kuralı (kenar boşluğu, tek satırda satır sonu); metni düz göster, bağlantıya çevirme. Elle eklemede `girdi_yolu` `INSAN_YOLLARI`'ndan, hatırlatma ekranı `AJANDA_VARSAYILAN_HATIRLATMALAR` ile açılır.

## Sonraya bırakılanlar

- PC'deki normal Claude Code oturumları için köprü rolü (`pc_araci` yolu ve `oturum_id` şimdiden şemada).
- Yalnız insan mesajlarından araçsız arka plan çıkarımı, gölge modda (`arka_plan` yolu şemada).
- Çevrimdışı sesli hızlı not (`girdi_yolu:"sesli_not"` şemada).
- Tekrar arayüzü ve üretimi: `Tekrar` ve `ornekler` kabloda kabul edilir, ilk dilimde üreten yoktur (araç girdisinde `tekrar` yok); örnek günleri `tekrarOrnekleri` (RFC 5545 altkümesi).
- Örnek başına zaman değişikliği (taşınan örnek), ek kanal yetenekleri (`?yetenek=`), iOS.

## Kalan açıklar

- İnsan turunda model, aynı turda okuduğu güvenilmez metne (web, ekran, rapor) dayanarak kayıt ekleyebilir, bir taslağı onaylayabilir ya da kullanıcının elle düzelttiği bir alanı ezebilir. Etki eylemsiz bir kayıt ya da alan değeridir; kaynak izi ve geçmiş yazarı ve önceki değeri gösterir, geri alınabilir.
- Telefonun outbox'ında bekleyip gece yarısından sonra servise ulaşan mesajın mesaj anı varış anıdır: `/sohbet` v5 `user_message` istemci zamanı taşımaz ve baytları değişmez, "yarın" bir gün kayar. Kayıt ve hatırlatması uygulamada görünür; düzeltme kullanıcıdadır. Kapanması istemci zamanı taşıyan yeni bir `/sohbet` sürümü ister.
- Dayanak turun mesaj anıdır: göreli ifade gece yarısından önceki bir turda söylenip ayrıntısı sonraki turda tamamlanırsa model ifadeyi bu turun anına göre çözebilir ve denetim bunu yakalamaz.
- Yedekten geri yükleme, yedekten sonra onaylanmış değişiklikleri kullanıcıya haber vermeden kaybettirir; uygulama `tam` telafide yalnız sonucu gelmemiş kuyruğunu korur, onaylanmış eski hali geri yollamaz. Geri yükleme kullanıcının elle yaptığı nadir bir işlemdir.
- Yaz saati boşluğu ve çakışması için hatırlatma planı vektörü yok (vektörler sabit ofsetli dilimlerle sınar); kural yukarıda yazılıdır.
- Sonucu gelmeden kopma da deneme sayılır: bağlantı çok kararsızsa geçerli bir işlem `teslim_edilemedi` ile ret listesine düşebilir (kaybolmaz, kullanıcı yeniden ekler); servisin uyguladığı ama yanıtı her seferinde kaybolan bir `ekle` yeniden eklenirse `kimlik_cakisiyor` alır.
