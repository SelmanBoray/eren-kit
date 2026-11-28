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
  gerçek sürecin argv ve stdin kaydı altınla aynı olmalı. Düzenek ve ölçüt bölüm 8'de.
- **Duman koşusu kullanıcının hesabında çalışır.** Gerçek `claude` `~/.claude` ve `~/.claude.json`'a iz
  yazar. PC hafif işi `--dangerously-skip-permissions` ile koşar; araç kullanımını yalnız istem sınırlar.
  `--evet`'ten önce kullanıcıya bölüm 8'deki risk özeti sunulur. Ölçülecek: `CLAUDE_CONFIG_DIR` ve
  `CLAUDE_SECURESTORAGE_CONFIG_DIR` ile yalıtımın girişi bozmadan çalışıp çalışmadığı (bölüm 8, "Yalıtım").
  Boru yönlendirmesi süreç başınadır: modelin araçla başlattığı bir `node` ya da `eren` süreci yönlendirilmez.
  Bu yüzden koşu penceresinde canlı servisin günlüğü de denetlenir (bölüm 8, "Önyüklemesiz alt süreçler").
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

## 8. Duman koşusu (bölüm 6, "Altın kaydın kör noktası")

Durum: **hazır, koşulmadı.** Gerçek koşu model çağrısı yapar. Kullanıcı onayıyla, H4.5'ten sonra ve canlı
kuruluma geçmeden önce yapılır. Önce aşağıdaki risk özeti kullanıcıya sunulur ve yalıtım adımına karar
verilir. Dosyalar `server/test/duman/` altında. Hiçbiri `.test.ts` ile bitmez,
`npm test` (`test/**/*.test.ts`) onları koşturmaz; tip denetimine girerler.

**Komutlar** (`apps/phone/server` içinde, `node --disable-warning=ExperimentalWarning` ile):
- `test/duman/kosu.ts --kuru`: Ne yapılacağını yazar. Salt okunur yoklama yapar (claude.exe, csc.exe,
  canlı boru adları). Hiçbir şey başlatmaz.
  Ayrıca `~/.claude` ve `~/.claude.json` iz ölçümünü salt okuma yapar ve iki anlık arasında taban farkı yazar.
- `test/duman/kosu.ts --sahte-claude`: Prova. Akış aynıdır, ama kaydedicinin arkasında `sahte-claude.ts`
  durur; model çağrısı yoktur. Servisin argv'si, ortamı ve stdin'i gerçektir; model çıktısı sahtedir.
  Sahte claude `--mcp-config`'teki köprüleri GERÇEKTEN başlatır (`initialize`, `tools/list`, köprünün
  `boru_baglandi` olayı). `init`'teki `mcp_servers` durumu bu el sıkışmanın sonucudur.
- `test/duman/kosu.ts --evet`: Gerçek koşu. Ek seçenekler: `--claude <exe>`, `--is-modeli-koru`,
  `--cikti <dizin>`, `--sakla`, `--izleri-sil`. Yarıda kalırsa `--temizle <belirteç>` (istenirse `--izleri-sil` ile).
  Argümanlar sıkı ayrıştırılır: bilinmeyen, yinelenen, değeri eksik ya da `-` ile başlayan değer ve birden çok
  kip hata verir (çıkış 2, hiçbir şey başlamaz). `--cikti` git çalışma ağacı, canlı veri kökü ya da `~/.claude`
  içindeyse reddedilir; kayıt jeton ve tam argv taşır.
- `test/duman/duzenek-sinama.ts`: Düzeneğin kendi sınaması. Model yok, canlı boru adı kullanılmaz. İçinde boru
  kuralı (tanınmayan biçimler dahil), kaydedicinin argv ve mcp kapalı başarısızlığı (süreçle), süreç içinde
  önyükleme ve denetim günlüğü, argümanlar (varsayılan çıktı yolu dahil), `sahte-claude.ts`'in içe aktarma
  güvenliği, iz raporunun gizliliği ve canlı günlük denetimi (yapay satırlarla) var.
- `test/duman/iz-olcum.ts`: İz ölçümünün tek başına hâli (bugünkü özet ve taban fark).
- `test/duman/canli-gunluk.ts`: Canlı servis günlüğündeki el sıkışma sayıları (salt okuma; bugünkü durum).
  `--kuru` aynı sayıları yazar.
- `test/duman/karsilastir.ts <kayit.json>`: Karşılaştırmayı yeniden koşar. `--oz-sinama` altından sahte bir
  kayıt üretir; önce "aynı" sonucunu, sonra on bozmanın her birinde farkı bekler. `--alanlar` ayrılan alanları
  listeler.

**Neden `ana.ts` doğrudan başlatılmıyor:** Canlı servis `\\.\pipe\eren-servis-tekil`, `eren-kopru` ve
`eren-ajanda` borularını tutuyor; adlar kaynakta sabit. İkinci örnek tekil kilitte `ikinci_ornek` ile çıkar.
Kilit boştaysa canlı borular alınır ve bekçi canlı servisi başlatamaz. Gateway ayrıca Tailscale adresinde
dinler ve uzak IP'yi denetler. Çözüm `src`'ye dokunmaz:
- `servis.ts`, `ana.ts` `giris`'in sırasını izler (ayar, kök izni, dış dünya, dizinler, tekil kilit, ek
  yedekli `servisKur`, `baslat`).
- Süreç `--import boru-yonlendir.ts?onek=<belirteç>` ile açılır. Önyükleme `\\.\pipe\eren-*` adlarını
  `eren-duman-<belirteç>-*` olarak değiştirir (`boru-kural.ts`). Bu belirteçle önekli ad olduğu gibi kalır.
  Başka her boru adı (başka uygulama, başka belirteç) reddedilir. Tanınmayan biçim de reddedilir: UNC
  (`\\localhost\pipe\eren-ajanda`), `\\?\UNC\`, `GLOBALROOT`, `\??\` ve adında `\` geçen boru
  (`..` ile canlı ada inebilirdi). Eski kural bunları "boru değil" sayıp dokunmadan geçirirdi. Kural iki katmanda uygulanır: `net` ve
  altındaki yerel `pipe_wrap` tanıtıcısı. Köprüler (`node kopru.ts`) aynı önyüklemeyi kaydedicinin mcp
  kopyasından alır. Önyükleme her sürecin bağlandığı, dinlediği ve reddettiği adı denetim günlüğüne yazar
  (`<kök>\boru\<pid>.jsonl`; jeton ve değer yazılmaz).
- Ağ `e2e/servis-giris.ts`'teki gibi sarılır: `127.0.0.1`, boş port.
- Bekçi ve Görev Zamanlayıcı kullanılmaz; kapanış stdin'den gelir.
- `LOCALAPPDATA` geçici köke çevrilir; canlı limit kilidi okunmaz.
- Veri kökü `kurulum/izin.ts`'in kuralıyla dar ACL'li oluşturulur. %TEMP%'ten kalıtılan izinlerle servis açılmaz.

**Kaydedici:** Servisin `claude_exe`'si geçici dizinde derlenen `baslatici.cs`'tir (.NET Framework `csc.exe`;
`ayar.ts` yalnız `.exe` kabul eder). Başlatıcı komut satırını yeniden tırnaklamaz, olduğu gibi
`kaydedici.ts`'e verir. Kaydedici argv'yi, cwd'yi, ortamı ve mcp dosyasının ham metnini kaydeder; ardından
stdin, stdout ve çıkış satırlarını yazar. Ortamdan yalnız anahtar adları kaydedilir. Değer yalnız
`CLAUDE_CODE_DISABLE_*`, `EREN_KIT_SERVIS_OTURUMU` ve `EREN_KIT_DATA_DIR` için yazılır; sızan bir anahtar fark
olarak görünür, değeri kayda girmez. Gerçek `claude`'a giden argv'de değişen iki şey var: `--model haiku` ve
köprülere önyükleme eklenmiş mcp kopyası. Servisin verdiği argv kayda değişmeden girer.
Kapalı başarısızlık: bir köprü sunucusu (`kopru.ts` ya da `EREN_KOPRU_JETON` geçen tanım) doğrudan
`node.exe … kopru.ts` biçiminde değilse kaydedici 91 ile çıkar ve gerçek `claude` hiç başlamaz. Aynısı mcp
metni ayrıştırılamazsa, dosya yoksa ya da `--mcp-config` birden çok verilmişse de olur. Önceden kopya
yapılamayınca köprü sessizce canlı boruya bağlanırdı. Aynı kapalı başarısızlık argv için de var (`argvDenetle`):
`--strict-mcp-config` ve `--setting-sources ""` tam bir kez olmalı. `=` biçimi ve çok değerli `--mcp-config`
reddedilir. Bu bayraklar olmazsa kullanıcının kancaları ve kullanıcı kapsamlı MCP'leri önyüklemesiz açılır;
`kanca.ts` canlı `eren-ajanda`'ya bağlanır. Bugünkü ana oturum ve PC hafif işi argv'si ikisini de taşır.
Standart PC profili `--setting-sources` taşımaz; duman onu koşmaz, koşsaydı 91 ile dururdu.

**Senaryo** (modele giden metin kısa ve kişisel veri içermez):
1. Mesaj gönderilir: "Merhaba. Bu bir bağlantı denemesi; tek kısa cümleyle cevap ver."
2. PC hafif işi başlatılır: servis stdin'ine komut gider, ardından depoya onaylı plan ve
   `isler.baslat(hafif)`. Plan modelden önerilmez. Ardından ana oturumun sentetik iş turu beklenir.
3. "Uzun bir şey anlat." gönderilir; ilk metin parçasında telefondan `interrupt` yollanır.

Sonra temizlik yapılır: servis kapatılır, komut satırında belirteç geçen süreçler öldürülür, geçici kök
silinir. Düzenek `~/.claude`'da yalnız `--izleri-sil` verilirse siler. Servisin kendi transkript silme portu
(ürün kodunda kökü gerçek `~/.claude/projects`, `ayar.ts` `claudeProjeleri`) duman servisinde sahtedir
(`servis.ts` `transkriptSar`): hiçbir şey silmez, çağrıyı sayar. Bu sayı raporda görünür. Silinen girdi koşudan önce olmamalı ve
adında belirteç ya da koşunun oturum kimliği geçmelidir. `~/.claude.json`'a hiç dokunulmaz. İz farkı (koşu
öncesi → kapanış → temizlik sonrası) `rapor.txt`'e yazılır. Kayıt ve rapor
`%TEMP%\eren-duman-sonuc-<belirteç>`'te kalır.

**Maliyet:** Ana oturum `haiku` ile koşar (`eren_modeli`). PC hafif işinin modeli serviste sabit `sonnet`;
kaydedici gerçek sürece `haiku` verir. Beklenen istek sayısı 4-7: mesaj 1, iş 1-3, sentetik tur 1-2,
yarıda kesilen tur 1. Kimlik denetimi `apiKeySource: none` istediği için koşu abonelik kotasından düşer.
Gerçek tutar ölçülür: rapor `result.total_cost_usd` toplamını ve istek sayısını yazar.

**Karşılaştırma** (`karsilastir.ts`):
- Altında karşılığı olan dört kayıt var. `baslatma.yeni_takvim` ile exe, argv (sistem istemi bayt bayt),
  cwd, ortam ve mcp karşılaştırılır. `konusma.kesme` ile insan ve kesme satırları, `konusma.sentetik_ve_birlesik`
  ile sentetik satırın biçimi, `isler.pc_hafif` ile argv (JSON şeması bayt bayt), ortam, `mcp.json` ve
  `gorev.txt` karşılaştırılır.
- Yöntem: gerçek değer önce altının sahte değerine eşlenir. Ardından H4.0 normalleştirmesi uygulanır
  (`normallestir`, `YerTutucular`). Son olarak iki tarafa da aynı kurallar uygulanır ve anahtar sırası dahil
  karşılaştırılır.
- Ayrılan alanlar (`--alanlar`): yollar, uuid, `request_id`, köprü jetonu, `--model`, damga, insan ve sentetik
  metin, ortamın Claude dışı kısmı, görev metni, işte `computer-use-windows` (düzenekte yok), stdout ve pid.
  Her birinin ayrı denetimi var: biçim, gönderilen metinle eşitlik, jetonların dolu ve farklı olması.

**Başarı ölçütü:** `SONUC: BASARILI` için altı koşul gerekir:
- (a) altınla AYNI,
- (b) bütün denetimler GECTI,
- (c) davranış denetimleri GECTI: init `apiKeySource: none`; `eren` ve `eren-ajanda` köprüleri yönlendirilmiş
  boruyla `connected`; mesaj turu `success`; kesilen tur `aborted_*`; iş `structured_output` dolu ve çıkış 0,
- (d) koşu hatası yok,
- (e) boru kanıtı GECTI. Üç bağımsız kaynak birbirini doğrular. Süreç listesinde her köprünün komut
  satırında `onek=<belirteç>` görünür. Denetim günlüğünde canlı ad alanına bağlantı 0, red 0 olur; köprüler
  duman `kopru` ve `ajanda` borularına bağlanır, duman servisi bağlantıyı kabul eder. Köprünün `boru_baglandi`
  olayı da gelir. Canlı servis duman jetonunu reddederdi, o yüzden bu olay ancak duman servisinden gelir.
- (f) canlı servis günlüğü denetimi GECTI (aşağıda, "Önyüklemesiz alt süreçler").

Ek olarak temizlik raporunda belirteçli süreç kalmamalı, duman boruları kapanmış olmalı ve canlı boru
listesi değişmemiş olmalı. Fark çıkarsa iki ihtimal var: ya altın kayıt sahte süreçte gerçekte olmayan bir
şeyi kaydetmiştir (kör nokta), ya da süreç sınırında (tırnaklama, ortam) bir kayıp vardır. Her iki durumda
fark ilgili dilimin girdisidir.

**Ölçülen (2026-11-28, prova, `--sahte-claude`):** Canlı servis açıkken akış baştan sona çalıştı.
Altınla AYNI çıktı, bütün denetimler GECTI. Stdin sırası: insan → sentetik → insan → kesme. Temizlikten
sonra süreç ve boru kalmadı. Bu sonuç servisin argv'sinin ve stdin'inin süreç sınırından bayt bayt geçtiğini
gösteriyor. Gerçek `claude`'un bu argv'yi kabul edip etmediğini ve çıktısının servisle uyuşup uyuşmadığını
göstermiyor; o soru gerçek koşuda yanıtlanır.

**Ölçülen (2026-11-28, ikinci prova, köprüler gerçek, belirteç `065ff5661de4`):** Canlı servis açıktı;
`eren-bekci`, `eren-servis-tekil`, `eren-ajanda` ve `eren-kopru` koşudan önce ve sonra yerindeydi.
- Sahte claude iki köprüyü başlattı: `eren` 7 araçla, `eren-ajanda` 3 araçla. İkisi de `connected` ve
  `boru_baglandi=true` döndü.
- Denetim günlüğü: canlı ad alanına bağlantı **0**, red 0. Duman borusuna köprü bağlantısı 2 (`kopru` 1,
  `ajanda` 1). Duman servisi iki bağlantıyı da kabul etti.
- Önyükleme dört süreçte yüklendi: servis, eşleştirme ve iki köprü.
- PC hafif işinin mcp'si köprüsüzdü (`{"mcpServers":{}}`), kaydedici onu `aynen` geçirdi.
- Altınla AYNI çıktı, bütün denetimler GECTI, `SONUC: BASARILI`.
- İz farkı: `~/.claude`'da bizim 0 girdi. Değişen 13 dosyanın hepsi canlı oturumlarındı: `projects` 6,
  `plugins` 4, `sessions` 2, `history.jsonl` 1. `~/.claude.json` değişmedi.

Kapalı başarısızlık `duzenek-sinama.ts`'te gösterildi (59/59 GECTI). Sarmalayıcı (`cmd /c`), adı değişmiş node
ve PATH'ten `node` ile kaydedici süreci 91 ile çıktı; gerçek claude yerine konan işaretçi betik hiç başlamadı.
Aynı gün argv denetimi, tanınmayan boru biçimleri, varsayılan çıktı yolu, iz raporu gizliliği ve canlı günlük
denetimi eklendi (100/100 GECTI). `--strict-mcp-config` ya da `--setting-sources ""` eksikken kaydedici süreci
91 ile çıktı. UNC biçimli bağlantı süreç içinde reddedildi. Bu eklerden sonra `--sahte-claude` provası
koşulmadı (derleme kilidi doluydu).

**Önyüklemesiz alt süreçler.** Önyükleme süreç başınadır: `--import` yalnız düzeneğin başlattığı süreçlerde
var, `NODE_OPTIONS` silinir. Modelin `--dangerously-skip-permissions` altında PowerShell ya da Bash ile
başlattığı bir `node` ya da `eren` süreci yönlendirilmez ve canlı borulara bağlanabilir. Denetim günlüğü bu
süreçleri görmez; "canlı boruya bağlantı 0" kanıtı yalnız önyüklemeli süreçleri kapsar. Bu süreçlerin ortamında
`EREN_KIT_DATA_DIR` ve `LOCALAPPDATA` duman köküne çevrilidir, jetonları duman servisinindir. Canlı servis
onları reddeder, ama bağlantının kendisi kurulur.

Bu yüzden koşu penceresinde CANLI servis günlüğü salt okunur (`canli-gunluk.ts`). Pencere duman servisinden
hemen önce açılır, temizlikten sonra kapanır.
- Kök: kalıcı `EREN_KIT_DATA_DIR` (`HKCU\Environment`) ve sürecin ortamı, `veri-koku.ts` kuralıyla. Bugün
  ikisi de aynı köke çıkıyor.
- Günlük: `<kök>\logs\servis.log` ve döndürülmüşleri `servis.<n>.log`. Önce `servis.log`, sonra numaralılar
  okunur. Okuma sırasında döndürme olursa bir satır iki kez sayılabilir; bu fazla sayımdır, temkinli yöndür.
- Dosya `readFileSync` ile açılır, hiçbir şey yazılmaz. libuv okuma, yazma ve silme paylaşımıyla açar.
- Satırlardan yalnız zaman, modül, olay ve rol alınır. Rapor yalnız olay, rol ve sayı yazar.
- Ölçüt: pencerede `el_sikisma_ret` 0 olmalı. `eren`, `ana_oturum`, `soru`, `telefon` ya da bilinmeyen
  rolde `el_sikisma` da 0 olmalı.
- `pc_oturumu` ve `pc_kanca` bilgi olarak yazılır. Bunlar canlı Claude Code oturumlarıdır ve gün boyu bağlanır;
  duman ortamında bu rollerin anahtarı yoktur.
- Atfetme yoktur. Pencerede canlı taraftan bir ret gelirse ya da telefon kullanılırsa koşu başarısız olur;
  bu yanlış alarmdır ve koşu yinelenir.
- Kapsam dışı: el sıkışmadan, süre dolmadan kapanan sessiz bir bağlantı. Açık kalan sessiz bağlantı
  `sure_doldu` reti olarak görünür.

Bugünkü sayılar (2026-11-28, `--kuru`): 1 günlük dosyası, toplam 159 el sıkışma, son 24 saatte 41, son
1 saatte 3.
- `el_sikisma`: `eren` 84 (24 sa 6), `pc_oturumu` 24 (24 sa 24, 1 sa 3), `telefon` 21, `soru` 14,
  `ana_oturum` 11 (24 sa 6), `pc_kanca` 1.
- `el_sikisma_ret`: 4, hepsi son 24 saatte ve rolsüz.
Yanlış alarm olasılığı bu hızlardan kabaca kestirilebilir. Son 24 saatte ölçüte giren olay 16'ydı: ret 4,
`eren` 6, `ana_oturum` 6. Olaylar düzgün dağılsaydı 10 dakikalık bir pencerede en az biri için olasılık
yaklaşık %10 olurdu. Telefonla konuşulurken bu olaylar kümelenir. Bu bir kestirimdir, ölçülmedi. Koşu
sırasında telefondan konuşmamak yanlış alarmı azaltır.

**İzler** (`--evet`; gerçek `claude` 2.1.332, yalıtımsız). Fark adımı (`iz-olcum.ts`) koşu öncesinde,
kapanıştan sonra ve temizlikten sonra salt okuma anlık alır. `~/.claude` için her girdinin göreli yolu, boyutu
ve değiştirilme zamanı alınır, dosya içeriği okunmaz. `~/.claude.json` için üç düzeye kadar anahtar yolu alınır;
değerler yalnız bellekte sha256 ile karşılaştırılır, rapora yazılmaz. Ev dizini raporda `~` olur. Adında
belirteç ya da koşunun oturum kimliği geçen girdi "bizim", ötekiler "başka" sayılır. Canlı oturumlar aynı anda
yazar; taban ölçümde 3 sn'de `projects/` altında 2-3 değişen dosya görüldü.

Bilinenler (kaynak: ölçüm ya da var olan kayıt):
- `~/.claude.json`: üst düzey sayaç ve damga anahtarları değişir; `projects` altına geçici cwd'ler için girdi
  eklenir: ana oturum için veri kökündeki `eren-cwd`, iş için `<kök>\proje` (ikisi de belirteci taşır). Yazımla birlikte `~/.claude/backups/`
  altına `.claude.json.backup.<ms>` düştü (bugün 149 girdi). Ölçüm (2026-11-28, `CLAUDE_CONFIG_DIR` geçici dizinde,
  `claude auth status`): model çağrısı olmadan bile `.claude.json` (304 bayt) ve `backups/` yazıldı.
- `~/.claude/projects/<cwd'nin adı>/<oturum>.jsonl`: oturum dökümleri. Ana oturum, `--resume` ile yeniden
  başlama ve iş için ayrı dosyalar yazılır. Ad belirteci taşır, `--izleri-sil` bunları siler.
- `~/.claude/session-env/<oturum>`: oturum başına dizin. Bugün 942 girdi var, adı oturum kimliğidir.

Doğrulanmadı (bu sürümde yazılması olası; fark adımı gösterir):
- `~/.claude/shell-snapshots/` (Bash ya da PowerShell aracı kullanılırsa), `file-history/<oturum>` (dosya
  düzenlenirse), `todos/`, `paste-cache/`, `telemetry/` ve `statsig/` olay kuyruğu, `sessions/`, `ide/`.
- `~/.claude/projects/<ad>/<oturum>/` altında `tool-results/` ve `subagents/`.
- `~/.claude/.credentials.json`: süre dolmuşsa OAuth yenilemesi yazar. Canlı oturumlar da yazar; yenileme
  belirteci dönüşümlüyse eşzamanlı yenileme canlı oturumları etkileyebilir.
- `~/.claude/plugins/`: `--setting-sources ""` kullanıcı ayarını, dolayısıyla eklentileri kapatmalı.
- `~/.claude/history.jsonl`: yalnız etkileşimli kipte yazılması beklenir.
- `~/.claude` dışı: `%TEMP%` altında claude'un geçici dosyaları (TEMP çevrilmez). `%LOCALAPPDATA%` geçici
  köke çevrili, MCP günlükleri ve önbellekler oraya düşer ve silinir. Bu çevirinin girişi etkilemediği
  ölçülmedi; etkilerse init reddedilir ve koşu ilk mesajda durur.
- Ana oturumun açılışta model çağrısı yapıp yapmadığı.

**Yalıtım (`CLAUDE_CONFIG_DIR`).** Ölçüldü (2026-11-28, model çağrısız; `claude --version`, `--help`,
`auth status`, boş geçici dizin):
- `CLAUDE_CONFIG_DIR=<geçici>` ile `auth status` `configDirectory` ve `projectsDirectory` değerlerini geçici
  dizinde gösterdi.
- `.claude.json` `~` yerine `<geçici>\.claude.json`'a yazıldı, `backups/` da oraya.
- `~/.claude.json` değişmedi. `~/.claude`'da yalnız canlı oturumların `projects/` dosyaları değişti.
- `loggedIn: false` döndü: giriş bilgisi de yapılandırma dizininden okunuyor.
- İkili dosyada ayrı bir `CLAUDE_SECURESTORAGE_CONFIG_DIR` var. Kodda bu değer boş dize ise `~/.claude`'a düşüyor,
  tanımsızsa `CLAUDE_CONFIG_DIR`'e. Bu, giriş `~/.claude`'da kalıp geri kalan her şeyin geçici dizine gitmesi
  demektir. Çalışma anında DOĞRULANMADI. Doğrulamak `.credentials.json`'ı okutmayı (ve belki yenilemeyi)
  gerektirir; bu turda bu yüzden yapılmadı.
- Servis çocuk ortamından `CLAUDE*`/`ANTHROPIC*` anahtarlarını siler (`ayar.ts`). Yalıtım ancak kaydedicide
  uygulanabilir: kaydedici gerçek sürecin ortamına ekler, kayda servisin ortamı girer. Ürün koduna dokunulmaz.
- `--no-session-persistence` var ama kullanılamaz: ana oturum `--resume` ile yeniden başlar.

Öneri: `--evet` koşusunun ilk ve iptal edilebilir adımı. Kaydedici gerçek ortama `CLAUDE_CONFIG_DIR=<kök>\claude`
ve `CLAUDE_SECURESTORAGE_CONFIG_DIR=""` koyar. İlk süreç `init`'te `apiKeySource: none` ile girişli gelmezse
koşu ilk model isteğinden önce durur; kayıt "yalıtım girişsiz" yazar. İz farkı `~/.claude`'da bizim 0 girdi
göstermeli. Giriş bilgisi kopyalanmaz, bu bir sır kopyası olurdu. Bu adım henüz yazılmadı ve kullanıcı onayına bağlı.

**Kullanıcıya sunulacak risk özeti (`--evet`'ten önce):**
- **Ne çalışır:**
  - Geçici veri kökünde ayrı bir duman servisi (node). Canlı servisten ayrı borular kullanır, 127.0.0.1'de
    boş porta bağlanır.
  - Gerçek `claude.exe` (2.1.332) 2-3 süreç: ana oturum ve PC hafif işi.
  - Köprüler: 2-3 `node kopru.ts`.
  - Düzeneğin içinde bir sahte telefon.
  - Bir kez `csc.exe` derlemesi.
  - Bekçi, Görev Zamanlayıcı ve canlı servis kullanılmaz.
- **Hangi izinle:** Kullanıcı hesabıyla çalışır, yönetici yetkisi yoktur.
  - Ana oturum `--dangerously-skip-permissions` ile açılır. Araçları `--tools` ile PowerShell, Read, Edit,
    Write, Glob, Grep, WebFetch ve WebSearch'tür.
  - **PC hafif işi kullanıcının hesabında `--dangerously-skip-permissions` ile çalışır.** `--disallowedTools`
    yalnız 20 işe yaramaz aracı çıkarır. Bash, PowerShell, Read, Write, Edit, WebFetch ve alt agent açık kalır.
  - cwd geçici dizindir, ama araçlar dosya sisteminde cwd ile sınırlı değildir. **Araç kullanımını yalnız
    istem sınırlar:** "Hicbir arac kullanma, hicbir dosyaya dokunma".
  - Sınırlama olanağı (yapılmadı, ürün koduna dokunmadan): kaydedici `--model` gibi gerçek argv'ye
    `--tools ""` ekleyebilir. Kayıt servisin argv'sini tutar, altın karşılaştırması bozulmaz. Bunun bedeli,
    gerçek koşunun ürünle aynı araç kümesini sınamamasıdır.
- **Model ve çağrı:** Model `haiku`'dur. Ana oturumda `eren_modeli`, işte kaydedici `sonnet` → `haiku` yapar;
  `--is-modeli-koru` verilirse iş `sonnet` ile koşar. Beklenen 4-7 istek: mesaj 1, iş 1-3, sentetik tur 1-2,
  kesme 1. Ücret abonelik kotasından düşer (`apiKeySource: none`). Rapor gerçek `total_cost_usd`'yi yazar.
- **Ne yazılır:**
  - Geçici kök `%TEMP%\eren-duman-<b>` (silinir).
  - Çıktı `%TEMP%\eren-duman-sonuc-<b>` (kalır). Jeton ve tam argv taşır, depo dışındadır.
  - Yukarıdaki "İzler".
  - Düzenek canlı veri köküne ve canlı limit kilidine yazmaz. Düzeneğin başlattığı süreçler (servis,
    eşleştirme, köprüler) önyüklemeyle canlı borulara bağlanamaz.
  - **Bu, modelin başlattığı süreçleri kapsamaz.** Ana oturum ve PC hafif işi `--dangerously-skip-permissions`
    ile koşar. Modelin PowerShell ya da Bash ile başlattığı bir `node` ya da `eren` süreci önyüklemesizdir ve
    canlı borulara bağlanabilir. Araçlarla canlı veri köküne de yazabilir. Bunu yalnız istem sınırlar.
    Ortamları duman köküne çevrili olduğu için canlı servis onların jetonlarını reddeder. Bağlantı canlı servis
    günlüğünde `el_sikisma_ret` olarak görünür ve koşu başarısız sayılır ("Önyüklemesiz alt süreçler").
    Sessiz bir bağlantı ya da doğrudan dosya yazımı bu denetimde görünmez.
  - Servisin transkript silme portunun kökü üründe gerçek `~/.claude/projects`'tir. Port yalnız oturum
    UUID'leriyle siler ve senaryo onu tetiklemez. Duman servisinde bu port sahtedir: silmez, sayar. Bu yüzden
    `~/.claude`'daki her silme yalnız `--izleri-sil` ile olur. Bedeli, bu silme yolunun gerçek dosya sisteminde
    dumanla sınanmamasıdır; birim testi sınıyor (`dis-dunya.test.ts`, "transkript.sil").
  - Gerçek `claude`, `~/.claude.json`'ı canlı oturumlarla aynı anda yeniden yazar. Yarışta canlı bir oturumun
    yazımı kaybolabilir. Claude Code'un bu dosyada kilit ya da birleştirme yapıp yapmadığı DOĞRULANMADI.
    Kayıp sayaç, proje ayarı ya da izin olabilir. Yalıtım (`CLAUDE_CONFIG_DIR`) bu yarışı ortadan kaldırırdı.
- **Nasıl geri alınır:**
  - Süreçler: `kosu.ts --temizle <b>`.
  - `~/.claude` izleri: `--izleri-sil`.
  - `~/.claude.json` geri yüklenmez, çünkü canlı oturumların yazdığını ezerdi. Koşunun eklediği `projects`
    girdileri raporda listelenir, istenirse elle silinir. Başka oturumların değişen anahtarları raporda yol
    olarak yazılmaz; yalnız üst anahtar başına sayı yazılır (proje yolları kalıcı `rapor.txt`'e düşmesin).
  - Değişen sayaçlar ve harcanan kota geri alınmaz.
