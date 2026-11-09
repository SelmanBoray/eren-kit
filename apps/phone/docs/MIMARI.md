# eren-kit telefon: mimari kararlar

Durum: v1, 2026-11-06. Ölçüm sayıları için `OLCUMLER.md`, güvenlik modeli ve kalan açıklar için `GUVENLIK.md`. Mesaj tipleri `protocol/` paketindedir (tek kaynak); cihaz tarafı için `protocol/CIHAZ.md`. Bu belge mesaj listesini tekrarlamaz.

## Kullanıcı gereksinimleri (kesin)
- Ana oturum (konuşan ana süreç) hiç iş yapmaz, kod yazmaz; bağlamı dolmasın diye en küçük işi bile üstlenmez.
- Her iş yeni bir oturumdur. Bir iş oturumuna ikinci iş verilmez; aynı oturuma yalnız o oturumun sorduğu sorunun cevabı döner.
- "Kesin yapılacaklar / kesin yapılmayacaklar" listesini ana oturum yazar, telefonda gösterir, kullanıcı onaylar. Onun dışında oturum serbesttir.
- PC iş oturumları tam serbesttir. Eşzamanlı oturum sınırı yoktur; panelde RAM görünür, düşük RAM'de uyarı çıkar.
- Telefon uygulaması React Native + Expo, içinde Kotlin modülü. Önce Android; iPad'e yalnız sohbet. Giriş yazı ve sesle dikte.
- Ağ yalnız Tailscale + eşleştirme; internete port açılmaz. Bildirim uygulamadan, yedek olarak Telegram'dan (yalnız kısa not).
- Ana oturum arka planda otomatik başlar, pencere açmaz.
- Telefon yönetimi ilk sürümde vardır; hassas uygulamalar kapalıdır. Asıl şart: karşı taraftan okunan bir mesaj hiçbir zaman komut olarak alınmaz, yalnız kullanıcının kendi emirleri uygulanır.
- Repo önce private. Kimlik notları, kişisel yollar, cihaz adları repoya girmez.

## Bileşenler
- `eren-servis`: tek Node 24 + TypeScript süreci. Modüller: `gateway` (WebSocket), `konusma` (ana oturum süreci), `isler` (iş oturumları), `planlar`, `cihaz` (telefon komutları), `bildirim` (Telegram), `kilit` (limit düzeneği), `depo` (SQLite).
- MCP sunucuları ince stdio köprüleridir (`--rol eren|soru|telefon`); adlandırılmış boruyla servise bağlanır, mantık serviste kalır. HTTP MCP yoktur. Köprü role ve işe bağlı rastgele jeton taşır. Boruda "kullanıcı mesajı" fiili hiç yoktur. Servis yeniden başlayınca köprü yeniden bağlanır ve `soru_id` ile beklemeyi sürdürür.
- Depo düzeni: `protocol/` (ortak TS tipleri), `server/`, `app/` (Expo), `app/modules/eren-device/` (Kotlin), `docs/`.
- Çalışma verisi repo dışında: `EREN_KIT_DATA_DIR` ortam değişkeniyle verilen mutlak yol, verilmezse varsayılan `%LOCALAPPDATA%\eren-kit\`. SQLite (WAL) tabloları: `events, turns, nesiller, planlar, isler, is_pidleri, sorular, eren_kuyrugu, cihazlar`. İş dosyaları: `isler/<id>/{gorev.txt,mcp.json,out.jsonl,err.txt}`. Kişisel ekler (`kimlik.local.md`, `projeler.json`) repo dışında kalır.

## Ana oturum süreci
- `claude` çıktı/girdi akışı (stream-json) ile uzun ömürlü tek süreç. Bayraklar: `--tools ""`, `--strict-mcp-config`, `--setting-sources ""`, `--disable-slash-commands`, dört `CLAUDE_CODE_DISABLE_*` ortam değişkeni, `CLAUDE*`/`ANTHROPIC*` ortam değişkenleri silinmiş. Model Opus. Gerekçe: başlangıç bağlamı 52.563 token yerine yaklaşık 1.300 token olur (`OLCUMLER.md`).
- `origin:{kind:"human"}` yazan tek kod noktası `/sohbet` bağlantısından gelen doğrulanmış mesajdır; testle sabitlenir. Servis olayları `isSynthetic:true` taşır.
- Araçlar: `plan_oner`, `oturumlar`, `rapor_oku(id)`, `projeler`, `uygulamalar`, `oturum_durdur`, `devir_ozeti`. `plan_oner` iş başlatmaz: görev metninin tamamı telefonda görünür, servis yalnız onaylanan `plan_hash` metnini başlatır.
- Sistem istemi yaklaşık 400-500 token; değişken bilgi araçla gelir.
- Devir: bağlam >= min(%50 pencere, 200.000 token) olunca. Doluluk, son `assistant.message.usage` üç giriş alanının toplamı / `result.modelUsage.<model>.contextWindow`. Tur sınırında eski ana oturumdan `devir_ozeti` istenir; yeni `session-id` ile özet + DB'deki iş/plan/soru durumu + son 10 konuşma (`isSynthetic`) verilir; ilk `result` sonrası eski süreç kapanır. `shouldQuery:false` kullanılmaz. Özet reddedilirse yalnız DB verisiyle devredilir. Servis `is_error`'a bakar, `subtype`'a güvenmez.
- Kurtarma: kilit dosyasını oku, işleri uzlaştır (canlıysa sahiplen ve `out.jsonl`'i ofsetten sürdür; ölüyse son `result`, yoksa `yarim`), köprüleri kaydet, ana oturumu `--resume` ile aç, sentetik notta yarım metni ve "araç sonucu bilinmiyor" bilgisini ver.

## İş oturumları
- `claude -p` + `detached` + dosyaya stdio + `windowsHide`; ortamdan `CLAUDE*`/`ANTHROPIC*` silinir. Rapor `--json-schema` ile (`yapildi, yapilmadi, dosyalar, acik_noktalar`). Bitiş = süreç çıkışı; rapor = son `result`; çıkışta `result` yoksa `yarim`. Öldürme `taskkill /T /F` ve periyodik torun PID kaydıyla; `rc`'ye güvenilmez. (Neden `--bg` değil: `OLCUMLER.md`.)
- **PC profili:** varsayılan ayarlar (kullanıcının hook'ları ve limit düzeneği yüklü), `--dangerously-skip-permissions`, `--strict-mcp-config` + `eren-soru` (`timeout: 86400000`, `alwaysLoad`) + `computer-use-windows`; `rea` yalnız plandaki `mcp_profili` isterse.
- **Telefon profili:** `--tools ""`, `--strict-mcp-config`, `--setting-sources ""`, `--disable-slash-commands`, açık `--allowedTools` (`eren-telefon`, `eren-soru`), dört ortam değişkeni, boş `cwd`; `--dangerously-skip-permissions` yok. Bash, dosya, web yok. Hem PC hem telefon isteyen iş iki oturuma bölünür.
- Soru: oturum `kullaniciya_sor` aracıyla bloklanır, telefonda kart çıkar, cevap karttan doğrudan oturuma gider. Ana oturumdan geçmez: kandırılmış bir ana oturum "evet" diyemesin ve ana oturumun bağlamı şişmesin diye. Ana oturuma yalnız kısa olay gider.
- Raporlar güvenilmez veridir. Sentetik olay yalnız "İş 7 bitti, durum: tamam" der; gövde çitli `rapor_oku` sonucuyla gelir, boyut kırpılır. Rapor kartı telefonda doğrudan gösterilir. Telefon işinin raporu `kirli` etiketlidir; ona dayanan PC planı onay ekranında bunu belirtir.

## Telefon-PC protokolü
- `ws://<tailscale-ip>:<port>`; yalnız Tailscale arayüzüne bağlanır, güvenlik duvarı kuralı yalnız Tailscale. `tailscale serve` yok. Telefon hep arayan taraftır; telefonda dinleyen port yoktur.
- **İki bağlantı, aynı port:** `/sohbet` (JS; Android + iPad) ve `/cihaz` (Kotlin ön plan servisi; yalnız Android). JS komut görmez ve izin üretemez; ekran görüntüsü sohbeti tıkamaz.
- Eşleştirme normalde kapalıdır. Yerel `eren eslestir` komutu QR + kısa kod üretir; tek kullanımlık, 5 dk. Telefon Keystore'da P-256 anahtarı üretir, PC yalnız açık anahtarı saklar. Her bağlantıda karşılıklı sınama-imza + eşleşmiş Tailscale IP kontrolü. Telegram'dan kod gitmez. Paylaşılan sır yoktur: PC diskini okuyan süreç telefon gibi davranamaz.
- Telafi: kalıcı olaya tek artan `seq`; `hello{last_seq}` eksikleri getirir; yukarı yönde `client_msg_id` + `ack` + outbox. Geçmişin kaynağı `events` tablosudur, Claude transkripti değil; devir telefonda ince bir `eren_handover` satırıdır.
- Akış: `assistant_delta{turn_id,offset,text}` kalıcı değildir, 80 ms ya da boşlukta tamponlanır; bağlanınca `stream_snapshot`; sonda `assistant_message` tam metni yazar.
- Komutlar kuyruklanmaz (bayat dokunma tehlikeli): telefon kopuksa `telefon_bagli_degil`, komut sırasında koptuysa `belirsiz`; yeniden denenmez.
- Mesaj ve olay tipleri için `protocol/` paketi geçerlidir.

## Limit düzeneğiyle birlikte yaşama
- `kilit` modülü, limit kilidi dosyasını 5 sn'de bir, kilit bekçisiyle aynı kuralla okur; bozuksa yeni başlatma yapmaz.
- Kilit aktif olunca 20 sn içinde: yeni başlatma durur, ana oturum kapanır, limit modu yüklü olmayan telefon oturumları `/T /F` ile öldürülür, izinler geri çekilir. Servis ayakta kalır, geçmiş görünür, mesajlar kuyruğa girer, telefona durum gider.
- Servis `ack` yazmaz: `ack`, modun "gerçekten dondum" sözleşmesidir; mod yüklü olmayan süreç için yazmak bekçiyi yanıltır.
- Kilitliyken yeniden başlatma yasaktır (120 sn'lik öldürme döngüsü). Bekçi `/T` kullanmadığı için yetimler kayıtlı PID'lerle süpürülür. `[limit-kilit]` öneki ya da boş `structured_output` `limit_durdu` sayılır. Kilit açılınca ana oturum `--resume` ile döner.

## Otomatik başlatma
- Zincir: Görev Zamanlayıcı XML'i (`InteractiveToken`, oturum açılış tetiği + `PT5M` tekrar, `IgnoreNew`, pil kısıtları kapalı, `ExecutionTimeLimit=PT0S`; `UserId` `whoami` çıktısından) -> `conhost.exe --headless "node.exe" <servis>` -> Node.
- İş oturumu: `detached + windowsHide + dosya stdio`. Ana oturum: `windowsHide + boru`, `detached` yok. `gh` gibi diğer araçlar: `windowsHide`, `detached` yok (detached `gh` terminal penceresi açıyor). Doğrudan node, `.cmd` ve `powershell -WindowStyle Hidden` görünür terminal açtığı için kullanılmaz.
- Servis kendi tekil kilidini tutar (`schtasks /end` yalnız conhost'u öldürür, Node yaşar; `IgnoreNew` yetmez). Log dosyaya yazılır (conhost ölünce stdout `EPIPE`). `LastResult` çöküşü göstermez; kurtarma periyodik tetikle olur. Ayrı Python koruyucu yok. Session 0 yok.
- Kopuk (`Disc`) masaüstü oturumunda OAuth, `gh` ve `claude -p` çalışır; `computer-use-windows` pencere listesini okur ama `screenshot` hata verir. Servis GUI işi gelince bunu kullanıcıya bildirir.
- Taşınabilir bilgisayar: prizde uyku yok, pilde 4 dk'da uyur. Otomatik oturum açma kapalıdır; yeniden başlatmada oturum açılmazsa servis kalkmaz. Otomatik oturum açma kullanıcının kararıdır, repo bunu ayarlamaz.

## Yapım sırası
1. Paralel ölçümler: yalın Kotlin APK ile telefon denemesi; PC masaüstü ölçümleri; sahte telefon MCP'siyle model tuzak testi.
2. Sohbet iskeleti: `protocol/`, servis + ana oturum + RN + `seq` telafisi. Çıkış ölçütü: uçak modu ve servis öldürmede kayıp yok.
3. Plan -> iş -> rapor -> soru -> kurtarma + limit tatbikatı.
4. Kotlin kapısı önce ret: kötü niyetli sahte PC istemcisiyle negatif testler; sonra araçlar (`computer-use-windows` diliyle); sonra gerçek telefonda tuzak testi (bitti tanımı).
5. Devir, Telegram, otomatik başlatma, ADB uyarısı. Sonra public temizliği, iPad.
