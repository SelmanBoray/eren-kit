# H3 ölçümü: Codex CLI bağlayıcısı

Durum: **ölçüldü (2026-11-28, kullanıcı onayıyla); sonuç bölüm 6'da: yalnız taslak.** Kol H, `HARNESS.md`
dilim H3'ün ilk adımı. Belge neyin, nasıl ve hangi güvenlik koşullarıyla ölçüldüğünü (bölüm 1–5, plan
2026-11-27) ve ne çıktığını (bölüm 6) söyler.

Amaç: Codex CLI'de, `HARNESS.md` 4.2'deki normalize tasdik çerçevesinin (`cagri_id`, `oturum_id`, `aktor`,
`etkilesim`) güvenilir biçimde doldurulup doldurulamayacağını gerçek araçla göstermek. Sonuç iki taneden
biridir: **tam tasdik** (insan kararı verilebilir) ya da **yalnız taslak** (MCP kaydı kurulur, kayıtlar
telefondan onaylanır; T6).

---

## 1. Ölçmeden önce bilinenler (kaynak kodu okuması; ölçülmedi)

Kaynak: `openai/codex` deposu, etiketler `rust-v0.120.0` ve `rust-v0.172.0` (2026-11-24, okuma günündeki son
sürüm). Bunlar kod okumasıdır; sürüm, yapılandırma ya da platform farkı davranışı değiştirebilir. Her madde
bölüm 3'te ölçülür.

| Konu | 0.120.0 | 0.172.0 |
|---|---|---|
| Kanca özelliği | `codex_hooks`, "under development", kapalı | `hooks`, kararlı, varsayılan açık |
| `PreToolUse` kapsamı | Girdi şemasında `tool_name` sabit `"Bash"`, `tool_input` yalnız `command`: MCP araçları için kanca yok | `tool_name` serbest dizge; kanca bütün araçlar için çalışır |
| Kanca girdisi | `session_id`, `turn_id`, `tool_use_id`, `permission_mode`, `model`, `cwd`, `transcript_path` | Aynısı + isteğe bağlı `agent_id`, `agent_type` |
| MCP `tools/call` `_meta` | Yalnız `x-codex-turn-metadata` (`session_id`, `turn_id`, çalışma alanı bilgisi); çağrı kimliği yok | `callId`, `threadId`, `sessionId`, `x-codex-turn-metadata`; koşullu `windowId`, `itemId` |
| Kimliklerin kaynağı | — | Kancadaki `tool_use_id` ve `_meta.callId` aynı değerden (`invocation.call_id`) geliyor (`core/src/tools/registry.rs`, `core/src/mcp_tool_call.rs`) |
| Alt agent alanları | yok | `agent_id`/`agent_type` yalnız `SubAgentSource::ThreadSpawn` için dolu (`core/src/hook_runtime.rs`). `Review`, `Compact`, `MemoryConsolidation`, `Other(..)` kaynaklarında bu alanlar **yok**: o oturumlar kancada ana agent gibi görünür |
| Etkileşim ayrımı | — | Kanca girdisinde oturum kaynağı (`SessionSource`: `Cli`, `VSCode`, `Exec`, `Mcp`, `Custom`, `Internal`, `SubAgent`, `Unknown`) **yok**. Bilinen tek ilgili alan `permission_mode` ve etkileşimli olup olmadığını söylemez |
| Sıra | — | `PreToolUse`, araç işleyicisinden önce `await` ediliyor ve aracı engelleyebiliyor (`registry.rs`) |

Bu makinede kurulu sürüm **0.120.0** (npm global). Bu sürümle Codex bağlayıcısı ancak **yalnız taslak**
olabilir: MCP aracı için kanca çalışmaz, MCP isteğinde çağrı kimliği yoktur.

Çıkan sonuçlar:

1. Çağrı düzeyinde eşleşme (`tool_use_id` ↔ `_meta.callId`) 0.172.0'da Claude'daki modelle aynı biçimde
   mümkün görünüyor. Ölçülecek.
2. **Alt agent yasak listesi sorunu Codex'te de var.** Yalnız bir alt agent türü işaretleniyor. Kancada
   `agent_id` yokluğu "ana" demeye yetmez (T3). Ek bir ayırt edici gerekiyor (bölüm 3, Ö4–Ö5).
3. **Etkileşim ayrımı için kancada alan yok.** Ölçümde güvenilir bir işaret bulunmazsa `etkilesim =
   bilinmiyor` olur, T2/T3 gereği her kayıt taslak doğar. Codex bağlayıcısı o durumda tam tasdik veremez.
   Bu, ölçümün en olası "hayır" noktasıdır.

`HARNESS.md` bölüm 5'teki Codex sütununu bu bulgular düzeltir: "MCP isteğinde çağrı kimliği doğrulanmadı"
yerine "0.172.0 kaynak kodunda `_meta.callId` var, ölçülmedi"; "`PreToolUse`'ta alt agent doğrulanmadı"
yerine "yalnız ThreadSpawn için `agent_id`/`agent_type`".

## 2. Ölçüm düzeni ve güvenlik koşulları

- **Makine geneline dokunulmaz.** Global npm paketi yükseltilmez. Codex 0.172.0 (ya da o günün son
  sürümü, sürüm numarası kaydedilir) geçici bir dizine yerel olarak kurulur (`npm install --prefix <geçici>`).
  Bu indirme, ölçüm başlamadan önce onay ister.
- **Kullanıcının Codex ayarlarına dokunulmaz.** `CODEX_HOME` geçici bir dizine ayarlanır; `~/.codex`
  okunmaz, yazılmaz (`auth.json` dahil).
- **Gerçek model ve hesap kullanılmaz.** Codex'e yerel bir sahte sağlayıcı verilir: yapılandırmadaki
  `model_providers` ile `base_url` yerel bir HTTP sunucusunu gösterir. Sunucu, Responses API akış biçiminde
  önceden yazılmış yanıtlar döner (sırayla: MCP aracını çağır; alt agent başlat ve alt agent'ta MCP aracını
  çağır; bitir). Böylece ölçüm belirlenimci olur, giriş gerektirmez ve dışarıya veri gitmez. Sahte
  sağlayıcının Codex'in beklediği akış biçimini karşıladığı ilk adımda doğrulanır. Karşılamıyorsa yedek yol,
  ikilinin içindeki test düzeneği değişkeni `CODEX_RS_SSE_FIXTURE`'dır; belgesiz olduğu için önce okunur.
  İkisi de olmazsa gerçek hesapla ölçüm ayrı bir onaya kalır.
- **Canlı servis ve canlı boru kullanılmaz.** Ölçüm Eren servisine bağlanmaz. Kaydedici MCP sunucusu ve
  kaydedici kanca yalnız geçici dizine dosya yazar.
- **Kayıtta sır yok.** Kaydediciler ortam değişkenlerinin yalnız **adlarını** yazar; değer yalnız `CODEX_*`
  ve kimlik biçimli alanlarda yazılır. Ölçüm çıktısı depoya girmeden önce kişisel yol ve ad için süzülür.
- Ölçüm araçları atılabilir. Depoya alınırsa `apps/ajanda-olcum` gibi ayrı bir klasöre gider; sahipliği
  koordinatörle çizilir.

Ölçüm araçları:

1. **Kaydedici MCP sunucusu** (stdio, tek araç `kaydet`). Gelen `tools/call` isteğinin `params` kısmını
   (özellikle `_meta`), `initialize` içindeki `clientInfo`'yu, varış anını (ms) ve ortam değişkeni adlarını
   JSONL'e yazar.
2. **Kaydedici kanca** (`PreToolUse`, eşleyici yalnız kaydedici MCP aracı). stdin JSON'unu, ortam
   değişkeni adlarını, başlangıç ve bitiş anını yazar. Bitirmeden önce 1,5 sn bekler. Her durumda 0 ile
   çıkar, karar döndürmez (bugünkü `kanca.ts` gibi).
3. **Sahte sağlayıcı** (yalnız ölçüm senaryoları için).

## 3. Ölçümler

| No | Ne | Nasıl | Geçme ölçütü |
|---|---|---|---|
| Ö0 | Düzen çalışıyor mu | `codex exec`, sahte sağlayıcı, kaydedici MCP; tek çağrı | MCP kaydı ve kanca kaydı oluşur |
| Ö1 | Kanca MCP aracı için tetikleniyor mu, araç adı biçimi | Ö0 kayıtları; eşleyici biçimleri (`mcp__<sunucu>__<araç>`, düz ad, düzenli ifade) tek tek denenir | Kanca kaydında `tool_name` biçimi kesin; tetikleyen eşleyici biçimi belli |
| Ö2 | Çağrı kimliği eşleşmesi | Aynı çağrının kanca `tool_use_id` değeri ile MCP `_meta.callId` değeri karşılaştırılır; ardışık üç çağrı ve aynı turda iki paralel çağrıyla | Her çağrıda eşit, çağrılar arasında farklı |
| Ö3 | Oturum kimliği | Kanca `session_id` ile MCP `_meta.sessionId`, `_meta.threadId`, `x-codex-turn-metadata.session_id`; MCP sunucu sürecinin ortamında oturum kimliği taşıyan bir değişken var mı (Claude'daki `CLAUDE_CODE_SESSION_ID` karşılığı) | T5 için köprü tarafında güvenilir bir oturum kimliği kaynağı belli. Yoksa T5, oturum yerine bağlantı düzeyinde kurulur (karar notu) |
| Ö4 | ThreadSpawn alt agent | Sahte sağlayıcı ana turda alt agent başlatır, alt agent kaydedici aracı çağırır | Kancada `agent_id`/`agent_type` dolu. Ek olarak `_meta.threadId` ana oturumunkinden farklı mı, `x-codex-turn-metadata` içinde ayırt edici alan var mı |
| Ö5 | Diğer alt oturum türleri | `codex exec review` ve bağlam sıkıştırma (`Compact`) yolunda MCP aracı çağrılabiliyor mu; çağrılabiliyorsa kanca girdisi neye benziyor | Bu yollar MCP aracı çağıramıyor, ya da kancada/`_meta`'da ana agent'tan ayırt edilebiliyor. İkisi de değilse "ana" kararı verilemez: tam tasdik yok |
| Ö6 | Etkileşim ayrımı | Aynı senaryo `codex exec` ile ve etkileşimli `codex` ile. Kanca girdisi, kanca sürecinin ortamı ve MCP `_meta` karşılaştırılır. Etkileşimli koşu kullanıcının bir terminalde tek bir komut çalıştırmasını gerektirebilir (sahte sağlayıcıyla, hesapsız) | `exec`'i etkileşimliden **izin listesiyle** ayıran, modelin değiştiremeyeceği bir işaret var. Yoksa `etkilesim = bilinmiyor` |
| Ö7 | Sıra garantisi | Kancanın bitiş anı ile MCP isteğinin varış anı karşılaştırılır (kanca 1,5 sn bekler); kanca zaman aşımında ve kanca hata verdiğinde araç çalışıyor mu | MCP isteği her zaman kanca bitiminden sonra geliyor. Zaman aşımı ve hata durumu kayıtlı |
| Ö8 | Kanca güven ve onay adımı | Boş `CODEX_HOME`'da kanca ilk koşuda onay istemeden çalışıyor mu; `exec`'te ve etkileşimlide ayrı ayrı | Kurulumun ne yazması ve teşhisin ne söylemesi gerektiği belli |
| Ö9 | Windows'ta kanca yürütmesi | Kanca komutu hangi kabukla ve hangi tırnaklamayla çalışıyor; `node <betik>` biçimi | `kurulum/harness/codex.ts`'nin yazacağı komut biçimi belli |
| Ö10 | MCP kaydı | `codex mcp add` sözdizimi; PowerShell ve Git Bash'te `--` ayırıcısı; `config.toml` içindeki biçim | H2'nin `mcpKaydiYonergesi(kabuk)` arayüzü Codex için doldurulabiliyor |
| Ö11 | Model kimlik taklidi | Sahte sağlayıcı, araç girdisinde ve metinde `callId`/`tool_use_id`/`agent_id` benzeri alanlar üretir | Modelin ürettiği hiçbir değer kanca girdisine ya da `_meta`'nın kimlik alanlarına geçmiyor (T1) |

Kaydedici iz sürer, karar vermez. Kararı ölçümden sonra bölüm 4 verir.

## 4. Sonuca göre karar

| Ölçüm sonucu | Codex uyarlayıcısı |
|---|---|
| Ö1, Ö2, Ö7, Ö11 geçti; Ö4–Ö5 alt agent ayrımı izin listesiyle kurulabiliyor; Ö6 etkileşim işareti var | **Tam tasdik.** `aktor` ve `etkilesim` izin listesiyle; T5 için Ö3'teki kaynak |
| Ö1, Ö2, Ö7, Ö11 geçti; Ö5 ya da Ö6 kaldı | **Yalnız taslak.** Ölçüm notu belgeye girer; gelecekteki Codex sürümünde yeniden ölçülür |
| Ö1 ya da Ö2 kaldı | **Yalnız taslak.** Kurulum yalnız MCP kaydını yapar, kanca kurmaz |
| Ö0 sahte sağlayıcıyla kurulamadı | Gerçek hesapla ölçüm için kullanıcı onayı istenir |

Her durumda: kurulu sürüm için en düşük Codex sürümü kurulumda denetlenir; altında kalan sürüm yalnız
taslak alır ve teşhis bunu söyler.

## 5. Onay ya da karar isteyenler

1. Codex'in güncel sürümünün **geçici dizine** indirilmesi (npm'den; global değil, `~/.codex`'e dokunmaz).
2. Ö6'nın etkileşimli koşusu kullanıcının bir terminalde tek komut çalıştırmasını gerektirebilir.
3. Global Codex'in 0.120.0'dan yükseltilmesi **bu planın parçası değil**. Kullanıcının kendi kurulumu için
   gerekirse makine geneli değişiklik olarak ayrıca sorulur.
4. Ölçüm araçları atılabilir mi kalsın, yoksa depoda ayrı bir ölçüm klasörü mü olsun.

Kararlar (2026-11-28): (1) kullanıcı onayladı; (4) araçlar atılabilir, geçici dizinde kaldı, depoya yalnız
bu belge girer.

## 6. Sonuç (2026-11-28)

Codex CLI 0.172.0, geçici dizine yerel kuruldu. Global 0.120.0'a dokunulmadı. Her koşuda boş `CODEX_HOME`
kullanıldı; kullanıcının `~/.codex`'i okunmadı. Sahte sağlayıcı (yerel Responses API akışı) ilk denemede
çalıştı. Dışarı giden her istek kaydedici vekilde reddedildi:
- exec: ilk koşu `github.com`, `api.github.com` ve `chatgpt.com`'u denedi. `plugins`, `apps`, `remote_plugin`,
  `tool_suggest` ve `skill_mcp_dependency_install` kapatılınca sıfıra indi.
- Etkileşimli arayüz: her açılışta `raw.githubusercontent.com`'u deniyor.

| No | Sonuç | Gözlem |
|---|---|---|
| Ö0 | geçti | Düzen çalıştı. Bir koşuda MCP sunucusu ilk model isteğine yetişmedi; tekrarı temiz |
| Ö1 | geçti | Kancada `tool_name` = `mcp__<sunucu>__<araç>`. Tam ad, düzenli ifade, `*` ve eşleyicisiz grup tetikliyor; düz araç adı tetiklemiyor |
| Ö2 | geçti | Kanca `tool_use_id` = MCP `_meta.callId`: her çağrıda eşit, çağrılar arasında farklı, aynı yanıttaki paralel çağrılarda da. Değeri sağlayıcı seçer. Yinelenen kimliği Codex iki kez yürütür; tekilliği servisin tek kullanımlık kuralı sağlar |
| Ö3 | kısmen | MCP süreç ortamında oturum kimliği yok. `_meta.sessionId` = kanca `session_id`; alt agent'larda kök oturum gelir. Ortak süreç: kancanın büyük ebeveyni ile MCP sunucusunun ebeveyni aynı `codex.exe` (kancanın ebeveyni bir kabuk). Alt agent'lar ayrı MCP süreci alır. `/clear` ölçülemedi |
| Ö4 | geçti | ThreadSpawn alt agent'ında kanca `agent_id`/`agent_type` verir; `_meta`'da `thread_source=subagent` ve farklı `threadId` |
| Ö5 | kancada kaldı | review alt oturumu MCP aracını çağırabiliyor ve kancada `agent_id` yok, yani ana agent gibi görünüyor. `_meta`'da `subagent_kind=review` ile ayrılıyor. Compact araç çağıramıyor |
| Ö6 | kancada kaldı | exec ile etkileşimli koşunun kanca girdisi alan alana aynı. `_meta.turn_trigger` exec'te `exec`, etkileşimlide `user`. Ama bu istemci beyanı: etkileşimsiz bir app-server istemcisi `user` bildirebiliyor |
| Ö7 | geçti | MCP isteği her zaman kanca bitiminden sonra gelir. Kanca zaman aşımında ya da 1/2 çıkışında araç yine çalışır; tasdik olmadığı için kayıt taslak doğar |
| Ö8 | ölçüldü | exec'te güvenilmemiş kanca uyarısız atlanır. Etkileşimli arayüz açılışta "Hooks need review" sorar; onay `config.toml`'a `hooks.state.'<yol>:pre_tool_use:0:0'.trusted_hash` yazar. Karma algoritması bilinmiyor, kurulum bunu yazamaz |
| Ö9 | geçti | Kanca komutu Windows'ta `powershell.exe -NoProfile -Command` ile çalışır. Başında `&` olmayan tırnaklı exe yolu sessizce hiç başlamaz. Çalışan biçim: `commandWindows = '& "<node.exe>" "<kanca>" …'` |
| Ö10 | geçti | `codex mcp add <ad> [--env K=V] -- <komut>…`: PowerShell 7, 5.1 ve Git Bash'te, `--` ile ve `--` olmadan aynı `config.toml` çıktı. exec'te araç onayı için `approval_mode = "approve"` gerekir |
| Ö11 | geçti | Modelin argümanlara, metne ve iç içe `_meta` taklidine koyduğu kimlik alanları kanca girdisine ve `_meta`'nın kimlik alanlarına geçmedi |

**Karar: yalnız taslak** (bölüm 4, ikinci satır). Çağrı kimliği eşleşmesi ve sıra var. Engeller:
- Kanca tek başına `aktor`'u (review alt oturumu) ve `etkilesim`'i (exec ile etkileşimli) güvenilir biçimde veremiyor.
- İkisinin ayrımı yalnız MCP `_meta`'sında var. Bunu kullanmak, köprünün de `aktor`/`etkilesim` bildirmesini, yani çerçevenin değişmesini gerektirir.
- Etkileşim işareti (`turn_trigger`) istemcinin kendi beyanı, model dışı ama harness dışı istemcilerce de üretilebilir.

T5 için ortak süreç işareti var (ebeveyn `codex.exe`). Okuması 1,6–4,5 sn sürüyor ve kancanın 2 sn sınırına
sığmıyor. Codex uyarlayıcısında süreç kaynağı bu yüzden ayrıca tasarlanmalı.

Tam tasdik için önce iki şey gerekir:
1. Çerçeve değişikliğine karar verilmeli: köprü tarafından `aktor`/`etkilesim`, harness başına izin listesiyle.
2. Şunlar yeniden ölçülmeli:
   - Codex'in varsayılan daemon kipi (bu ölçüm `--no-daemon` ile yapıldı; geçici dizin yolu Unix soket uzunluk sınırını aştı).
   - VS Code ve masaüstü istemcileri.
   - MemoryConsolidation, guardian ve Other alt oturumları.
   - `/clear` (sözde terminalde yapılamadı).

Ölçülemeyenler: yukarıdaki dört madde ve `trusted_hash` algoritması. Bunlar karar değiştirmez; tam tasdik
istenirse yeniden ölçülür.

Ölçülmedi: gerçek köprüyle uçtan uca kayıt. Bu ölçümde Codex'e kaydedici MCP sunucusu bağlandı (bölüm 2); canlı
servis kullanılmadı. Gerçek `kopru.ts --rol pc_oturumu --uyarlayici codex`'in Codex altında başlayıp servise
bağlandığı ve kaydın taslak doğduğu denenmedi. Codex köprüsünü bugün yalnız birim ve birleşim testleri sınar (bellek
içi MCP istemcisiyle, Codex olmadan). Codex yönergesi bu yüzden "kayıtlar çalışır" demez, ölçülmediğini söyler; ilk
gerçek sınama yönergenin 4. adımıdır.
