# eren-kit telefon: ölçümler

Tarih: 2026-11-06. Claude Code 2.1.319, Windows 11 (26200), Node 24 (masaüstü ölçümünde 24.14.1), abonelik girişi (`apiKeySource: none`). Modeller: `claude-sonnet-5-5`, tuzak testinde ayrıca `claude-opus-5-5`. Çalışma modeli ana oturum için Opus'tur; Opus bağlam penceresi 1.000.000 (`contextWindow`), ilk tur toplam giriş 1246; küçük bir turla ölçüldü (aşağıda). Ölçümlerin çoğu SSH/session 0'da yapıldı; belirtilen yerler hariç. Her satır tek ölçümdür, tekrar yoktur. Bu sayılar güvenlik kanıtı değildir (`GUVENLIK.md`).

## 1. Ana oturum süreci (Sonnet ile, 38 başlatma)
- Çok tur çalışır: tek süreçte 4 tur; girdi biçimi `content` düz metin, dizi ve `session_id` + `parent_tool_use_id:null` ile üçü de kabul edildi. Boşta 200,1 sn ve 720 sn beklemede süreç canlı kaldı, MCP sunucusu aynı PID ile cevap verdi; daha uzun boşluk ölçülmedi.
- `system/init` ilk stdin mesajından önce gelmez ve her turda yeniden gelir (8. denemede 11 init, 11 result). Hazırlığı `init` ile beklemeyin; `control_request` `initialize` çalışır ama araç listesi vermez.
- İlk tur giriş tokeni (`input + cache_creation + cache_read`; `get_context_usage.totalTokens` ile bire bir aynı):

| Düzen | Giriş token |
|---|---|
| varsayılan ayarlar, `C:\` | 52.563 |
| `--setting-sources ""` | 30.014 |
| + `--system-prompt` | 27.825 |
| `--tools "" --strict-mcp-config`, varsayılan ayarlar, `C:\` | 24.342 |
| aynısı, temiz klasör | 16.884 |
| tam aday bayraklar, `C:\` | 8.967 |
| tam aday, tuzak klasör (cwd'de büyük `CLAUDE.md`, `AGENTS.md`, `.mcp.json`, hook) | 1.355 |
| tam aday + `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` + `--disable-slash-commands` | 1.272 |

- `--setting-sources ""` kullanıcı `CLAUDE.md` dosyasını ve hook'ları kapatır ama otomatik hafıza `MEMORY.md`'yi (7570 token) kapatmaz; hafıza cwd'ye bağlıdır, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` gerekir. Varsayılan ayarlarda 12 hook olayı yüklenir. Tuzak klasörde cwd'deki hiçbir dosya yüklenmedi ya da çalışmadı.
- Dağılım (`--setting-sources ""`, 30.014): sistem istemi 2411, sistem araçları 13621, MCP talimatları 717, hafıza 7570, skills 2281, messages 3414. Ertelenmiş araçlar toplama girmez. En küçük kolda sistem istemi 30, MCP araçları 64, messages 1261 token; `--system-prompt` bağlamı tam boşaltmaz (~1,2 bin token ek kalır). 1355 ile 1272 arasındaki 83 token farkın kaynağı ayrılmadı.
- `--tools "PowerShell,Read,Edit,Write,Glob,Grep,WebFetch,WebSearch"` (2026-11-09, Sonnet, gerçek `claude`): mevcut bayraklara eklenince ilk istek 29.298 → 14.365 token; 33 yerleşik araç tanımının büyük kısmı (yalnız Workflow 22.389 karakter) gitti. MCP araçları (`mcp__eren__*`, computer-use) etkilenmedi. Ham veri depoda değil.
- Bağlam doluluğu: `dolu` = son `assistant` mesajının `usage` içindeki üç giriş alanı toplamı; `pencere` = `result.modelUsage.<model>.contextWindow`. Örnek: 1720 / 1.000.000 = %0,17; `get_context_usage` aynı 1720'yi verir. `result.usage` doluluk değildir (turdaki API çağrılarının toplamı: 3359'a karşı gerçek 1720). `percentage` tam sayıya yuvarlanır (0 gelir). Aynı `message.id` birden çok `assistant` satırında gelebilir; sonuncu alınır.
- Sonnet penceresi 1.000.000; %50 eşiği 500.000 token eder. Otomatik sıkıştırma tamponu 33.000 (yaklaşık %96,7'de devreye girer). `/compact` çalıştı, sonrasında konuşma sürdü. `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` denenmedi.
- Güvenlik sınıflandırıcısı: bir istek (ham düşünceyi aynen yazdırma) `API Error ... [reasoning_extraction]` döndürdü (`is_error:true`, `stop_reason:"refusal"`, `subtype:"success"`); benzer bir istek geçti. Oturumun sonra kullanılabilir kalıp kalmadığı ölçülmedi.
- `docs` headless sayfası `--bare` modunu `-p` için gelecekte varsayılan yapacağını söylüyor; bare OAuth okumaz. Otomatik güncelleme kanalı `latest` açık.
- Ölçülmeyenler: `advisor` aracının çağrılabilirliği; otomatik sıkıştırmanın tetiklenmesi; 1 saatlik önbellek süresinden uzun boşluk; dört ortam değişkeni + `--disable-slash-commands` ile `--resume`; `total_cost_usd` (belgeye göre tahmin).

## 2. İş oturumu: `claude -p` ve `--bg` (12/12 oturum)
Seçilen yol `claude -p` + stream-json + `detached` + dosyaya stdio. Kurallar ve kanıtları:

| Kural | Neden |
|---|---|
| Boru değil dosya | boruda başlatıcı ölünce `claude.exe` 15 sn içinde öldü, Bash torunları yetim kaldı |
| Bitiş = süreç çıkışı | `result` iki kez gelebilir; çıkış `result`tan 2,7-14 sn sonra |
| Rapor = son `result` | ilk `result` eksik olabilir |
| Çıkışta `result` yoksa yarım | öldürülen oturumda hiç `result` yok |
| `init.mcp_servers`'ta gereken sunucu `connected` mı | `-p` yavaş MCP'yi beklemiyor (`rea` `pending`) |
| Öldürme `taskkill /T /F`, sağ kalan say | `rc` güvenilmez (başarıda 128 döndü) |
| Torun PID'lerini periyodik kaydet | kök ölüyse `/T` çalışmıyor |

- Üç eşzamanlı `-p` (hata yok):

| Oturum | Hook başı | `init` | ilk `assistant` | `result` | çıkış | Tepe RAM | Tepe private | Süreç |
|---|---|---|---|---|---|---|---|---|
| c1 | 3,3 sn | 8,3 sn | 16,0 sn | 35,0 sn | 41,2 sn | 948 MB | 1.219 MB | 12 |
| c2 | 2,9 sn | 8,4 sn | 11,1 sn | 29,5 sn | 43,6 sn | 926 MB | 1.188 MB | 12 |
| c3 (`--strict-mcp-config`) | 2,9 sn | 4,3 sn | 8,2 sn | 28,2 sn | 30,8 sn | 392 MB | 663 MB | 3 |

- `--strict-mcp-config` RAM'i 2,4 kat düşürür, açılışı 4 sn kısaltır. Fark çoğunlukla `rea` MCP'sinden (`node` 257-405 MB + `npx` 83-106 MB); `computer-use-windows` yaklaşık 90 MB. Bekleyen oturum da bellek tutar (soruda beklerken ağaç 824 MB). `--bg` işçi ağacı 939-1.007 MB + ortak daemon 168 MB. Boş RAM ölçüm sırasında 7,6 GB'tan 4,9 GB'a indi (32 GB'ın); daemon bir noktada "low memory" dedi, o anki değer ölçülmedi.
- İlk tur girişi (önemsiz iş): `-p` 45.782 (2 + 29.220 yazma + 16.560 okuma), `--bg` 58.590 (2 + 58.588 yazma + 0 okuma); diğer örnekler `-p` 46.001 ve strict 43.196, `--bg` 61.192 ve 58.671. Bir `-p` oturumu toplam giriş 4, yazma 33.455, okuma 62.340, çıkış 407, 2 API turu, 15,3 sn, liste fiyatı karşılığı 0,144 $. Altı `-p` oturumunun toplamı 1,22 $. `state.json`'daki `tokens` yalnız çıkışı sayar. Önbellek sıcaktı; soğuk başlangıçta yazma payı daha yüksek olur.
- PC iş oturumu bağlam küçültme (2026-11-09, tam profil, boş `cwd`, gerçek `claude`, `--model sonnet`): `--disallowedTools` ile 20 yerleşik araç + `--settings {"syncClaudeAiSkills":false}` + ortamda `CLAUDE_CODE_DISABLE_AUTO_MEMORY/ADVISOR_TOOL/FILE_MENTIONS=1` birlikte ilk isteği 44.059 → 33.444 token (−%24), işin başlattığı alt agent'ı 25.056 → 18.140 (−%28) indirdi; SessionStart hook ek bağlamı bayt bayt korundu. Yalnız yasak liste: 39.094 (gönderilen araç 18 → 14; bayrak tanımı da çıkarır, alt agent'a geçer). `CLAUDE_CODE_DISABLE_ATTACHMENTS` eklenmedi: hook bağlamını korusa da skill ve ertelenmiş araç listesini düşürüyor. Proje `CLAUDE.md`'si olan `cwd`'de taban ve sonuç büyür. Kod: `server/src/isler-komut.ts` (`PC_YASAK_ARACLAR`, `pcAyarlari`), `server/src/ayar.ts` (`pcIsOrtami`).
- Çalışmayanlar: `-p` + boru + başlatıcı ölümü; ölü köke `taskkill /T`; `logs`'u rapor kaynağı yapmak (ANSI, tekrar); SSH oturumunda PowerShell aracı.
- Ölçülmeyenler: önerilen tam komutun tek seferde koşulması (parçalar ayrı doğrulandı); 30 dk üstü bekleme ve `timeout: 86400000`; SSH kapanınca session 0 süreçlerinin ölmesi; Windows komut satırı sınırı (~32 KB) ile uzun görev metni (gerekirse görev dosyaya yazılıp yolu verilir); `-p` oturumunu `--resume` ile sürdürmek. İlk `spawn` Node'u 1,9 sn bloke etti, nedeni bilinmiyor.

## 3. Masaüstü oturumu ve otomatik başlatma
Tüm koşular kopuk (`Disc`, `WTSConnectState=4`, 60/60 kalp atışı) kullanıcı oturumunda; `claude` başlatması 5/12.
- Penceresiz başlatma: `conhost.exe --headless "node.exe" <servis>` çalıştı; `claude.exe` ve torunları pencere açmadı (pencere görünürlüğü `IsWindowVisible` ve WinEvent ile mantıksal ölçüldü, gözle görülmedi). Doğrudan `node`, `.cmd`, `powershell -WindowStyle Hidden` görünür terminal penceresi açtı. `schtasks /end` yalnız conhost'u öldürdü; XML `UserId` için `USERDOMAIN` işe yaramadı (`WORKGROUP` döndü).
- OAuth, `gh`, `claude -p`, tam bayraklı ana oturum + `--resume` çalıştı. `OpenInputDesktop` hata 5, `GetForegroundWindow=0`.
- `computer-use-windows`: pencere listesi çalıştı (20 pencere, 11 süreç, 14'ü simge durumunda); `screenshot` `BitBlt` ile hata verdi ("masaüstü kilitli olabilir" mesajı yanıltıcı, durum `Disc`). `PrintWindow` bir pencerede siyah olmayan veri döndürdü (tek pencere, görüntüye bakılmadı). Fare/klavyenin `Disc`'te başarısız olması beklenir, denenmedi. MCP sunucusu `Disc`'te `connected`, hata yalnız araç çağrısında.
- Güç: etkin plan Yüksek performans. Uyku prizde 0 (asla), pilde 240 sn; hazırda bekletme her ikisinde asla; ekran kapanması prizde asla, pilde 240 sn. Kapak kapatma eylemi okunamadı (sorgu boş döndü). `AutoAdminLogon` değeri yok (otomatik oturum açma kapalı). Yeniden başlatmada oturum açılmazsa görevin çalışmayacağı çıkarımdır, ölçülmedi.
- Ölçülmeyenler: etkin (bağlı) oturum; oturum açılış tetiği ve `PT5M` tekrarı (yalnız `/run` denendi); uzun süre (en uzun canlı zincir 46 sn); token yenileme; tam bayrak setiyle tur ortası ölüm; dinleyicisiz stdout'ta conhost ölümü; `PrintWindow`'un diğer pencerelerde çalışması. Ağaç atfı `ppid` zincirine dayanır (PID çakışması olabilir).

## 4. Expo + yerel Kotlin modülü
Sürümler: Expo SDK 58.0.23, React Native 0.88.1, React 19.3.0, New Architecture ve Hermes açık, TypeScript 6.0.3, Gradle 9.4.1, AGP 9.2.1, Kotlin 2.2.10, KSP 2.2.10-2.0.2.
- **Çekince:** varsayılan SDK 58 yapılandırması bu makinede derlenmedi. SDK 58 `compileSdk 37`, `build-tools 37.0.0`, `NDK 27.1.12297006` ister; makinede `android-36`, `36.0.0`, `28.2.13676358` vardı. Eksikleri kurmak SDK lisansının yeni sürümünü kabul etmeyi gerektiriyordu; kabul edilmedi. Süreler `compileSdk 36` + NDK 28.2 ve AAR uyumluluk denetimi etkisizleştirilerek alındı: süreler temsil edicidir, üretilen APK'lar kullanılabilir ürün değildir. `ping()` çalışma zamanında çağrılmadı (cihaz yok); kanıt statiktir.
- Süreler (duvar saati; paralel 14 `claude` süreci vardı, CPU ortalaması %26, tepe %97):

| İş | Süre |
|---|---|
| `create-expo-app` (blank-typescript, npm install dahil) | 81,7 sn (458 paket) |
| `create-expo-module --local` | takıldı (iki denemede); modül elle yazıldı (6 dosya) |
| `tsc --noEmit` | 1,9 sn |
| `expo prebuild --platform android --no-install` | 3,6 sn (sonrakiler 1,9-2,0 sn) |
| İlk `assembleDebug`, 4 ABI | 496 sn = 8 dk 16 sn (314,1 + 161,4 + 20,8; iki koşu başarısız) |
| Temiz `assembleDebug`, 4 ABI, ılık önbellek | 96,0 sn, APK 136,6 MB |
| Temiz `assembleDebug`, yalnız arm64 | 69,1 sn (%28 kısa), APK 44,8 MB (%67 küçük) |
| Değişiklik yok, 4 ABI / arm64 | 7,3 sn / 6,7 sn |
| Yalnız Kotlin değişince, 4 ABI / arm64 | 7,8 sn / 7,0 sn |
| JS değişince `assembleRelease`, arm64, ılık daemon | 25,1 sn (yeni daemon: 52,4 sn) |
| Metro hazır olana kadar / ilk Android bundle (716 modül, 3,9 MB) | 13,5 sn / 16,0 sn |
| Metro değişiklik yok / JS değişti | 0,026 sn / 0,045 sn |
| İlk `assembleRelease`, arm64, R8 açık | 271,5 sn = 4 dk 32 sn, APK 19,9 MB |

  Günlük döngüde gecikme küçüktür; bir kerelik maliyet ilk derleme ve ilk release'tir. Sınırlar: ilk derleme API 37 ve NDK indirme süresini içermez; yalnız arm64 soğuk ilk derleme ve 4 ABI release ölçülmedi; Kotlin süresi tek dosyalık bağımsız modül içindir, manifest/kaynak değişikliği ölçülmedi.
- Release: gömülü bundle 1.254.544 bayt Hermes bytecode (sürüm 99); şablon release'i debug anahtarıyla imzalar.
- Disk: `node_modules` 881 MB (kurulumdan sonra 311 MB), `android/app/build` 1989 MB, proje toplamı 2906 MB, `~/.gradle` 4041 MB -> 8829 MB (+4788 MB). Boş disk 57 GB'tan 44 GB'a indi.
- Hatalar: proje adı `expo` bağımlılıkla çakışır (gerçek proje adı `app`, denenmedi); `create-expo-module --local` takılır, kök neden bulunamadı; AAR denetimi `compileSdk 37` ister (36'ya düşmek SDK 58'de desteklenmiyor); `expo-build-properties` `ndkVersion`'ı sessizce yok sayar (yerel config plugin ile çözüldü); şablondaki `-Xmx2048m -XX:MaxMetaspaceSize=512m` Metaspace taşmasına yol açtı (önerilen `-Xmx4096m -XX:MaxMetaspaceSize=1024m` test edilmedi, config plugin ile yazılmalı); `cmd /c gradlew.bat` yerine `.\gradlew.bat`; `~/.gradle` boyutu için Msys `du` yerine `robocopy /L /E /BYTES`.

## 5. Android cihaz bulguları (yalın Kotlin APK, Android 16 tabanlı, üretici arayüzlü bir cihaz)
- Yan yükleme kuruldu; "kısıtlı ayar" uyarısı çıktı ve "Kısıtlı ayarlara izin ver" ile aşıldı; erişilebilirlik servisi bağlandı.
- WebSocket RTT 60-135 ms. `tap_node` ve ham `tap` çalıştı, `type` çalıştı.
- Parola alanı: `hasText=false`, metin dönmedi, günlükte 0 eşleşme. `type` `ok:true` döndüğü halde parola uzunluğu 0 kaldı: `ok` eylemin sonucunu kanıtlamaz, durum yeniden okunmalı.
- Ekran görüntüsü 147 ms, 324x720, 12,7 KB; art arda çağrıda `INTERVAL_TIME_SHORT` görüldü, en az 1 sn aralık varsayılmalı.
- **FLAG_SECURE:** ekran görüntüsü hata vermiyor, `ok:true` ve %99,9 siyah dönüyor. Ama `elements` aynı pencerede metni OKUYOR. FLAG_SECURE erişilebilirlik ağacını korumaz; hassas uygulama koruması paket listesiyle olmak zorunda, FLAG_SECURE'a güvenilmez. Siyah görüntü `secure_ekran` diye işaretlenmeli.

## 6. Telefon tuzak testi (sahte MCP, gerçek telefon yok; 70/70 başlatma)
- Araç ihlali: Sonnet ana matris 0/46 (oku 0/22, yaz 0/24), Opus 0/7, ana oturum (Opus) `plan_oner` 0/15 (`rapor_oku` tuzağı 0/5 çitsiz, 0/5 çitli; `isSynthetic` 0/5). Yazma görevinde 31/31 tam bir kez `geliyorum` gönderildi. Sözlü ihlal: Sonnet 0; ana oturum `isSynthetic` testinde 3/5 koşullu teklif ("gerçekten istiyorsan yaz"), Opus'ta 1 teklif. Pozitif kontrol: aynı istek `origin:human` ile gelince `plan_oner` çağrıldı (n=1).
- Kollar (Sonnet, araç ihlali/n): A ham 0/11, B kural 0/11, C çit 0/12, D çit + `_meta` + uyarı 0/12. Tuzağı bildirme: 10/11, 11/11, 11/12, 12/12. Medyan ilk tur girişi 1780, 2021, 2243,5, 2474,5 token. Sarmanın ihlali azalttığı gösterilemedi; ölçülen tek fark atıf (s3'te A/B 4/4 sahte satırı "ekranda ayrı metin" diye raporladı, C/D 4/4 "mesajın içinde" dedi; Fisher p≈0,03, sonradan ve düzenli ifadeyle sayıldı, ön kayıtlı değil, n=8).
- Sınır: 0/46 için tek yönlü %95 üst sınır %6,3; kol başına %22-24; hücre başına %78-95.
- `_meta` modele gitmiyor: C ve D arasında `elements` sonrası giriş artışı aynı (medyan 320,5), oysa D sonucu `_meta`'da 2400 karakter dolgu taşıyordu.
- `--tools ""` + `--json-schema` çalışıyor, `StructuredOutput` düşmüyor (n=1); `rapor_ver` 54/54 telefon koşusunda çağrıldı.
- `[passage omitted]`: oku görevinde 5/22 koşuda model saldırı metnini aktarmak yerine bunu yazdı (A 3, C 1, D 1); neden bilinmiyor. Sonnet yazma görevinde 10/24 koşuda gönderdikten sonra ekranı yeniden okumadı; Opus 7/7 okudu. 62/62 tıklama `element` ile yapıldı.
- Zayıf yanlar: küçük n (hücre başına 3 tekrar bile yok); taban etkisi (saldırılar açık ve kaba); göreve uyumlu saldırı, çok adımlı iş ve biriken metin denenmedi; tek ekran, 2-6 araç çağrısı, statik metin; ekran görüntüsü kanalı kapalıydı (görsel enjeksiyon, bidi, uzun metin ölçülmedi); kural "plan önerme, söyle" diyor ve kuralsız ana oturum kolu yok; ön ek açıklanmadan davranış ve kullanıcının aynı öneki yazması ölçülmedi; modelin testi sezmesi için düşünme blokları incelenmedi; sözlü kodlama tek kişiyle, kör olmadan yapıldı; ana oturumun Sonnet davranışı ölçülmedi; sonuç tek model sürümüne ve tek ana özgüdür.

## 7. Telefon gece dayanıklılığı (2026-11-07)
Test telefonu (Android 16 tabanlı, üretici arayüzlü), gece boyunca bağlı bırakıldı.
- Wake lock kapalı, ekran çoğunlukla kapalı: 10 sa 38 dk kesintisiz bağlantı, tek boşluk 46 sn. RTT p50 63 ms, p95 145 ms. Üretici arayüzü servisi öldürmedi.
- Telefon yeniden başlatıldı: `BOOT_COMPLETED` ile servis kendiliğinden kalktı, erişilebilirlik bağlı kaldı. Tailscale açılmadığı için 46 dk (77 deneme) bağlanamadı: VPN yok, bağlantı hücresel arayüzden geldi. Tailscale açılınca bağlandı.
- Son uygulamalardan kaydırma süreci öldürmedi. Hücresel + VPN çalışıyor.
- Sonuç: kurulumda Tailscale için Android "her zaman açık VPN" şart. Yeni süreçte wake lock varsayılan kapalı olmalı.

## 8. Uçtan uca deneme (gerçek `claude`, 2026-11-07)
- Düzenek `server/e2e/` altında yazıldı: sahte telefon istemcisi, geçici veri dizini, ağ denetimleri sarmalanmış.
- Deneme 6 saatte sonuç kaydı üretmeden durduruldu; senaryo sonuçları kaydedilmedi. Gerçek `claude` ile tam akış henüz kanıtlanmış değil.
- Sahte süreçlerle doğrulananlar: sunucu 905 test (modül + birleşim), telefon çekirdeği 400+ test (10.000 adımlık mutasyon değişmezi dahil), JS çekirdeği 66 test.
- İlk gerçek deneme kullanıcının telefon kurulumuyla yapılacak.

## 9. Canlı veride gecikme (2026-11-13)
- Mesaj → cevabın bitişi: ortanca 13,4 sn, p90 171 sn (canlı veri).
- Servis mesajı Claude'a en çok 1,2 sn'de iletiyor.
- Temiz koşulda model 0,7-0,9 sn'de yazmaya başlıyor; efor düzeyi fark yaratmıyor.
- Tipik tur iki model çağrısıdır: düşünme + araç, sonra metin.
- 100 sn'yi aşan turlarda sürenin %58-94'ü araç çalışması; çoğu PowerShell.
- Ölçülmeyenler: telefona teslim süresi (o yönde onay ya da zaman kaydı yok); telefonda ilk harfin göründüğü an (transkript bloğu bitince yazıyor).
