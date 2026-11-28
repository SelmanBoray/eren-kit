# H4 dilim planı: sürücü sınırı (yalnız Claude)

Durum: **plan, onay bekliyor.** Kod bu plan onaylanınca başlar. Çerçeve `HARNESS.md` (2.1–2.2, 2.7, 3, 4.1,
7). Döküm `4e41e57`'ye göre yeniden doğrulandı (2026-11-28). Kol C v3 sonra dala birleşti (`c044af5`;
`sozlesme.ts`, `ayar.ts`, `ana.ts`, `dis-dunya.ts`, `kopru.ts` değişti); satır numaraları buna göre kayar,
uygulama başlarken yeniden doğrulanır. Kod bu belgeyle çelişirse kod kazanır.

---

## 1. Özet

- **Ne yapılıyor:** Claude Code'a özgü dört iş `OturumSurucusu` arkasına alınır: komut kurma, stdin satırları,
  akış çözme ve kimlik politikası. Bunlar bugün `konusma.ts`, `konusma-metin.ts`, `isler*.ts` ve `akis.ts`'te.
  Tek uygulama `surucu-claude.ts` olur. Servis yalnız `NormalOlay` görür ve profilleri yetenek beyanına göre
  açar. Claude'da hepsi açık kalır. Ayrıca iki açık kapanır: tur zaman aşımı (anahtarla) ve "motor yok".
- **Neden:** İkinci sürücü (H6) servisin çekirdeğine dokunmadan eklenebilsin. Claude'a özgü kararlar tek
  dosyada toplanıp test edilsin.
- **Ne yapılmıyor:** İkinci sürücü yazılmaz (H6). Protokol, telefon, Ajanda uygulaması, bağlayıcı (H1–H3),
  kurulum, metinler (H5), veritabanı şeması ve kalıcı JSON (`son_result`, tüketim satırı) değişmez. Dosya
  adları değişmez (`akis.ts` Claude çözücüsü olarak kalır). Claude bayrakları, alan adları ve kararlar
  birebir taşınır.

## 2. Döküm farkları (HARNESS.md 2.1–2.2 → bugün)

`43d7543..4e41e57` arasında `akis.ts`, `isler.ts`, `isler-komut.ts`, `isler-rapor.ts`, `etkinlik.ts`,
`tuketim.ts` ve `kilit.ts` değişmedi. Değişenler ve dökümde eksik olanlar:

| Yer | Fark |
|---|---|
| `konusma.ts` | Satırlar kaydı: `ANA_SOHBET_ARACLARI` 59, satır kurucular 214–254, `argvKur` 722, `sureciBaslat` 757, `pompala` 949, `turSiniri` 1325, `initDenetle` 1347, `sonucIsle`/`satirIsle` 1367–1461, `acilisYap` 1524, `sayfaAc` 1577 |
| `konusma.ts`, medya (**yeni, a**) | `insanSatiriKur` `content`'e Messages API blok dizisi de yazar (`text`, base64 `image`). Görsel bütçesi devri (`gorselDevriGerekli`) şu varsayıma dayanır: `--resume` geçmişteki görselleri her istekte yeniden yollar |
| `ayar.ts` `MEDYA_SERVIS_SINIRLARI` (**yeni, a**) | Görsel boyutları (1568 uzun kenar, 1,15 MP, 3,75 MB) ve nesil başına 60 görsel, Claude'un görsel girdisine göre seçildi. Bunlar sürücü yeteneği olmalı |
| `konusma-metin.ts` | `sonIstem` 139; `sistemIstemi`'ne `medya` parametresi geldi. `erenMcpMetni` 200: `eren`, `eren-ajanda`, `computer-use-windows`, hepsi `alwaysLoad` |
| `sozlesme.ts`, `ana.ts` | `Ayar` 528–593 (`claudeExe` 553), `AkisOlayi` 785–834, `AkisYardimcilari` 848. `akis` enjeksiyonu `ana.ts` 252'de |
| `ayar.ts` | `claudeSil` 154, `claudeExeBul` 255, `yollariUret` 394. Dökümde yoktu: `pcIsOrtami` `PC_SERVIS_OTURUMU_ORTAMI=1` ekler (b) |
| `dis-dunya.ts`, `eslestir.ts` | `transkriptKur` 1388. `ayarKur` çağrısı 1110. `--liste` ve `--kaldir` zaten `ayarKur` çağırmaz; kod üretimi çağırır |
| Kimlik politikası (**eksikti**) | Yalnız ana oturumda denetlenir. İşlerde `apiKeySource` okunmaz; tek koruma ortamdan `CLAUDE*`/`ANTHROPIC*` silinmesidir. PC tam profil kullanıcı ayarlarını yükler; ayardan gelen bir anahtar kaynağı ölçülmedi |
| Kesme (**eksikti**) | `control_request/interrupt`'ın da zaman aşımı yok: kesmeden sonra `result` gelmezse tur kapanmaz. Süresi olan tek bekleme devir özeti (`devirOzetiBeklemeMs`) |
| 4.1 `NormalOlay` (**eksikti**) | Servis listeden fazlasını kullanır: canlı etkinlik (`model_basladi`, `blok_basladi`, `assistant.araclar`, `arac_sonucu`), `result`'tan önce gelen asistan `usage`'ı (doluluk), tüketim farkları (`model_kullanimlari`, `ana_kullanim`) ve sınıftan ayrı `is_error` (aday ve resume kararları). `hook_response` ve `control_response` çözülür ama kullanılmaz |
| İş akışı | İşler akışı `out.jsonl`'den ofsetle okur; ana oturum borudan okur. `satirAyirici` geneldir (b) |
| `mimari.test.ts` | Sözleşme yalnız `"./sozlesme.ts"` yolundan alınır. Yeni sürücü dosyaları bu yüzden alt dizine değil `server/src` köküne konur. Zaman ve ortam yalnız portlardan gelir |

## 3. Dilimler

Ortak kurallar: Her dilim tek commit'tir ve main'e tek başına girebilir. `npm run typecheck -w server` ve
server testleri yeşil kalır, H4.0'ın altın kayıtları bayt bayt aynı kalır. Var olan testlerin iddiaları
değişmez; test kurulumuna yalnız `surucu` bağımlılığı eklenebilir. Kalıcı biçim ve protokol değişmediği için
revert canlı kurulumdan sonra da güvenlidir.

**H4.0 Altın kayıtlar (yalnız test).**
- Kapsam: Bugünkü davranış sahte portlarla kayda geçer; `src`'ye dokunulmaz.
- Dosyalar: yeni `server/test/surucu-altin.test.ts` ve `server/test/altin/claude-*.json`.
- Kaydedilenler:
  - (a) Ana oturum başlatma (`exe`, `argv`, `cwd`, `ortam`, nesil mcp dosyası): kip yeni/devam; takvim,
    medya, computer-use, tam yetki var/yok.
  - (b) stdin satırları: insan, kısayollu, medyalı, sentetik, birleşik sentetik, devir isteği ve ilk satırı,
    kurtarma notu, kesme.
  - (c) Akış senaryosu (init → `stream_event` → assistant `usage`/`tool_use` → `rate_limit` → `tool_result` →
    result): veriyolu yayınlarının sırası ve depo yazımları (`turBitir`, `tuketimEkle`, `nesilGuncelle`).
  - (d) Kararlar: `apiKeySource`, `terminal_reason`/`is_error` → sınıf, devir eşiği, `pencereSec`, hata devri.
  - (e) İşler: pc tam, pc hafif (`pcIsModeli` boş/dolu), telefon için `AyrikSurecIstegi`, `mcp.json`,
    `gorev.txt`; bir `out.jsonl` senaryosundan `son_result`, tüketim, "bağlı değil" notu, limit olayı.
  - (f) `akis.test.ts`'in her girdi satırı için `AkisOlayi`.
- Sınama: Test kayıtla karşılaştırır. Kayıt yalnız açık bir ortam değişkeniyle yeniden yazılır; kaydı
  değiştiren commit davranış değişikliğidir ve kendi dilimini alır. Ortam değerleri sahtedir.
- Geri alma: revert. Kol C: yok. Büyüklük: orta.

**H4.1 Sözleşme ve Claude sürücüsü (bağlanmadan).**
- Kapsam:
  - `sozlesme.ts`'nin sonuna yeni bölüm; yalnız ekleme. Tipler: `OturumProfili` (`ana | pc_tam | pc_hafif |
    telefon`), `SurucuYetenekleri` (4.1 + `gorselGirdi`), `SurucuKomutu{exe, argv, ortam, cwd}` (`exe`
    gerçek ikili, ön argümanlar `argv`'nin başında), `NormalOlay`, `OturumSurucusu`.
  - `NormalOlay`, 4.1'in bölüm 2'deki eksiklerle genişletilmiş hali: `hazir{kimlik, model, mcp[]}`,
    `model_basladi`, `blok_basladi`, `arac_istegi[]`, `arac_sonucu`, `kullanim_anlik`, `metin_parcasi`,
    `kota`, `tur_bitti{sinif, hata, metin, rapor, pencereler, tuketim}`, `diger`.
  - `hazir.kimlik` üç değerli: `uygun | uygun_degil | denetlenemez` (bölüm 5).
  - Yeni `surucu-claude.ts`: yetenek beyanı ve `olayCoz` (`akis.satirCoz` + eşleme). Claude'da
    `apiKeySource === "none"` → `uygun`, geri kalan her şey `uygun_degil`.
- Bayt bayt: Çalışma anında değişen yok; yeni kodu çağıran yok.
- Sınama: (f)'deki her satır için `olayCoz` çıktısı elle yazılmış eşlemeye eşit. Yetenek beyanı sabit testle,
  sınır mimari taramayla denetlenir.
- Kol C: `sozlesme.ts`'de yalnız ekleme. Büyüklük: orta.

**H4.2 Komut kurma sürücüye geçer.**
- Kapsam: `surucu.komutKur(profil, girdi)` ve `surucu.mcpMetni(sunucular)`'a geçenler: `argvKur` ve
  exe/ortam/cwd seçimi (`konusma.ts`), iki iş komutunun exe ve ortam seçimi (`isler.ts`), `erenMcpMetni` ve
  `kopruSunucusu`'nun Claude şeması (`mcpServers`, `type`, `alwaysLoad`, `timeout`). Sunucu listesi ve
  jetonlar serviste kalır. `pcArgv`, `telefonArgv`, `PC_YASAK_ARACLAR`, `HAFIF_PC_MODELI` yerinde kalır;
  sürücü onları çağırır. `Konusma`, `Isler`, `Sohbetler` bağımlılıklarına `surucu` eklenir; `ana.ts`
  `claudeSurucusuKur({ ayar })` kurar.
- Bayt bayt: argv (sıra dahil), exe, cwd, ortam (anahtar ve değer), mcp dosyası (anahtar sırası dahil),
  `gorev.txt`.
- Sınama: H4.0 (a) ve (e). `konusma.test.ts` ve `isler.test.ts`'in argv iddiaları değişmeden geçer.
- Kol C: `sozlesme.ts`'de üç arayüze birer alan. Büyüklük: orta.

**H4.3 stdin satırları sürücüye geçer.**
- Kapsam: `insanSatiriKur`, `sentetikSatirKur`, `kesmeSatiriKur` ve `medyaBloklari` sürücüde `insanSatiri`,
  `sentetikSatir` ve `kesme` olur. Damga (`damgali`), kısayol öneki ve "insan satırı yalnız kuyruğun insan
  satırından" kuralı (T1) `konusma.ts`'te kalır. T7'nin Claude karşılığı (`client_composed`,
  `CLAUDE_CODE_DISABLE_FILE_MENTIONS`) sürücü testine yazılır.
- Bayt bayt: JSON satırı, anahtar sırası dahil.
- Sınama: H4.0 (b) ve `konusma-medya.test.ts`. Kol C: yok. Büyüklük: küçük.

**H4.4 Ana oturumda akış çözümü.**
- Kapsam: `satirIsle`, `sonucIsle`, `initDenetle` ve `etkinlikIlerlet` `NormalOlay` tüketir; `initDenetle`'nin
  yüklemi `kimlik === "uygun"` olur. Tur sınıfı ve pencere seçimi sürücüden gelir; devir eşiği formülü,
  `VARSAYILAN_ESIK` ve ardışık hata sınırı serviste kalır. `etkinlik.ts` ve `tuketim.ts` `NormalOlay` alır;
  araç adı → kategori tablosu kalır (tanınmayan ad zaten "arac" olur).
- Bayt bayt: Telefona giden olaylar (`tur_delta` ofsetleri, etkinlik, `limit_dolulugu`, `eren_durumu`),
  tüketim satırları, devir eşiği, init reddi ve metni. Sıra da korunur: etkinlik, `result` turu kapatmadan
  önce işlenir; aynı `message_id`'nin `usage`'ı toplanmaz, ezilir.
- Sınama: H4.0 (c) ve (d). `konusma*.test.ts`, `etkinlik.test.ts`, `tuketim.test.ts`,
  `insan-noktasi.test.ts`.
- Kol C: `konusma.ts`'teki ajanda yollarına (`turBaglami`, ajanda jetonu) dokunulmaz, ama dosya ortak:
  birleştirme sırası koordinatörden. Büyüklük: büyük.

**H4.5 İşlerde akış çözümü ve süreç adı.**
- Kapsam: `partiIsle`, `kopruleriDenetle` ve `sonResultOzeti` `NormalOlay` tüketir (Claude'da `mcp[].bagli` =
  `status === "connected"`, `rapor` = `structured_output`). `kimlikAra`'nın görüntü adı `surucu.surecAdi`
  olur (Claude: `basename(claudeExe)`). İşlerde kimlik denetimi eklenmez (bölüm 5).
- Bayt bayt: Depodaki `son_result` (`is_error`, `structured_bos`, `structured_output`,
  `metin_limit_onekli`), tüketim, "bağlı değil" notu, `telefonKoprusuz`, sahipsiz süreç seçimi.
- Sınama: H4.0 (e), `isler*.test.ts`, `isler-rapor.test.ts`, `sahte.ts`'in `claude.exe` adlı uzlaştırma
  testleri.
- Kol C: yok. Büyüklük: orta.

**H4.6 Yetenek kapıları.**
- Kapsam: Telefon işi yalnız `yerlesikAracKisiti` (T8) ve `guvenilmeyenMetinYolu` (T7) varsa başlar; yoksa
  `isler.baslat` mevcut `ic_hata` kodunu ve bir not döner. Ana oturumda insan kökeni (`turBaglami`,
  `insanTuru`) yalnız `altAgentKapatilabilir` varsa verilir, yoksa sentetiktir (3.2). `gorselGirdi` yoksa ek,
  medyasız yoldan önekle gider.
- Bayt bayt: Claude bütün yetenekleri beyan eder; H4.0 aynı kalır.
- Sınama: Yetenekleri kapalı sahte sürücüyle: telefon işi başlamaz, ajanda turu sentetik çıkar, görsel bloğu
  yazılmaz.
- Kol C: Ajanda dosyalarına dokunmaz; kapı `konusma.ts`'te. Büyüklük: küçük.

**H4.7 Tur zaman aşımı (anahtarlı, varsayılan kapalı).**
- Kapsam: Yeni anahtar `ayar.local.json` `tur_sessizlik_dk`; yoksa özellik kapalı. Etkin turda bu süre
  boyunca akış satırı gelmezse kesme yazılır; bir pay içinde `tur_bitti` gelmezse süreç öldürülür. Ardından
  bugünkü süreç ölümü yolu işler: kurtarma notu, `--resume`, resume sayacı. Aynı pay kullanıcı kesmesine ve
  devir kesmesine de uygulanır. Sürücüden bağımsızdır: `konusma.ts`'te, zamanlayıcı portuyla.
- Bayt bayt: Anahtar yokken hiç zamanlayıcı kurulmaz; H4.0 aynı kalır.
- Sınama: Sessizlik → kesme → pay → öldürme → kurtarma. Arada satır gelirse sayaç sıfırlanır; geç gelen
  `tur_bitti` turu normal kapatır; görünmeyen devir turu da kapsanır.
- Geri alma: Anahtarı silmek ya da revert.
- Kol C: `ayar.ts`'e izinli anahtar. Kol C v3'ün `ServisEkAyari` deseni kullanılırsa `sozlesme.ts`'e
  dokunmaz. Büyüklük: orta.

**H4.8 Motor yok; `ayarKur`'un `claude.exe` zorunluluğu kalkar.**
- Kapsam:
  - `claude.exe` bulunamazsa `ayarKur` atmaz; motor `yok` olur. `claude_exe` verilmiş ama geçersizse bugünkü
    gibi `AyarHatasi` atılır: yanlış ayar sessiz kalmamalı.
  - Servis açılır; sohbetler `kapali` olur ve her biri bir kez kritik `system_notice` alır. Her uyandırma ve
    yeniden denemede sürücü exe'yi yeniden arar; bulunca açılış normal sürer. İşler mevcut `ic_hata` kodunu
    ve bir not döner. `eslestir` motorsuz kod üretir (H2'den taşınan madde).
  - Protokol değişmez: mevcut `kapali` ve `diger` kullanılır.
- Bayt bayt: `claude.exe` bulunan kurulumda H4.0 aynı kalır. Yeni davranış yalnız exe'siz makinede: bugün
  orada servis açılmıyor, bekçi yeniden başlatıyor.
- Sınama: Exe yok → durum ve not. Önce yok, sonra var → ilk uyandırmada açılış. Eşleştirme motorsuz çalışır.
  Geçersiz `claude_exe` hâlâ atar.
- `.exe` kuralı Claude için aynı kalır: `.cmd` ve `.ps1` kabuk ister, kabuksuz `spawn` başlatamaz. Açığın
  yapısal kısmı H4.2'de kapanır: port "gerçek ikili + ön argüman" taşır.
- Kol C: `eslestir.ts` (D5 de dokunuyor) ve `ayar.ts`. Büyüklük: orta.

## 4. Sıra ve bağımlılıklar

```
H4.0 ─► H4.1 ─► H4.2 ─► H4.3 ─► H4.4 ─► H4.5 ─► H4.6
  │                └──────────────────► H4.8
  └─► H4.7 (yalnız H4.0'a bağlı)
```

- H4.0 önce gelir: kayıt, taşınmadan önceki koddan alınmalı.
- H4.5, H4.4'ten sonra gelir (ortak `tuketim.ts` girdisi). H4.6 iki akış dilimini de ister.
- H4.8 H4.2'den sonra gelir: exe arayışı sürücüde olmalı.
- H4.7 bağımsızdır, istenirse öne alınır.
- Ortak dosyaya dokunanlar: H4.1 ve H4.2 (`sozlesme.ts`), H4.4 (`konusma.ts`), H4.7 ve H4.8 (`ayar.ts`,
  `eslestir.ts`). Bunlar süren Kol C v3 birleşmesinden sonra girer. H4.0, H4.3, H4.5 ve H4.6 Kol C'den
  bağımsızdır.

## 5. Kullanıcıya soru ve plana etkisi

**Soru:** Başka bir harness'ta API anahtarıyla çalışmaya izin verilsin mi? Bugün Claude'da
`apiKeySource === "none"` zorlanıyor.

- **Cevaptan bağımsız:** H4.0–H4.8'in tamamı. Claude sürücüsü kuralı ve ortam silmeyi aynen taşır.
- **Cevaba açık bırakılan tek biçim:** `hazir.kimlik`'in üç değeri (H4.1). Servis H4'te yalnız `uygun`'u
  kabul eder.
- **Evet:** H6'da sürücü başına izin ayarı ve sürücü başına ortam silme gelir. Kota pencereleri olmayabilir;
  telefon o zaman gizler (4.4). Maliyet metni (H5) "liste fiyatı" yerine gerçek ücreti söyler.
- **Hayır:** `denetlenemez` reddedilir. İkinci sürücü adayı yalnız abonelik girişini kanıtlayabilen bir
  harness olur.
- **Bağlı alt soru:** İşlerde de kimlik denetimi zorlansın mı? Bugün yok (bölüm 2). Zorlamak davranış
  değiştirir: ayarlarında anahtar kaynağı olan PC işi reddedilebilir. Cevaba göre ayrı küçük dilim; H4'te yok.

## 6. Riskler ve ölçülmesi gerekenler

- **En büyük risk H4.4.** Dilim `konusma.ts`'nin en çok durum taşıyan kısmını değiştirir: devir, kurtarma,
  etkinlik ve tüketim sırası. Sıra farkları birim testinde görünmeyebilir. Altın senaryo bu sıraları açıkça
  içermeli ve dilim tek commit kalmalı.
- **Altın kaydın kör noktası:** Kayıt sahte süreçle alınır. Ölçülecek: H4.5'ten sonra, canlı kurulumdan
  önce, ayrı bir veri kökünde gerçek `claude` ile duman koşusu (bir mesaj, bir PC hafif işi, bir kesme);
  gerçek sürecin argv ve stdin kaydı altınla aynı olmalı.
- **Kol C birleşmesi:** `sozlesme.ts`, `konusma.ts` ve `ayar.ts` (bölüm 4).
- **Tur zaman aşımı süresi:** Ölçülecek: Uzun bir araç çağrısında (PowerShell, WebFetch) akışa ara satır
  gelip gelmediği. Gelmiyorsa sessizlik süresi en uzun meşru araç süresinden büyük olmalı. Varsayılanı açmak
  ayrı karar.
- **Motor yok:** Güncelleme sırasında exe kısa süre yok olabilir. Bugün bunu bekçinin yeniden başlatması
  çözüyor; yeni yolda yeniden arama karşılamalı. Ölçülecek: bekçinin yeniden başlatma aralığı ile yeniden
  arama aralığının karşılaştırması.
- **Ölçülmedi:** Claude Code'un `node <giriş.js>` biçimiyle başlatılabildiği (H4 bu yolu açmaz) ve ek çözüm
  katmanının satır başına maliyeti (ihmal edilebilir beklenir).

## 7. Açıklar ve kapandıkları dilim

| Açık | Dilim | Not |
|---|---|---|
| Ana sohbette tur zaman aşımı yok; `result` gelmezse kuyruk durur | H4.7 | Anahtarla; varsayılan kapalı |
| Kesmeden sonra zaman aşımı yok | H4.7 | Aynı pay |
| `claude_exe` yalnız `.exe` | H4.2 (yapı), H4.8 (kural) | Claude'da kural bilerek aynı (kabuksuz); ikinci sürücü ön argümanlı başlatıcıyı kullanır |
| `ayarKur` `claude.exe` istiyor; motorsuz servis ve eşleşme yok | H4.8 | H2'den taşınan madde |
| Kimlik politikası konuşmaya gömülü | H4.1, H4.4 | Sürücüye taşınır, karar aynı |
| İşlerde kimlik denetimi yok | — | Açık kalır; bölüm 5'teki alt soruya bağlı |
