# Harness bağımsızlığı: döküm ve sınır tasarımı (Kol H, ilk aşama)

Durum: **tasarım, onay bekliyor.** Bu belge koda dokunmaz; uygulama dilimleri kullanıcı onayından sonra
koordinatörle sahiplik çizilerek başlar. Kaynak: `apps/ajanda/YOL-HARITASI.md` bölüm 6. Kod bu belgeyle
çelişirse kod kazanır; çelişki bildirilir, belge düzeltilir.

Tarih: 2026-11-27. Döküm bu daldaki koda göredir (`43d7543`). Başka harness'lar hakkındaki bilgiler web
belgelerinden derlendi ve **ölçülmedi**; "doğrulanmadı" işaretli her madde uyarlayıcı yazılmadan önce
gerçek araçla ölçülmelidir.

---

## 1. Ne demek "harness bağımsızlığı"

Eren bugün Claude Code'a iki ayrı yoldan bağlıdır; ikisi ayrı sorunlardır ve ayrı sınır ister:

| Rol | Bugün | Sınırın adı (bu belgede) |
|---|---|---|
| **Eren'in kendi motoru**: ana sohbet oturumları (`konusma.ts`) ve işler (`isler*.ts`) | Servis `claude.exe`'yi `-p … stream-json` ile kendisi başlatır, akışı çözer | **Sürücü** (servis harness'ı sürer) |
| **Kullanıcının kendi oturumları**: PC'deki agent oturumu ajanda araçlarını kullanır (`pc_oturumu`) | Kullanıcı Claude Code'u MCP köprüsüne ve araç öncesi kancaya bağlar | **Bağlayıcı** (harness servise bağlanır) |

Üçüncü bir yüzey, `packages/bellek` (beyin, devir, kapı kancaları) ve `packages/opus-orkestra`, ayrı bir
alt sistemdir. Burada yalnız dökümü verilir (bölüm 2.6); tasarımı bu kolun ilk teslimi değildir.

Telefon (`apps/phone/app`) ve Ajanda uygulaması (`apps/ajanda`) servisle kendi protokolleriyle konuşur;
harness'ı görmezler. Onlardaki bağlılık ad ve metinden ibarettir (2.5). D5 için gereken bölüm 6'dadır.

---

## 2. Döküm

Sınıflar: **(a)** uyarlayıcı arkasına girmeli, **(b)** zaten genel, **(c)** yalnız ad ya da metin.
Yollar `apps/phone/` altına göredir. Satır numaraları bu commit içindir, yaklaşık okunmalıdır.

### 2.1 Sürücü: oturum başlatma

| Yer | Claude'a özgü olan | Sınıf |
|---|---|---|
| `server/src/konusma.ts` `argvKur` (~672) | `-p`, `--input-format/--output-format stream-json`, `--verbose`, `--include-partial-messages`, `--replay-user-messages`, `--dangerously-skip-permissions`, `--tools`, `--strict-mcp-config`, `--mcp-config`, `--setting-sources ""`, `--disable-slash-commands`, `--system-prompt`, `--model`, `--session-id` / `--resume` | a |
| `konusma.ts` `ANA_SOHBET_ARACLARI` (57) | Claude yerleşik araç adları; listede `Agent`/`Task` yok, yani ana oturumda alt agent yoktur (güvenlik varsayımı, 3.2) | a |
| `konusma.ts` `sureciBaslat` (~707) | `exe = ayar.claudeExe`; nesil başına MCP yapılandırması; cwd ve ortam genel | a/b |
| `server/src/konusma-metin.ts` `erenMcpMetni` (~169) | Claude `mcpServers` şeması, `alwaysLoad` anahtarı | a |
| `konusma-metin.ts` `sonIstem` (~121) | İstem, Claude'un sentetik satırı sunduğu önek metnine dayanır | a |
| `server/src/isler-komut.ts` `pcArgv`, `telefonArgv` (~153–206) | İş bayrakları: `--json-schema`, `--include-hook-events`, `--disallowedTools` (20 yerleşik araç, `PC_YASAK_ARACLAR`), `--settings {syncClaudeAiSkills, autoMemoryEnabled}`, telefon işinde `--tools ""` + `--allowedTools mcp__eren-telefon__*`; `HAFIF_PC_MODELI="sonnet"` | a |
| `isler-komut.ts` `kopruSunucusu` (~45) | MCP girdisinde `timeout`, `alwaysLoad` | a |
| `server/src/isler.ts` `baslatmaGovdesi` (~903), `kimlikAra` (~480) | `exe = claudeExe`; sahipsiz süreç `basename(claudeExe)` görüntü adıyla aranır (Node tabanlı bir harness `node.exe` olur: servisin kendi Node'uyla karışma riski) | a |
| `server/src/ayar.ts` `claudeExeBul` (~214) | `claude_exe` → PATH'te `claude.exe` → npm yolu; **yalnız `.exe`** (kabuksuz `spawn`, `dis-dunya.ts` `boruluBaslat`/`ayrikBaslat`). npm ile kurulan harness'lar `.cmd` kısayoludur, doğrudan başlatılamaz | a |
| `ayar.ts` `claudeSil` (~113), `erenOrtami`/`pcIsOrtami`/`telefonIsOrtami` | Ortamdan `CLAUDE*`/`ANTHROPIC*` silinir (abonelik girişine zorlama); `CLAUDE_CODE_DISABLE_*` kapatma anahtarları | a |
| `ayar.ts` `VARSAYILAN_EREN_MODELI`/`…TELEFON_IS_MODELI="opus"` | Model takma adı | a |
| `ayar.ts` `yollariUret` (~288) | `%LOCALAPPDATA%\ClaudeLimitKilit\kilit.json`, `%USERPROFILE%\.claude\projects` | a |
| `server/src/sozlesme.ts` `claudeExe`, `erenModeli`, `pcIsModeli`, `telefonIsModeli` (~539) | Ayar yüzeyi Claude adlarıyla | a/c |

### 2.2 Sürücü: akışın çözülmesi ve tur yaşam döngüsü

| Yer | Claude'a özgü olan | Sınıf |
|---|---|---|
| `server/src/akis.ts` `olayaCevir` (168–253) | Dosyanın tamamı stream-json çözücüsü: `system/init` (`session_id`, `tools`, `mcp_servers[].status`, `apiKeySource`, `model`), `assistant` (`usage`, `tool_use`), `stream_event` (`text_delta`, blok başlangıçları), `rate_limit_event` (`five_hour`/`seven_day`), `result` (`is_error`, `terminal_reason`, `structured_output`, `modelUsage.*.contextWindow`, `model_usage_since_last_result`), `control_response` | a |
| `akis.ts` `altAjanMi` (113), `aracSonucu` (155) | `parent_tool_use_id`, `isReplay` süzgeçleri | a |
| `akis.ts` `turSonucuSinifla` (294), `devirEsigi`/`pencereSec` (302) | `terminal_reason` `aborted_*` öneki; `[1m]` model soneki | a |
| `sozlesme.ts` `AkisOlayi`, `AkisYardimcilari` (~757–831) | İç tip yarı normalize ama Claude alan adlarını taşır (`apiKeySource`, `terminal_reason`, `structured_output`). **Zaten enjekte edilen port** (`ana.ts` ~192): sürücü sınırının doğal yeri | a |
| `konusma.ts` `initDenetle` (~1205) | `apiKeySource !== "none"` ise oturum **kalıcı reddedilir** (abonelik dışı kimliğe karşı politika). Başka harness'ta bu alan yoktur | a (kritik) |
| `konusma.ts` `satirIsle`, `sonucIsle` (~1225–1319) | Tur yalnız `result` ile kapanır; `result` hiç gelmezse **turun zaman aşımı yoktur**, kuyruk durur (bugün de geçerli bir açık) | a |
| `konusma.ts` `insanSatiriKur`, `sentetikSatirKur`, `kesmeSatiriKur` (174–214) | stdin satırları: `origin:{kind:"human"}`, `isSynthetic:true`, `client_composed:true` (`@yol` dosya anma koruması), `control_request/interrupt` | a |
| `konusma.ts` `pompala` (~835), `HAZIR_PAYI_MS` (72) | Tek uzun ömürlü, çok turlu stdin süreci modeli; "init ilk stdin satırından önce gelmez" varsayımı | a |
| `konusma.ts` `acilisYap`/`sayfaAc` (~1382–1482), `isler.ts` `baslat` (~1132) | Oturum kimliğini **servis seçer** (`--session-id <uuid>`), devamda `--resume`; akıştaki `session_id` okunmaz | a |
| `konusma.ts` `turSiniri` (~1183) | Devir eşiği (min(%50 pencere, 200k)) servisindir (b); ölçü girdisi Claude `usage`/`contextWindow` (a). Claude'un kendi sıkıştırması ayrıştırılmaz | a/b |
| `isler.ts` `partiIsle` (~637), `kopruleriDenetle` (~629) | İş akışı; telefon işi `mcp_servers[].status === "connected"` ister | a |
| `server/src/isler-rapor.ts` | `[limit-kilit]` öneki, rapor `structured_output`'tan; MCP `rapor_ver` yedeği zaten var | a/b |
| `server/src/etkinlik.ts` `aracKategorisi` | Claude araç adları ve `mcp__<sunucu>__<araç>`; tanınmayan ad "arac" olur (zarif düşüş) | c |
| `server/src/dis-dunya.ts` `transkriptKur` (~1327), `sozlesme.ts` `TranskriptPortu` | `~/.claude/projects/<proje>/<uuid>.jsonl` silme; port zaten dar | a |
| `server/src/kilit.ts`, `isler.ts` `kilitteDurur` | Dış Claude limit aracı dosyası; `LimitKilitDurumu` genel | a |
| Genel kalanlar | `bekci*.ts`, `kok-izni.ts`, `veri-koku.ts`, `temizlik.ts` (port üzerinden), `depo.ts` (opak `session_id`), `sohbetler.ts`, `tuketim.ts` (normalize kullanım), tur kökeni takibi `Tur.kaynak`/`turBaglami` (`konusma.ts` ~1986) | b |

### 2.3 Bağlayıcı: araç sunumu ve tasdik (`pc_oturumu`)

| Yer | Ne | Sınıf |
|---|---|---|
| `server/src/kopru.ts` `mcpBaslat`, `giris` | stdio MCP sunucusu, yalnız `tools` (ListTools/CallTool), iptal desteği; `clientInfo` kullanılmaz | b |
| `kopru.ts` `CLAUDE_CODE_ARAC_KIMLIGI = "claudecode/toolUseId"` (742), `pcCagri` (~788) | Çağrı kimliği Claude Code'un `_meta` anahtarından okunur; yoksa karar `cagri_kimligi_yok` | **a** |
| `kopru.ts` (1009) | `oturum_id = CLAUDE_CODE_SESSION_ID ?? pck_<rastgele>`; yalnız iz ve yedek | c |
| `kopru.ts` `AJANDA_MCP_SUNUCU_ADI="eren-ajanda"` | Claude araç adı `mcp__eren-ajanda__<fiil>`'i bundan türetir; kanca eşleyicisi buna dayanır | c/a |
| `protocol/src/ajanda-pc-kanca.ts` `pcAracKancaGirdisi` | Kanca girdisinden: `session_id`, `tool_use_id`, `tool_name` önek süzgeci, `prompt_id`, `agent_id`/`agent_type` **anahtarının varlığı** → alt agent (güvenli taraf), `CLAUDE_CODE_ENTRYPOINT ∈ {sdk-cli, sdk-ts, sdk-py}` → etkileşimsiz (**yasak listesi**: yeni değer etkileşimli sayılır) | **a** |
| `server/src/kanca.ts` | `PreToolUse` kancası: hello `pc_kanca` → `pc_arac` → yanıt, en çok 2 sn; her durumda 0 ile çıkar, engellemez. Sıra garantisi Claude Code'undur ("kanca bitmeden araç çalışmaz") | çerçeve b, sıra a |
| `server/src/ajanda-pc.ts` `pcDefteriKur` / `kararVer` | Tasdik defteri: `arac_cagri_id` anahtarlı, tek kullanımlık, 10 dk ömür, 256 kayıt; karar sırası `cagri_kimligi_yok` → `tasdik_yok` → `alt_agent` → `etkilesimsiz` → `insan`. **Harness'tan bağımsız** | b |
| `server/src/ajanda-kopru-sunucu.ts` `helloIsle`, `pcBaglami` | Boru `\\.\pipe\eren-ajanda`, NDJSON; PC rolleri tek anahtarla, rol hello'da beyan edilir; anahtar her istekte yeniden denetlenir | b |
| `server/src/ajanda-araclar.ts` `pcCagrisi`, `ekle` | `insan` dışındaki her karar sentetik → kayıt **taslak**; sentetik tur onaylayamaz, taslak olmayan kayda dokunamaz | b |
| `protocol/src/ajanda-pc.ts` `pcTurNotu` | Modele giden not metinleri "Claude Code" ve `--claude-code --teshis` anar | c |

**Doğrulanmış bulgu (kod, `ajanda-pc.ts` `kararVer`):** tasdik yalnız çağrı kimliğiyle eşlenir; tasdikteki
`oturum_id`, köprünün bildirdiği oturumla ya da bağlantıyla karşılaştırılmaz. Anahtar sahibi başka bir
köprü, bekleyen bir çağrı kimliğini önce sunarak o tasdiki tüketebilir. Anahtar gerektiği için bugünkü güven
modelinin (sınır = işletim sistemi kullanıcısı, `GUVENLIK.md`) içindedir; harness'tan bağımsız tasarımda
yine de kapatılır (4.2, kural T5).

### 2.4 Kurulum

| Yer | Ne | Sınıf |
|---|---|---|
| `kurulum/claude-code.ts` (tamamı) | `~/.claude/settings.json` `hooks.PreToolUse` (eşleyici `mcp__eren-ajanda__.*`, yürütme biçimi), eski `UserPromptSubmit`/`Stop` kancalarının tanınması, `managed-settings.json` `disableAllHooks`/`allowManagedHooksOnly` teşhisi, `claude mcp add eren-ajanda -s user -- …` metni (çalıştırılmaz, yazdırılır), `permissions.allow` önerisi | a |
| `claude-code.ts` `ayarCoz`/`ayarYaz`/`ayarOku`/`yedekAl` | BOM/UTF-16/bağlantı/yedek korumalı JSON yazıcı | b (yeniden kullanılır) |
| `server/src/eslestir.ts` `--claude-code` ailesi (~131–179, 334–711) | Anahtar üretimi/iptali/listesi genel (b); `ClaudeCodeYollari`, `kayitYonergesiYukle` (dinamik `claude-code.ts` içe aktarma), teşhis metinleri (a/c) | a/b |
| `eslestir.ts` `ayarKur` (~733) | Telefon eşleştirmesi `claude.exe` bulunamazsa hata atar: harness'sız kurulum bugün eşleşemez | a |
| `kurulum/kur.ts`, `eren.ts`, `ortam.ts`, `izin.ts`, `gorev-kaydet.ts`, `telefon.ts` | Claude'a özgü şey yok | b |

### 2.5 Protokol, telefon ve Ajanda uygulaması

| Yer | Ne | Sınıf |
|---|---|---|
| `protocol/src/sohbet.ts` `ServerStatus.limit` (~558) | `bes_saat`/`haftalik` pencereleri = Claude aboneliğinin pencereleri; alan isteğe bağlı, yoksa telefon gizler | a/b |
| `protocol/src/sohbet.ts` `TuketimToplami` (~577) | `cache_yazma`/`cache_okuma`/`maliyet_usd` (Anthropic kullanım modeli); başka sağlayıcıda 0 kalabilir | b/c |
| `protocol/src/sohbet.ts` `ANA_SOHBET_ADI="Claude"` | `ana` sohbetinin ilk adı; göç verisine yazılmış, değiştirmek dikkat ister | c |
| `protocol/src/plan.ts` `IS_PROFILI_ACIKLAMASI` | Modele giden metin "model sonnet, kancalar yüklenmez" der | a (sürücüden üretilmeli) |
| `protocol/src/rapor.ts` | Şema genel; yorum `claude --json-schema` anar | b/c |
| `app/src/asistanAdi.ts`, `app.config.ts`, `ekranlar/baglantiDurumu.ts`, `DurumEkrani.tsx` | Varsayılan ad "Claude" (yapılandırılabilir); "5 saatlik / haftalık limit"; "Maliyet Claude Code'un liste fiyatıyla…" metni | c |
| `apps/ajanda/**` | Harness bilgisi yok | b |

Telefona model adı ya da harness oturum kimliği giden bir alan yoktur.

### 2.6 Çevre (ayrı alt sistem; bu teslimde yalnız döküm)

- `packages/bellek/src/bellek/devir/hook.py`: Claude kanca olayları (`SessionStart`, `UserPromptSubmit`,
  `Stop`), `hookSpecificOutput.additionalContext`, `claude-*` fiyat tabloları (a).
- `packages/bellek/src/bellek/devir/transcript.py`: Claude JSONL transkript şeması (`isSidechain`,
  `compact_boundary`, `custom-title` …) (a).
- `packages/bellek/src/bellek/kapi/hook.py`, `kapi/harita.py`: `PreToolUse` karar çıktısı, `Read` aracının
  satır varsayılanı (a).
- `packages/bellek/src/bellek/beyin/mcp_kopru.py`: `CLAUDE_CODE_SESSION_ID`, `"istemci": "claude-code"`
  (a/c). Beyin bir MCP sunucusu olduğu için asıl işlevi taşınabilir.
- `packages/opus-orkestra/hooks/…sessionstart.py`: `SessionStart` ek bağlamı, `~/.claude/skills/…` (a).

### 2.7 Claude'a özgü davranışı sabitleyen testler

Uyarlayıcıya taşınırken bu testler Claude uyarlayıcısının testi olur, silinmez:
`server/test/konusma.test.ts` (argv, stdin satırları, `apiKeySource`, `terminal_reason`, devir eşiği),
`akis.test.ts` (stream-json sözlüğü), `isler.test.ts` (`pcArgv`/`telefonArgv`, `mcp_servers` connected),
`isler-rapor.test.ts`, `ayar.test.ts` (ortam silme, `claude.exe` arama), tüketim testleri, `etkinlik.test.ts`,
`dis-dunya.test.ts` (transkript düzeni), `birlesim*.test.ts`, `insan-noktasi.test.ts`, `sahte.ts`
(görüntü adı `claude.exe`); `protocol/test/ajanda-pc.test.ts`, `server/test/ajanda-pc-yan.test.ts`,
`birlesim-ajanda-pc.test.ts`, `kopru-ajanda.test.ts`; `kurulum/test/claude-code.test.ts` (17 test).

---

## 3. Korunacak ilkeler

### 3.1 Güvenlik tabanı (her harness'ta aynı)

- **T1.** Tur kökeni hiçbir zaman araç girdisinden, modelden ya da modelin yazabildiği bir yerden gelmez.
  `insan` yalnız iki kaynaktan doğar: ana oturumda servisin kendi kuyruğundaki insan satırı; PC yolunda
  harness'ın model dışı yürütme noktasından (kanca, eklenti, sarmalayıcı) gelen tasdik.
- **T2.** Tasdik yoksa, eşleşmiyorsa, eskiyse, kullanılmışsa ya da herhangi bir alanı **bilinmiyorsa**
  kayıt **taslak** doğar. Uyarlayıcının bilmediği her şey güvenli tarafa düşer.
- **T3.** `insan` yalnız *ana agent* ve *etkileşimli* kesin bilindiğinde verilir (izin listesi). Alt agent,
  etkileşimsiz oturum ve bilinmeyen her durum sentetiktir.
- **T4.** Sentetik tur onaylayamaz, taslak olmayan kayda dokunamaz (bugünkü `ajanda-araclar.ts` kuralı,
  harness'tan bağımsızdır, değişmez).
- **T5.** Tasdik tek kullanımlık, kısa ömürlüdür ve tasdiki tüketen bağlantıya bağlanır: tasdiği bildiren
  oturum ile çağrıyı yapan köprünün oturumu eşleşmezse taslak (2.3'teki bulgunun kapatılması).
- **T6.** Kancası olmayan harness araçları kullanabilir; yalnız kayıtları taslak doğar ve telefondan
  onaylanır. Bu bir hata değil, tabandır.
- **T7.** Güvenilmeyen metin modele harness'ın dosya anma / komut genişletme yolu açılmadan verilir
  (Claude'da `client_composed`, `@yol` tuzağı). Her sürücü bunun nasıl sağlandığını belgeler ve test eder;
  sağlayamıyorsa güvenilmeyen metin taşıyan profil (telefon işi) o sürücüde açılmaz.
- **T8.** Telefon işi gibi kısıtlı profiller "yalnız şu MCP araçları, yerleşik araç yok" kısıtını **harness'ın
  kendisinde** zorlamak zorundadır (Claude: `--tools ""` + `--allowedTools`). Zorlayamayan sürücüde profil
  kapalıdır; istemle kısıt sayılmaz.
- **T9.** Kayıt ve istem metni günlüğe ya da servise girmez; jetonun düz hali depoda ve günlükte yoktur
  (mevcut kural).

### 3.2 Ana oturumdaki örtük varsayım

Ana oturumda tur kökeni tur düzeyindedir: insan turundaki her araç çağrısı insan sayılır. Bu, ana oturumda
**alt agent olmadığı** için doğrudur (Claude'da `--tools` listesinde `Agent` yok). Başka bir sürücü alt agent'ı
kapatamıyorsa ya tur içinde çağrı başına köken vermelidir (akışta alt agent çağrısı ayırt edilebiliyorsa) ya
da o sürücüde ana oturumun ajanda çağrıları taslak doğar. Bu, sürücünün bir **yetenek beyanıdır** (4.1).

### 3.3 Canlı kurulumun davranışı değişmez

Her dilim, tek kullanıcı + eşleşmiş telefon + Claude Code kurulumunda davranışın değişmediğini testle gösterir
(yol haritası 7.4). Claude uyarlayıcısı bugünkü kodun taşınmış halidir; bayraklar, alan adları ve kararlar
birebir aynı kalır.

---

## 4. Sınır tasarımı

### 4.1 Sürücü (`OturumSurucusu`)

Servisin bugünkü yapısı buna hazırdır: süreç portu (`dis-dunya.ts`), akış yardımcıları (`AkisYardimcilari`,
`ana.ts`'ten enjekte), transkript portu ve normalize tüketim zaten ayrıdır. Önerilen arayüz dört parçadır:

1. **Yetenek beyanı** (statik): `oturumKimligiCagiranSecer`, `cokTurluStdin`, `surdurme`, `kesme`,
   `altAgentKapatilabilir`, `yerlesikAracKisiti` (T8), `guvenilmeyenMetinYolu` (T7), `yapilandirilmisRapor`,
   `kullanimVerisi` (`yok | tur | model_basina`), `kotaPencereleri` (`yok | liste`), `baglamPenceresi`.
   Servis bu beyana göre profil açar/kapar; bilmediği yeteneği "yok" sayar.
2. **Komut kurma**: `komutKur(profil, oturum, istem, mcpYapilandirmasi) → {exe, argv, ortam, cwd}` ve
   `mcpYapilandirmasiYaz(sunucular)`. Bugün `argvKur`, `pcArgv`, `telefonArgv`, `erenMcpMetni`,
   `kopruSunucusu`, `ayar.claudeExe`, `ayar.*Ortami` buraya taşınır. Başlatıcı `.cmd` sorunu için sürücü
   "çalıştırılacak gerçek ikili + ön argümanlar"ı verir (ör. `node <giriş.js>`); kabuk açılmaz.
3. **Satır kodlama**: `insanSatiri(metin)`, `sentetikSatir(metin)`, `kesme()` (cok turlu stdin yoksa sürücü
   tur başına süreç ya da protokol çağrısı üretir).
4. **Akış çözme**: `satirCoz(ham) → NormalOlay`. `NormalOlay` gerçekten genel olur:
   `hazir{kimlik_uygun, model?, mcp_durumu?}`, `metin_parcasi`, `arac_basladi{ad, alt_agent?}`,
   `tur_bitti{sinif: tamam|hata|kesildi, metin, rapor?, kullanim?, pencere?}`, `kota{pencereler}`,
   `diger`. `apiKeySource`, `terminal_reason`, `structured_output` gibi adlar Claude sürücüsünün içinde kalır.

Ayrıca sürücüye ait: **kimlik politikası** (`initDenetle`'nin yüklemi; Claude'da `apiKeySource === "none"`;
başka harness'ta kendi eşdeğeri ya da "denetlenemez" beyanı ve kullanıcı ayarıyla kabul), transkript kökü ve
düzeni, süreç görüntü adı (`kimlikAra`), limit-kilit kaynağı, araç adı → etkinlik kategorisi tablosu.

**Üç çalışma modeli** desteklenmelidir, çünkü harness'lar farklıdır:

| Model | Örnek | Servis tarafı |
|---|---|---|
| Uzun ömürlü çok turlu stdin | Claude Code (`-p` + `stream-json` girdi) | Bugünkü `konusma.ts` |
| Tur başına süreç + sürdürme | Codex `exec` / `exec resume` (doğrulanmadı) | `pompala` her satır için süreç açar; oturum kimliğini akıştan okur |
| Uzun ömürlü JSON-RPC oturumu | ACP (Gemini CLI `--acp`, OpenCode `acp`, Codex `codex-acp`) | `session/new`/`load`, `session/prompt`, `session/cancel`, `session/update` |

Ek olarak **tur zaman aşımı** sürücüden bağımsız eklenmelidir (bugünkü açık: `result` gelmezse kuyruk durur).

### 4.2 Bağlayıcı (PC oturumu uyarlayıcısı)

Servisin tasdik defteri, karar sırası ve taslak tabanı zaten harness'tan bağımsızdır. Claude'a özgü olan üç
şeydir: çağrı kimliğinin MCP isteğinde nerede taşındığı, kanca girdisinin alan adları, kurulum. Sınır:

**Normalize tasdik çerçevesi** (borudaki `pc_arac` girdisinin yeni hali; bugünkü alanların üst kümesi):

- `uyarlayici`: kapalı listeden ad (`claude-code`, …) ve sürüm.
- `cagri_id`: harness'ın her araç çağrısı için ürettiği, modelin seçemediği kimlik.
- `oturum_id`, isteğe bağlı `istem_id` (tur kimliği).
- `aktor`: `ana | alt | bilinmiyor`.
- `etkilesim`: `etkilesimli | etkilesimsiz | bilinmiyor`.

Karar (servis, harness'tan bağımsız): `insan` ⇔ çerçeve geçerli ∧ tek kullanımlık ∧ taze ∧ köprü bağlantısıyla
eşleşiyor (T5) ∧ `aktor = ana` ∧ `etkilesim = etkilesimli`. Diğer her şey sentetik (T2, T3).

**Uyarlayıcının görevleri** (harness başına küçük bir modül, ikisi de model dışında çalışır):

1. *Kanca tarafı*: harness'ın araç öncesi noktasının girdisini normalize çerçeveye çevirir. Claude
   uyarlayıcısında: `tool_use_id → cagri_id`, `prompt_id → istem_id`, `agent_id`/`agent_type` anahtarı
   varsa `alt`, yoksa `ana`; `CLAUDE_CODE_ENTRYPOINT ∈ sdk-*` ise `etkilesimsiz`, değilse `etkilesimli`
   (bugünkü davranış; 3.3 gereği ilk dilimde değişmez, izin listesine çevirme ayrı bir ölçüm işidir: 7).
2. *Köprü tarafı*: MCP isteğinden çağrı kimliğini hangi `_meta` anahtarından okuyacağını söyler
   (Claude: `claudecode/toolUseId`) ve köprünün oturum kimliğini hangi ortam değişkeninden alacağını söyler
   (Claude: `CLAUDE_CODE_SESSION_ID`). Köprü uyarlayıcıyı `--uyarlayici <ad>` ile alır; varsayılan
   `claude-code` (geri uyum).
3. *Sıra beyanı*: harness'ın "araç öncesi nokta bitmeden araç çalışmaz" garantisi var mı. Yoksa uyarlayıcı
   yalnız taslak üretebilir (kayıt yine çalışır).
4. *Kurulum*: MCP kaydı yönergesi, kanca kurma/kaldırma/teşhis (4.3).

**Çağrı kimliği eşleşmesi olmayan harness** (MCP isteğinde kimlik yok ya da kancada yok): tasdik kurulamaz;
uyarlayıcı yalnız MCP kaydını kurar, kayıtlar taslak doğar (T6). Bu durum teşhiste açıkça söylenir.

**Değerlendirilen ve önerilmeyen alternatif: MCP elicitation ile onay.** Araç çağrısında servis harness'tan
kullanıcıya "kaydedilsin mi" sorar; yanıtı harness arayüzü verir. Kanca gerektirmez ama: harness'ların
elicitation desteği ve otomatik kabul ayarları doğrulanmadı; etkileşimsiz oturumda davranış belirsiz; her
kayıtta soru kullanıcıyı yorar; telefondaki taslak onayı zaten aynı işi güvenle yapıyor. Gelecekte isteğe
bağlı bir yol olarak açık kalır.

**Değerlendirilen ve önerilmeyen alternatif: `pc_kanca` için ayrı anahtar.** Sınır işletim sistemi
kullanıcısı olduğu sürece aynı kullanıcının iki dosyası arasında gerçek ayrım sağlamaz; karmaşıklık ekler.

### 4.3 Kurulum

- `kurulum/claude-code.ts` → `kurulum/harness/claude-code.ts`; ortak arayüz `kurulum/harness/tur.ts`:
  `{ad, mcpKaydiYonergesi(kabuk), kancaDurumu, kancaKur, kancaKaldir, teshis}`. Güvenli JSON yazıcı
  (`ayarCoz`/`ayarYaz`/`yedekAl`) ortak yardımcıya ayrılır; TOML gerektiren harness (Codex `config.toml`,
  doğrulanmadı) kendi yazıcısını getirir ya da yalnız yönerge yazdırır.
- `eren eslestir --pc-ajan <ad>`; `--claude-code` takma ad olarak kalır (canlı kurulum ve belgeler bozulmaz).
- `ayarKur`'un `claude.exe` zorunluluğu kalkar: sürücü yapılandırılmamışsa eşleştirme yine yapılır, ana
  sohbet "motor yok" durumunu bildirir.
- Yol haritası 8'deki `--` / PowerShell sorunu bu dilimde `mcpKaydiYonergesi(kabuk)` ile kapanır.

### 4.4 Protokol ve telefon

Protokolde sürüm artışı gerekmez. `ServerStatus.limit` zaten isteğe bağlıdır; sürücü `kotaPencereleri`
vermezse alan gönderilmez, telefon gizler. Tüketimde cache alanları 0 kalabilir. Telefondaki
"Claude Code'un liste fiyatı" metni ve `IS_PROFILI_ACIKLAMASI` sürücü etiketiyle üretilir (ad, metin
değişikliği; ayrı küçük dilim). `ANA_SOHBET_ADI` ve varsayılan asistan adı değişmez (göç verisi; zaten
yapılandırılabilir).

---

## 5. Uyarlayıcıların ihtiyaçları (ölçülmemiş; web belgelerinden)

| Gereksinim | Claude Code (bugün) | Codex CLI | Gemini CLI | OpenCode |
|---|---|---|---|---|
| **Bağlayıcı:** araç öncesi nokta | `PreToolUse` komut kancası | `PreToolUse` komut kancası (`~/.codex/hooks.json`; `/hooks` ile onay gerekir) | `BeforeTool` komut kancası | JS/TS eklentisi `tool.execute.before`; alt agent çağrılarını atlayabildiği bildirilmiş (issue, doğrulanmadı) |
| Kancada çağrı kimliği | `tool_use_id` | `tool_use_id` | **yok** (belgede) | `callID` |
| MCP isteğinde aynı kimlik | `_meta["claudecode/toolUseId"]` (ölçüldü) | `_meta` tur metası var; çağrı kimliği **doğrulanmadı** | doğrulanmadı | doğrulanmadı |
| Alt agent ayrımı (kancada) | `agent_id`/`agent_type` (ölçüldü) | `SubagentStart/Stop`'ta var; `PreToolUse`'ta doğrulanmadı | doğrulanmadı | alt oturum (child session); eklentide doğrulanmadı |
| Etkileşim ayrımı | `CLAUDE_CODE_ENTRYPOINT` | alan yok (`exec` ayrımı ortamdan mı, doğrulanmadı) | doğrulanmadı | doğrulanmadı |
| **Sürücü:** etkileşimsiz akış | `-p` stream-json (girdi + çıktı) | `exec --json` JSONL (`thread.*`, `turn.*`, `item.*`) | `-p`, JSON/JSONL (`init`, `message`, `tool_use`, `result`) | `run`; biçim doğrulanmadı |
| Sürdürme | `--session-id`/`--resume` | `exec resume <id>` | doğrulanmadı | ACP'de var |
| ACP | yok (dış uyarlayıcı) | `codex-acp` uyarlayıcısı | `gemini --acp` | `opencode acp` |
| Yerleşik araç kısıtı (T8) | `--tools ""` + `--allowedTools` | doğrulanmadı | `excludeTools`/politika (doğrulanmadı) | doğrulanmadı |

Güncelleme (2026-11-27, kaynak kodu okuması, ölçülmedi): Codex sütunu `HARNESS-H3-OLCUM.md` bölüm 1 ile
düzeltilir. 0.172.0'da kanca MCP araçlarında da çalışır, MCP isteğinde `_meta.callId` vardır ve kancadaki
`tool_use_id` ile aynı kaynaktan gelir. `agent_id`/`agent_type` yalnız bir alt agent türünde doludur;
kancada etkileşim alanı yoktur. Bu makinedeki 0.120.0'da MCP araçları için kanca yoktur.

Not: Gemini CLI belgeleri, bazı hesap türlerinde Gemini CLI'nin başka bir CLI ile değiştirildiğini söylüyor;
ücretli/API yolunun durumu doğrulanmadı. Bu nedenle Gemini, ilk uyarlayıcı adayı değildir.

Sonuç: **bağlayıcı için en yakın aday Codex CLI'dir** (komut kancası + çağrı kimliği); tek açık, MCP isteğinde
aynı kimliğin taşınıp taşınmadığıdır. Taşınmıyorsa Codex bağlayıcısı taslak tabanında kalır. **Sürücü için
en geniş kapsam ACP'dir**: tek bir ACP sürücüsü birkaç harness'ı sürebilir; ancak ACP'deki izin isteği
isteğe bağlıdır, T8 kısıtını kendisi sağlamaz, kısıt her harness'ın kendi ayarından gelmelidir.

---

## 6. D5 ("Eren'e bağlan") için kural

Ajanda uygulaması ile servis arasındaki sürüm ve yetenek müzakeresi (D5, Kol C) harness adını taşımaz.
Yetenekler işlevle adlandırılır (ör. `pc_taslak_onayi`, `kota_bilgisi`), "Claude" ya da harness adı geçmez;
servisin bir harness'la çalışıyor olması bağlanmanın ön koşulu değildir (ajanda kanalı motor olmadan da
çalışır). Bu, D5'in bugünkü taslağıyla çelişmez; C'ye bilgi olarak iletilir.

---

## 7. Seçenekler ve öneri

| Seçenek | Ne | Artı | Eksi |
|---|---|---|---|
| **A. Yalnız bağlayıcı** | Tasdik çerçevesi + uyarlayıcı + kurulum soyutlaması; Claude uyarlayıcısı + bir ikinci (Codex) | Küçük; "kullanıcı kendi harness'ından Eren'e yazar" hemen gelir; servis motoru dokunulmaz | Eren'in kendisi hâlâ Claude Code ister |
| **B. A + sürücü arayüzü (yalnız Claude ile)** | `OturumSurucusu` sınırı çıkarılır, tek uygulaması Claude; davranış değişmez | İkinci sürücü sonra küçük kalır; tur zaman aşımı ve `.exe` sorunu bu sırada çözülür | En büyük yeniden düzenleme (`konusma.ts`, `isler*.ts`, `akis.ts`); Kol C ile servis dosyalarında çakışır |
| **C. B + ACP sürücüsü** | İkinci sürücü ACP üzerinden (önce OpenCode ya da Codex-ACP) | Birden çok harness tek sürücüyle | En çok ölçüm; T7/T8 her harness için ayrıca kanıtlanmalı |

**Öneri: A'dan başla, B'yi hemen ardından yap, C'yi ölçümden sonra karar ver.** Gerekçe: bağlayıcı küçük,
güvenlik tabanı zaten taşınabilir ve kullanıcıya en hızlı görünen kazanç orada; T5 bulgusu da bu sırada
kapanır. Sürücü sınırı (B) davranış değiştirmeyen bir yeniden düzenlemedir ve Kol C'nin servis işi
durulduktan sonra daha az çakışır. ACP sürücüsü (C), her harness için T7 ve T8'in gerçek araçla ölçülmesine
bağlıdır; ölçmeden karar verilmemeli.

### Dilimler

| Dilim | İçerik | Dokunduğu yer | Çakışma |
|---|---|---|---|
| **H1 – Tasdik çerçevesi** | Normalize çerçeve (`aktor`, `etkilesim`, `uyarlayici`), eski çerçeveyle geri uyum; T5 (oturum/bağlantı bağı); Claude uyarlayıcısı bugünkü kararları birebir üretir | `protocol/src/ajanda-pc*.ts`, `server/src/ajanda-pc.ts`, `kanca.ts`, `kopru.ts` (yalnız kimlik okuma), testler | C ile `protocol/src` ve servis ajanda dosyaları: sıra koordinatörden |
| **H2 – Kurulum soyutlaması** | `kurulum/harness/`, `eslestir --pc-ajan`, `--claude-code` takma adı, kabuğa göre yönerge, `ayarKur`'da `claude.exe` zorunluluğunun kalkması | `kurulum/**`, `server/src/eslestir.ts` | Az |
| **H3 – İkinci bağlayıcı (Codex)** | Önce ölçüm (çağrı kimliği MCP'de var mı, alt agent ve etkileşim alanları); sonra uyarlayıcı ya da "yalnız taslak" kaydı | `kurulum/harness/codex.ts`, kanca uyarlayıcısı | Yok |
| **H4 – Sürücü sınırı (yalnız Claude)** | `OturumSurucusu`, `NormalOlay`, yetenek beyanı; `.exe` sorunu; tur zaman aşımı | `konusma*.ts`, `isler*.ts`, `akis.ts`, `ayar.ts`, `sozlesme.ts` | C ile servis: C'nin D5 servis kısmından sonra |
| **H5 – Metinler** | Telefon ve istem metinlerinde harness etiketi | `protocol/src/plan.ts`, `app/` metinleri | Telefon uygulaması koordinatörde |
| **H6 – ACP sürücüsü** | Ölçüm sonrası karar | yeni dosya | — |

Her dilimin bitti tanımı yol haritası 7.4'tür; ek olarak Claude Code kurulumunda bugünkü testler (2.7)
değiştirilmeden ya da yalnız yer değiştirerek geçer.

---

## 8. Kullanıcıya sorulacaklar

1. "Herkesin kendi harness'ı" öncelikle hangisi: kullanıcının kendi oturumundan Eren'e yazabilmesi
   (bağlayıcı), Eren'in kendisinin başka harness'la çalışması (sürücü), ikisi?
2. İkinci harness olarak hangisi: öneri Codex CLI (bağlayıcı için en yakın); kullanıcının kullandığı bir
   harness varsa o.
3. Başka harness için kimlik politikası: Claude'da "yalnız abonelik girişi" (`apiKeySource`) zorlanıyor.
   Başka harness'ta API anahtarıyla çalışmaya izin verilsin mi?
4. Etkileşimsiz ayrımını yasak listesinden izin listesine çevirmek (daha güvenli; masaüstü uygulaması gibi
   yeni giriş türlerinin `insan` sayılmasını keser) ölçüm ister ve canlı davranışı değiştirebilir:
   H1'e girsin mi, ayrı mı kalsın? Öneri: ayrı, ölçümden sonra.
5. `packages/bellek` ve `opus-orkestra` (beyin, devir, kapı, orkestra kancaları) bu kolun kapsamına
   girsin mi? Öneri: hayır; ayrı bir kol, beyin zaten MCP.

## 9. Bilinen açıklar (bu dökümde bulunan, harness'tan bağımsız)

- Tasdik oturum/bağlantıya bağlı değil (2.3; H1'de kapanır).
- Ana oturumda turun zaman aşımı yok: `result` gelmezse kuyruk durur (2.2; H4).
- `claude_exe` yalnız `.exe`; npm kısayolu başlatılamaz (2.1; H4).
- Alt agent ayrımı tek bir harness alanına, etkileşimsiz ayrımı yasak listesine dayanır (2.3; 8.4).
