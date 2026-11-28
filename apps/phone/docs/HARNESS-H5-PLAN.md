# H5 dilim planı: metinler (harness etiketi ve yetenekten üretilen yazılar)

Durum: **plan, onay bekliyor.** Kod bu plan onaylanınca başlar. Çerçeve `HARNESS.md` (2.5, 4.4, 7) ve
`HARNESS-H4-PLAN.md`. Döküm bu daldaki koda göredir (`be568d2`, 2026-11-28); satır numarası verilmez, adlar
geçerlidir. Kod bu belgeyle çelişirse kod kazanır.

---

## 1. Özet

- **Ne yapılıyor:** Modele giden istem metinlerinde ve telefonda Claude'a özgü kalan yazılar tek bir
  kaynaktan üretilir: sürücünün **etiketi** (görünen ad) ve **yetenek beyanı** (hafif profil, sentetik satır
  işareti, kimlik politikası, maliyet türü). Claude Code kurulumunda her metin bayt bayt bugünküyle aynı kalır.
- **Ne yapılmıyor:** İkinci sürücü (H6) yok. Varsayılan asistan adı ve `ANA_SOHBET_ADI` değişmez. Bağlayıcı
  metinleri (`pcTurNotu`, PC anahtar metinleri, `eslestir` teşhisi) H2/H3'te uyarlayıcıya bağlandı; H5 onlara
  dokunmaz. Kota pencereleri (`bes_saat`/`haftalik`) H4'ün yetenek beyanıyla zaten gizlenebilir. Ajanda
  uygulaması değişmez. Protokol sürümü artmaz.

## 2. Döküm

Sınıflar: **E** sürücü etiketinden, **Y** yetenek beyanından üretilmeli; **P** protokol alanı gerektirir;
**S** sabit kalır (ad ya da göç verisi); **K** başka dilimde kapandı.

| Yer | Metin ya da alan | Bugün neyi varsayıyor | Sınıf |
|---|---|---|---|
| `protocol/src/plan.ts` `IS_PROFILI_ACIKLAMASI` (`PlanOnerGirdi.profil` açıklaması; köprü JSON Schema'ya koyar) | "kullanıcı ayarları, hook'lar ve eklentiler yüklenmez, model sonnet" | Claude'un hafif profili (`--setting-sources ""`, `HAFIF_PC_MODELI`) | Y |
| `server/src/kopru.ts` `ARAC_ACIKLAMALARI.plan_oner` | "hafif: … kullanıcı ayarları, hook'lar ve orkestra yüklenmez" | Aynı hafif profil; dökümde yoktu | Y |
| `server/src/konusma-metin.ts` `sonIstem` (sistem istemi, 8 birleşim) | `Başında "[MESSAGE FROM NON-USER SOURCE - NOT USER INPUT]" olan mesaj … servistendir` | Bu öneki servis yazmaz; Claude Code `isSynthetic:true` satıra koyar (`MODULLER.md`) | Y (sürücünün sentetik satır biçimi) |
| `konusma-metin.ts` `initReddiMetni` | "(abonelik dışı kimlik)" | Claude kimlik politikası (`apiKeySource === "none"`) | Y |
| `konusma-metin.ts` geri kalanı (`basIstem`, plan, çit, kısayol, devir, kurtarma, `yenidenBasladiMetni`) | Ad `Ayar.asistanAdi`'den; MCP araç adları | Harness'tan bağımsız; 2000 karakter bütçesi (K5) | S |
| `app/src/ekranlar/DurumEkrani.tsx` Tüketim notu | "Maliyet, Claude Code'un liste fiyatıyla hesapladığı yaklaşık değerdir; abonelikte ayrıca ödenmez…" | Harness Claude Code, ücret abonelik | E + Y, telefon bilmez → P |
| `DurumEkrani.tsx` "5 saatlik limit", "Haftalık limit", "Kullanım limiti dolmak üzere." | `ServerStatus.limit` yoksa satırlar gizli | Claude pencereleri; alan isteğe bağlı | K (H4 `kotaPencereleri`) |
| `DurumEkrani.tsx` `tuketimAlt` "önbellek yazma/okuma" | `TuketimToplami.cache_*` | Anthropic kullanım modeli; başka sağlayıcıda 0 | S |
| `protocol/src/sohbet.ts` `ServerStatus.limit`, `TuketimToplami` | Alan adları | Kapalı şema (`strictObject`) | S (değişmez) |
| `protocol/src/sohbet.ts` `ANA_SOHBET_ADI = "Claude"`, `server/src/ana-sohbet-adi.ts`, `app/src/cekirdek/sohbetler.ts` | `ana` sohbetinin ilk adı | Göç verisi | S (4.4) |
| `app/src/asistanAdi.ts`, `app.config.ts`, `platform/asistanAdi.ts`, `ekranlar/baglantiDurumu.ts`; `server/src/ayar.ts` `VARSAYILAN_ASISTAN_ADI`; `packages/bellek` `asistan.py` | Varsayılan ad "Claude" (üç kopya, aynı temizleme kuralı) | `EREN_KIT_ASSISTANT_NAME` ile değişir | S (soru 1) |
| `protocol/src/ajanda-pc.ts` `PC_TUR_NEDENI_METNI`, `pcTurNotu`; `kopru.ts` PC anahtar metinleri | "Claude Code bu çağrının kimliğini…", teşhis komutu | Uyarlayıcı adına göre seçiliyor (`claude-code`/`codex`) | K (H3) |
| `protocol/src/ajanda-pc.ts` `PC_ZAMAN_EKI` | "Alt agent'ın eklediği kayıt taslak doğar" | Codex'te her kayıt zaten taslak; cümle yine doğru | S |
| `server/src/eslestir.ts` `KULLANIM`, teşhis, `CLAUDE_CODE_GORUNUMU` | Claude Code kanca teşhisi | `PcAjanGorunumu.gorunenAd`; Claude metinleri yalnız kancalı ajanın dalında | K (H2/H3) |
| `kopru.ts` kullanım satırı; `ayar.ts` `ClaudeLimitKilit` yolu; `isler-rapor.ts` `[limit-kilit]` | CLI yardımı, dış aracın disk yolu | Ad, metin değil | S |
| `kilit.ts`, `bildirim.ts` limit kilidi notları; `isler-komut.ts` görev ve telefon güvenlik metni | "Limit kilidi aktif…", görev notu | Harness'tan bağımsız | S |
| `protocol/src/rapor.ts`, `ajanda-arac.ts`, `ajanda-pc-kanca.ts` | Yorumlar, `CLAUDE_CODE_*` ortam adları | Bağlayıcı kodu, metin değil | S |
| `apps/ajanda/**` (Kotlin, Rust) | "Asistan", "PC oturumu" | Harness adı yok | S |

Telefona harness adı ya da model adı giden bir alan bugün yoktur.

## 3. İlke

- **Etiketten (E):** Kullanıcıya harness'ı adıyla anan yazı. Bugün yalnız telefondaki maliyet notu. Ad şablona
  **eksiz** girer (Türkçe ek uyumu addan bağımsız kalsın; `basIstem`'deki kural). Claude için bugünkü cümle sabit
  bir tablodan gelir, şablondan değil: "Claude Code'un" eki korunur.
- **Yetenekten (Y):** Harness'ın davranışını anlatan cümle. Sürücü bir `SurucuMetinleri` kaydı verir:
  - `hafifProfil: { profilAciklamasi, aracAciklamasi } | null`: `IS_PROFILI_ACIKLAMASI` ile `plan_oner`
    açıklamasının hafif cümleleri. `null` olunca (sürücüde `pc_hafif` yok) cümleler düşer; `profil` alanı şemada
    kalır, ayrıştırma değişmez.
  - `sentetikIsareti: string | null`: sistem istemindeki "Başında … olan mesaj servistendir" cümlesinin öneki.
    Claude'da bugünkü önek; başka sürücüde, önek servisin `sentetikSatir`'ından (H4.3) gelir.
  - `kimlikReddiNedeni`: `initReddiMetni`'nin parantezi. Claude'da "abonelik dışı kimlik".
  - `maliyet: "liste_fiyati_abonelik" | "ucret" | "yok"`: telefon notunun türü. Claude'da ilki.
- **Değişmeyen (S):** `ANA_SOHBET_ADI`, üç varsayılan asistan adı, protokol alan adları, CLI bayrak adları
  (`--claude-code` takma adı), disk yolları, bağlayıcı modülleri. Metinlerin geri kalanı zaten geneldir.
- **Protokol:** Servis protokolünde sürüm artmaz. Yalnız H5.4 telefon için isteğe bağlı bir alan ekler; bu alan
  bugünkü `etkinlik1`/`medya1` deseninde yeni bir yetenek jetonuna (`motor1`) bağlanır. Jeton istemeyen eski APK
  alanı hiç görmez, kapalı şemadan da geçer. `SOHBET_SURUMU` ve `PROTOKOL_SURUMU` aynı kalır. H5.1–H5.3 yalnız
  servisin ve köprünün içindedir.
- **Telefon:** Yalnız H5.4 yeniden derleme ister. H5.1'deki `protocol/src/plan.ts` değişikliği telefon paketine
  girer ama telefon bu metni kullanmaz; eski APK aynı davranır, derleme gerekmez.

## 4. Dilimler

Ortak kurallar: Her dilim tek commit'tir, main'e tek başına girebilir, revert'le geri alınır. Kalıcı biçim
değişmez. `npm run typecheck` ve server, protocol, app testleri yeşil kalır. H4.0 altın kayıtları
(`server/test/altin/claude-*.json`: sistem istemi 8 birleşim, mcp dosyaları, init reddi notu) **hiç**
yeniden yazılmaz. Kaydı değiştiren commit davranış değişikliğidir ve H5'e girmez.

**H5.0 Köprü araç tanımlarının altın kaydı (yalnız test).**
- Kapsam: H4.0'da olmayan yüzey kayda geçer: her köprü rolünün `tools/list` çıktısı (ad, `description`,
  `inputSchema`, anahtar sırası dahil). Ek olarak `IS_PROFILI_ACIKLAMASI` bugünkü metne eşitlik testiyle
  sabitlenir. `src`'ye dokunulmaz.
- Dosyalar: yeni `server/test/kopru-altin.test.ts` ve `server/test/altin/kopru-araclar.json`. Aynı
  `EREN_ALTIN_YAZ` düzeni kullanılır.
- Telefon: derleme yok. Ortak dosya: yok (`kopru.ts` okunur, değişmez). Büyüklük: küçük.

**H5.1 `SurucuMetinleri` ve Claude kaydı (bağlanmadan).**
- Kapsam:
  - `sozlesme.ts`'nin H4.1 bölümüne yalnız ekleme: `SurucuMetinleri` tipi ve `OturumSurucusu.metinler`.
  - `surucu-claude.ts`'e Claude değerleri yazılır.
  - `protocol/src/plan.ts`: saf `isProfiliAciklamasi(hafif)` ve `planOnerGirdiKur(aciklama)` eklenir.
    `IS_PROFILI_ACIKLAMASI` ve `PlanOnerGirdi` dışa aktarımı kalır, ikisi de Claude kaydından türer.
- Bayt bayt: Claude kaydından üretilen her metin bugünkü sabite eşittir. `null` dallarının uzunluğu ve sistem
  istemi bütçesi (2000 karakter, 40 karakterlik ad) test edilir. Çalışma anında yeni kodu çağıran yoktur.
- Sınama: eşitlik testleri; H4.0 ve H5.0 aynı kalır.
- Telefon: derleme gerekmez. Ortak dosya: `sozlesme.ts` (Kol C, H4.1). Büyüklük: küçük.

**H5.2 Sistem istemi ve init reddi sürücüden.**
- Kapsam:
  - `sistemIstemi` sentetik işaret cümlesini parametreyle alır; `SON_ISTEMLER` önbelleği işarete göre
    kurulur. `initReddiMetni(asistanAdi, neden)` olur.
  - `konusma.ts` iki çağrıda `surucu.metinler`'i verir; çağrılardan biri `initDenetle`'nin içindedir.
- Bayt bayt: sistem istemi (8 birleşim, kimlik ekli ve eksiz), init reddi `system_notice` metni.
- Sınama: H4.0 `claude-baslatma.json` ve `claude-konusma.json` değişmeden geçer. `konusma-metin.test.ts`'in
  sabitleri (`NON_USER_BASLIGI`) aynı kalır. İşaretsiz sahte sürücüyle cümlenin düştüğü ve bütçenin
  aşılmadığı gösterilir.
- Telefon: derleme gerekmez. Ortak dosya: `konusma.ts` (H4.4 ve Kol C). Büyüklük: küçük.

**H5.3 Köprü araç tanımları sürücüden.**
- Kapsam:
  - `kopru.ts`'e isteğe bağlı `--surucu <ad>` bayrağı gelir. Bayrak yoksa değer `claude` olur.
    Bilinmeyen ad başlangıçta reddedilir; `--uyarlayici` kuralı gibi, sessizce varsayılana düşmez.
  - `plan_oner`'in açıklaması ve `profil` şeması o sürücünün kaydından kurulur (`planOnerGirdiKur`).
  - Claude sürücüsü eren mcp dosyasına bayrak **eklemez**. Bayrağı yalnız Claude dışı bir sürücü yazar (H6).
- Bayt bayt: H5.0 `kopru-araclar.json` ve H4.0 (a)'nın mcp dosyaları değişmez.
- Sınama: H5.0 aynı kalır; bayraklı sahte sürücüde hafif cümleleri düşer; bilinmeyen ad reddedilir.
- Telefon: derleme gerekmez. Ortak dosya: `kopru.ts`. Bugün paralel kollar (H3 tabloları, işlem sonrası hata
  yolu) aynı dosyada çalışıyor; birleştirme sırasına koordinatör karar verir. Büyüklük: küçük.

**H5.4 Telefon maliyet notu (P; telefon derlemesi).**
- Kapsam:
  - `protocol/src/sohbet.ts`: `SOHBET_YETENEKLERI.MOTOR = "motor1"` eklenir. `ServerStatus`'a isteğe bağlı
    `motor: { ad, maliyet }` alanı yalnız ekleme olarak girer.
  - `gateway.ts` alanı yalnız `motor1` isteyen bağlantıya yazar. Motor yoksa (H4.8) alan da yoktur.
  - Telefon jetonu ister. Not metni saf bir modülden gelir (`ekranlar/tuketimMetni.ts` yanına):
    - alan yoksa ya da `{ad:"Claude Code", maliyet:"liste_fiyati_abonelik"}` ise bugünkü cümle;
    - `ucret` ise eksiz şablon;
    - `yok` ise not gösterilmez.
- Bayt bayt: Jetonsuz bağlantıya giden `server_status` aynıdır. Claude'da telefonda görünen cümle aynıdır;
  eski APK + yeni servis ve yeni APK + eski servis bugünkü cümleyi gösterir.
- Sınama: protocol şema testleri (eski şema yeni çerçeveyi jetonsuz kabul eder); gateway jeton testi; app'te
  not modülünün dört durumu; `yapisal.test.ts`.
- Telefon: **yeniden derleme ve kurulum gerekir.** Yalnız koordinatörde ve kullanıcı onayıyla yapılır.
  Servis önce girebilir, alanı jetonsuz telefona yazmaz. Ortak dosya: `protocol/src/sohbet.ts`, `gateway.ts`
  (Kol C). Büyüklük: orta.

## 5. Sıra ve H4 ile bağımlılık

```
H5.0 (hemen; bağımsız)
H4.1 ─► H5.1 ─► H5.3            (H5.3 ayrıca H4.2: eren mcp dosyasını sürücü yazıyor olmalı)
H4.4 ─► H5.2                    (H5.1'den sonra)
H5.4: H5.1'den sonra; öneri H6 ile birlikte (soru 2)
```

- **H5, H4'e bağlıdır.** `SurucuMetinleri`'nin yeri H4.1'in `OturumSurucusu`'dur. H5.2 ve H5.3, H4.2'nin
  `surucu` enjeksiyonunu ister. H5.2 `initDenetle`'ye dokunur ve bu fonksiyonu H4.4 yeniden yazar; çakışmasın
  diye H5.2 H4.4'ten sonra gelir. İstenirse `metinler` alanı doğrudan H4.1'e eklenir ve H5.1 küçülür; buna
  koordinatör karar verir.
- H5.0, H4'ten bağımsızdır ve hemen girebilir. Kayıt, değişiklikten önceki koddan alınmalıdır.
- H4'süz bir yol da vardır ama önerilmez: metinler parametre olarak elle geçirilir. Bu iş H4.2'de ikinci kez
  yapılır.

## 6. Kullanıcıya sorulacaklar

1. **Varsayılan asistan adı "Claude" kalsın mı?** Ad üç yerde tanımlı: telefon, servis ve `packages/bellek`.
   `ANA_SOHBET_ADI` de göç verisindedir. Öneri: kalsın. Başka harness kullanan kişi
   `EREN_KIT_ASSISTANT_NAME` verir. Değiştirmek yeni kurulumda `ana` sohbetinin adını ve telefon derlemesini
   etkiler.
2. **Telefon dilimi (H5.4) şimdi mi, H6 ile mi?** İkinci sürücü gelene kadar telefonda görünen fark yoktur.
   Öneri: H6 ile birlikte yapılsın, APK bir kez kurulsun.
3. **Maliyet notunun `ucret` dalı:** Bu dal H4 planı bölüm 5'teki soruya bağlıdır: başka harness'ta API
   anahtarı kabul edilecek mi? Cevap "hayır" ise `ucret` dalı yazılmaz.

## 7. Riskler

- **Sistem istemi bütçesi:** Claude dışı bir işaret cümlesi 2000 karakterlik sınırı aşabilir. H5.2'nin testi en
  uzun birleşimi sürücü kaydıyla ölçer.
- **Türkçe ek:** Ad değişince "X'un/'ün" eki bozulur. Şablonlar eksizdir, Claude cümlesi tablodan gelir.
- **Altın kapsamı:** H5.0'dan önce köprü araç tanımları hiçbir testle sabit değildir. H5.3, H5.0'sız
  başlamamalıdır.
- **Ortak dosyalar:** `kopru.ts`, `konusma.ts`, `sozlesme.ts` ve `sohbet.ts` başka kollarla ortak. Her dilim
  küçük tutulur, sırası koordinatörden gelir.
- **Doğrulanmadı:** `[MESSAGE FROM NON-USER SOURCE …]` önekini Claude Code'un eklediği yalnız `MODULLER.md`'deki
  kayıttan biliniyor; bu dökümde yeniden ölçülmedi. Başka harness'ın sentetik satırı nasıl işaretlediği H6'nın
  ölçüm işidir.
- **Telefon kurulumu:** H5.4 eski APK ile uyumludur, ama kurulum kullanıcı onayı ister. Servis tek başına
  girerse jetonsuz telefonda hiçbir şey değişmez.
