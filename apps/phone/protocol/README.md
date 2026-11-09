# @eren/protocol

Telefon uygulaması, bilgisayar servisi ve MCP köprülerinin ortak mesaj sözleşmesi. Tipler ve çalışma zamanı doğrulayıcıları tek tanımdan, zod şemalarından türer.

```ts
import { Plan, planHash, sohbetYukariCoz, type SohbetAsagi } from "@eren/protocol";

const sonuc = sohbetYukariCoz(hamMetin);
if (!sonuc.ok) return sonuc.kod; // mesaj_cok_buyuk | gecersiz_mesaj | protokol_uyumsuz
```

Derleme adımı yoktur. Node 24 kaynağı doğrudan çalıştırır (tip soyma), Metro kaynak olarak paketler. `node:` modülü ve ortam API'si kullanılmaz; bunu tip denetimi (`types: []`, `lib: ES2022`) ve test birlikte sabitler.

```
npm test -w protocol
npm run typecheck -w protocol
```

## Bağımlılık

Tek bağımlılık `zod`, sürüm kilitli. Geçişli bağımlılığı yoktur, JSON Schema çıktısını da kendisi üretir ve MCP tarafıyla ortaktır. Hermes'te çalışır; paket `z.config({ jitless: true })` ile açılır, böylece `new Function` denenmez ve Node ile Hermes aynı doğrulama yolundan geçer. `app/` çalışma alanı Metro'da `watchFolders` içine depo kökünü koymalıdır.

## Kurallar

- **Her mesajda sürüm:** `v` tam olarak kanalın ve türün sürümüdür (aşağıda "Sürümleme"). Mesaj kurucuları `mesaj` (v1) ve `sohbetMesaj` (`/sohbet`, `SOHBET_SURUMU`) bunu şemaya koyar.
- **Bilinmeyen alan hatadır.** Her nesne `strictObject`. Yok sayılmaz, çünkü yok sayılan alan onaylanmış özetin dışında kalırdı.
- **Tüm girdiler güvenilmez.** Her metin ve dizi alanının sınırı `SINIRLAR`, çerçevelerinki `AZAMI_CERCEVE` içindedir. Çözücüler (`sohbetYukariCoz` ve benzerleri) boyutu ayrıştırmadan önce denetler, hiç atmaz, gelen değeri hata çıktısına koymaz. Taşıma katmanı aynı sınırı baytta da uygular.
- **Plan metinlerinde** kontrol, sıfır genişlik ve yön karakterleri reddedilir; tek satırlık alanlarda satır sonu da. Onay ekranında görünen, özeti alınan metindir.

## Sürümleme

İki tam sayı, ikisi de `src/sinirlar.ts` içinde:

- `PROTOKOL_SURUMU` (= 1): `/cihaz`, köprü borusu, QR (`EslestirmeQr`), eşleştirme (`pair_request`, `pair_result`) ve kimlik imza metninin öneki (`eren-auth-v1`). Kotlin bu değeri ve `SINIRLAR` bloğunu birebir kopyalar (`Sinirlar.kt`; `SozlesmeTest.kt` değeri ve anahtar kümesini sınar), eşleştirme ekranı `v == 1`'i elle denetler. Süren iş oturumlarının köprüleri de v1 konuşur. Bu yüzden **artmaz**.
- `SOHBET_SURUMU` (= 4): eşleştirme dışındaki bütün `/sohbet` mesajları. Telefon uygulaması (JS) ve servis birlikte güncellenir. `kurulum/kur.ts` bu değeri `sinirlar.ts`'ten metin olarak okur (`export const SOHBET_SURUMU = <n>` satırı; test sabitler).

`/sohbet` sürüm geçmişi:

| `SOHBET_SURUMU` | Dilim | Gelenler |
|---|---|---|
| 1 | — | `PROTOKOL_SURUMU` ile aynıydı (ayrı sabit yoktu) |
| 2 | 1 | `chat_clear` ↑, `chat_cleared` olayı, `server_status.servis`, `sohbet_mesgul` |
| 3 | 2 (çoklu sohbet) | `chat_create`, `chat_rename`, `chat_delete` ↑; `chat_created`, `chat_renamed`, `chat_deleted` olayları; zorunlu `sohbet_id`: `user_message`, `interrupt`, `chat_clear` ↑, `assistant_delta`, `stream_snapshot` ↓; olay zarfına isteğe bağlı `sohbet_id`; `server_status.eren` yerine `server_status.sohbetler`; `sohbet_bulunamadi`, `sohbet_siniri`, `sohbet_silinemez` |
| 4 | 3 (kısayol) | `GIRDI_YOLLARI`'na `kisayol`; `user_message` ↑ ve `user_echo` olayında isteğe bağlı `baglam{paket, ad}` (yalnız `input:"kisayol"` iken) |

| Kanal | Mesaj | `v` | Kotlin |
|---|---|---|---|
| `/sohbet` | `pair_request` ↑, `pair_result` ↓ | 1 | Kurar / `v == 1` ve alan kümesiyle doğrular |
| QR | `EslestirmeQr` | 1 | `v == 1` ile doğrular |
| `/sohbet` | `hello`, `auth_response`, `user_message`, `interrupt`, `plan_decision`, `question_answer`, `job_cancel`, `chat_clear`, `chat_create`, `chat_rename`, `chat_delete` ↑; `auth_challenge`, `welcome`, `ack`, `assistant_delta`, `stream_snapshot`, `event`, `server_status`, `error` ↓ | 4 | Görmez: çerçeveyi JS kurar ve çözer, Kotlin yalnız `client_nonce` ve imza verir |
| `/sohbet` | `usage_request{istek_id}` ↑; `usage_report{istek_id, olcum_ms, gun_baslangic_ms, bugun, son_7_gun, sohbetler[{sohbet_id, toplam}], silinmis_sohbetler?, isler[{is_id, toplam}]}` ↓ | `SOHBET_SURUMU` | Görmez (JS). `bugun`, `son_7_gun`, `silinmis_sohbetler`, `toplam` (sohbetler): `TuketimIkilisi{sohbet, is}`; `isler[].toplam`: `TuketimToplami{girdi, cache_yazma, cache_okuma, cikti, sonuc_adet, maliyet_usd?}`. `sohbetler` en çok `SOHBET_ADET`, tekil; `isler` en çok `TUKETIM_IS_ADET` (50), `is_id` kesin azalan |
| `/cihaz` | hepsi | 1 | Hepsini `v == 1` ile çözer |
| Boru | hepsi | 1 | Yok |
| İmza metni | `eren-auth-v1` | 1 | `KimlikMetni.kt` aynı metni kurar |

Çözücü kanal başına sürüm seçer: `cozumle(sema, ham, sinir, surum)`; `/sohbet` için seçici `sohbetSurumu(type)` (`SOHBET_V1_TURLERI` dışındaki her tür `SOHBET_SURUMU`), `/cihaz` ve boru için sabit 1. Sayı olan ama beklenmeyen `v` şemadan önce `protokol_uyumsuz` döner; eski APK'nın v1 ya da v2 `hello`'su da böyle, ilk çerçevede açık hatayla reddedilir. Eski APK ile uyumluluk aranmaz: tek kullanıcı, servis ve APK birlikte güncellenir.

`/sohbet`'e özgü sınırlar `SINIRLAR`'a eklenmez (Kotlin anahtar kümesi testi), `SOHBET_SINIRLARI`'ndadır: `SERVIS_SURUMU` (64), `SOHBET_ADI` (60), `SOHBET_ADET` (8). `/sohbet`'e özgü hata kodları (`SOHBET_HATA_KODLARI`: v2'de `sohbet_mesgul`, v3'te `sohbet_bulunamadi`, `sohbet_siniri`, `sohbet_silinemez`) `HATA_KODLARI`'nın sonundadır; v1 mesajları (`/cihaz` `error`, `pair_result`) `HataKoduV1` ile doğrulanır, bu kodları taşımaz (test v1 kümesini Kotlin `HataKodu` sırasıyla sabitler). Boru şeması `HataKodu`'nu kullanmaya devam eder, ama boruda bu kodları dönen fiil yoktur. `plan_oner` girdisine eklenen isteğe bağlı `profil` borudaki v1 köprüsünü kırmaz: alanı göndermeyen eski köprü geçerli kalır.

Kural, kanal başına: mesaj, alan, kapalı liste öğesi eklemek ya da sınırı düşürmek o kanalın sürüm artışıdır, çünkü karşı taraf bilinmeyeni reddeder. Sınırı yükseltmek de eski alıcıyı kırdığı için artıştır. Sürümler arası uyumluluk yoktur: iki taraf aynı sürümde olmalıdır, değilse `protokol_uyumsuz` döner. `plan_hash` kuralı değişirse `PROTOKOL_SURUMU` artar (Kotlin özeti yeniden hesaplar); bu, Kotlin değişikliği demektir.

## Kanallar

| Kanal | Taraflar | Şema | Çözücü |
|---|---|---|---|
| `/sohbet` | Uygulama, servis | `SohbetYukari`, `SohbetAsagi`, `Olay` | `sohbetYukariCoz`, `sohbetAsagiCoz` |
| `/cihaz` | Kotlin servisi, servis | `CihazYukari`, `CihazAsagi` | `cihazYukariCoz`, `cihazAsagiCoz` |
| Adlandırılmış boru | MCP köprüsü, servis | `KopruYukari`, `KopruAsagi` | `kopruYukariCoz`, `kopruAsagiCoz` |

`/cihaz` alan alan: [CIHAZ.md](CIHAZ.md). MCP araç girdi ve çıktıları: `EREN_ARACLARI`, `SORU_ARACLARI`, `TELEFON_ARACLARI`. JSON Schema için `jsonSemasi(sema)`, `claude --json-schema` için `isRaporuJsonSemasi()`. Hata kodları: `HATA_KODLARI`.

### `/sohbet` akışı

1. Eşleşme yoksa: `pair_request` → `pair_result`. QR içeriği `EslestirmeQr`.
2. `hello{last_seq}` → `auth_challenge` → `auth_response` → `welcome{head_seq}`. Sonra eksik `event`ler sırayla, varsa `stream_snapshot`, `server_status`.
3. `event.event` kalıcı olaydır, tek artan `seq` taşır; `seq` ve telafi bütün sohbetler için küreseldir (tek bağlantı, tek outbox, tek `last_seq`). Telafide her canlı tur için (sohbet başına en çok bir) bir `stream_snapshot{sohbet_id, turn_id, text}` gelir. `assistant_delta` ve `server_status` kalıcı değildir. `server_status.sohbetler` silinmemiş her sohbetin ana oturum durumudur (aşağıda "Çoklu sohbet"); `kilitli`, `aktif_is`, RAM alanları, `servis`, `limit` küreseldir. `server_status.servis{surum, baslangic_ms}` her zaman vardır: `surum` çalışan sürümün `surum.json` `sha`'sı, geliştirme kopyasından çalışıyorsa `null`; `baslangic_ms` servis sürecinin başladığı an. `server_status.limit?` isteğe bağlıdır: `bes_saat?`, `haftalik?` (doluluk, 0-1) ve `bes_saat_sifirlanma_ms?`, `haftalik_sifirlanma_ms?` (sıfırlanma, epoch ms); alan yoksa istemci bilinmiyor sayar.
4. Kimlik sonrası her yukarı mesaj `client_msg_id` taşır ve `ack` alır. `ack.ok: false` ise `code` vardır, yeniden yollanmaz. Aynı kimlik yeniden gelirse servis aynı `ack`'i döner, ikinci kez işlemez. İstisna: `usage_request` `client_msg_id` taşımaz, `ack` almaz, kalıcı kuyruğa (outbox) girmez; yanıtı `usage_report` ile `istek_id` üzerinden eşleşir.

`interrupt{sohbet_id, turn_id?}` yalnız o sohbetin ana oturumunu keser. `turn_id` verilirse yalnız o tur kesilir; tur bittiyse ya da o sohbetin değilse `tur_gecersiz` döner.

### Çoklu sohbet (v3)

"İki farklı ana oturum" aynı asistanın iki ayrı konuşmasıdır: her sohbetin kendi Claude oturum zinciri ve bağlamı vardır, kişilik farkı yoktur.

**Kimlik.** `sohbet_id` (`SohbetId` = `OpakId`: `[A-Za-z0-9_-]`, 1-64 birim, `SINIRLAR.OPAK_ID`) telefonda üretilir, servis yalnız saklar; böylece `chat_create` çevrimdışıyken outbox'ta bekleyebilir. Varsayılan sohbet `ANA_SOHBET_ID` = `"ana"`: dilim 2'den önceki bütün geçmiş onundur, göçle vardır (`chat_created` olayı yoktur, ilk adı `ANA_SOHBET_ADI` = "Claude"), silinemez, yalnız temizlenir ve yeniden adlandırılabilir. Silinmiş bir sohbetin kimliği bir daha kullanılmaz. Silinmemiş sohbet sayısı en çok `SOHBET_ADET` (8), `ana` dahil.

**Sohbet anahtarı.** Bir kaydın (olay, mesaj, depo satırı, outbox öğesi) sohbeti yalnız `sohbetAnahtari(kayit)` ile okunur: `sohbet_id` metinse odur, yoksa `"ana"`. Sohbete bağlı her olayı (konuşma, plan, iş, soru, devir, mezar taşı, o sohbetin ana oturumunun notu) servis `sohbet_id` ile yazar, `ana` dahil. Alanı olmayan olay küreseldir (kilit, RAM, servis yeniden başladı, uzlaştırma gibi `system_notice`'lar) ya da v3'ten eskidir; ikisi de `ana` sayılır ve `ana`'da gösterilir. Olay zarfında alan her türde isteğe bağlıdır, yaşam döngüsü olaylarında zorunludur.

**Hangi mesaj `sohbet_id` taşır.**

| Mesaj | `sohbet_id` |
|---|---|
| `user_message`, `interrupt`, `chat_clear`, `chat_create`, `chat_rename`, `chat_delete` ↑ | Zorunlu |
| `assistant_delta`, `stream_snapshot` ↓ | Zorunlu |
| `chat_created`, `chat_renamed`, `chat_deleted` olayları | Zorunlu |
| Diğer olaylar (`event.event`) | İsteğe bağlı (yoksa `ana`) |
| `plan_decision`, `question_answer`, `job_cancel` ↑ | Taşımaz: plan, soru ve iş kimlikleri küresel tekildir, sohbeti servis kimlikten bulur |
| `hello`, `auth_*`, `welcome`, `ack`, `error`, `server_status` | Taşımaz (`server_status.sohbetler` öğeleri taşır) |

**Sohbet adı** (`SohbetAdi`). Kullanıcı metnidir: günlüğe ve Telegram'a girmez. Tek satır (satır sonu, sekme, görünmez ve yön karakteri, bozuk vekil yok), 1-60 UTF-16 birimi (`SOHBET_ADI`; zod `max`'ı kod noktası saydığı için `.length` ayrıca denetlenir), başında ve sonunda boşluk yok. Kablo boş ad taşımaz: telefon adı kırpar, boşsa `VARSAYILAN_SOHBET_ADI` ("Yeni sohbet") koyar. Telefon ilk mesajdan (ilk ~40 karakter, tek satıra indirilip kırpılmış) otomatik ad önerebilir ve `chat_rename` yollar, yalnız ad hâlâ "Yeni sohbet" ise.

**Yukarı mesajlar** (hepsi `client_msg_id` taşır, `ack` alır; aynı `client_msg_id` ikinci kez işlenmez):

- `chat_create{client_msg_id, sohbet_id, ad}`: outbox'ta bekleyebilir; o sohbetin ilk `user_message`'ından önce aynı kuyruğa girer. Kimlik silinmemiş bir sohbetinse (`ana` dahil) yan etkisiz `ok` (olay yok, `ack.seq` yok, ad değişmez); silinmiş bir sohbetinse `sohbet_bulunamadi`; sınır doluysa `sohbet_siniri`. Başarıda `chat_created` yazılır, `ack.seq` onun numarasıdır. ana oturum süreci ilk mesajda açılır.
- `chat_rename{client_msg_id, sohbet_id, ad}`: outbox'ta bekleyebilir. Yoksa ya da silinmişse `sohbet_bulunamadi`. Ad aynıysa yan etkisiz `ok`; değiştiyse `chat_renamed`, `ack.seq` onun.
- `chat_delete{client_msg_id, sohbet_id}`: telefon yalnız bağlıyken yollar (iki adım onaydan sonra), kopunca yeniden yollamaz. `ana` → `sohbet_silinemez`; yoksa ya da silinmişse `sohbet_bulunamadi`; o sohbette tur, devir, çalışan iş ya da bekleyen soru varsa `sohbet_mesgul`. Başarıda servis tek işlemde o sohbetin `SILINMEZ_OLAY_TURLERI` dışındaki bütün olaylarını siler, bekleyen planlarını iptal eder ve `chat_deleted` yazar (ayrıca `chat_cleared` yazılmaz); sonra o sohbetin ana oturum sürecini kapatır ve transkriptlerini siler. İş kayıtları kalır. `ack.seq` `chat_deleted`'in.
- `chat_clear{client_msg_id, sohbet_id}`: aşağıda "Geçmişi sil", artık sohbet başına.
- `user_message{client_msg_id, sohbet_id, input, text, baglam?}` (v4, Dilim 3: kısayol): `input` `yazi`, `dikte` ya da `kisayol`; `baglam{paket, ad}` yalnız `input:"kisayol"` iken izinlidir (`paket`: Android paket adı deseni, en çok 255; `ad`: 1-80 UTF-16 birimi, C0/C1 kontrol karakteri yok) ve `user_echo`'ya aynen geçer. v3 sürümlü mesaj `protokol_uyumsuz` alır. `interrupt{client_msg_id, sohbet_id, turn_id?}`: sohbet yoksa ya da silinmişse `sohbet_bulunamadi`.

**Yaşam döngüsü olayları** (`SOHBET_YASAM_OLAYLARI`): `chat_created{sohbet_id, ad}`, `chat_renamed{sohbet_id, ad}` (en yenisi geçerli), `chat_deleted{sohbet_id}`. Mezar taşıyla (`chat_cleared`) birlikte `SILINMEZ_OLAY_TURLERI`'ndedir: servis bunları hiçbir silmede silmez. Telefon sohbet listesini bu olaylardan ve `server_status.sohbetler`'den kurar; ayrı liste isteği yoktur. Telefon `chat_deleted` gelince o sohbetin yaşam döngüsü dışındaki olaylarını yerel günlüğünden siler ve sohbeti listeden kaldırır; yaşam döngüsü olaylarını tutar (`last_seq = 0` ile gelen yeni telefon da listeyi kurabilsin).

**`server_status.sohbetler`** (`SohbetDurumlari`): `[{sohbet_id, eren}]`, silinmemiş her sohbet için bir öğe, sırası anlamsız, en çok `SOHBET_ADET`, kimlikler tekil, `ana` her zaman vardır. Adlar burada yoktur. `eren` (`SohbetErenDurumu`) = `ErenDurumu` (`baslatiliyor`, `hazir`, `tur_suruyor`, `kapali`) ya da `uyuyor` (süreç yok, servis kararı: henüz açılmadı ya da boşta kapatıldı; mesaj gelince açılır) ya da `sirada` (süreç gerekiyor ama canlı ana oturum sınırı ya da RAM kapısı yüzünden bekliyor; mesajlar kuyrukta). v2'deki tek `server_status.eren` alanı kalktı.

**Boru.** MCP borusunda sohbet yönetim fiili yoktur: ana oturum sohbet açamaz, silemez, adlandıramaz; fiil girdileri `sohbet_id` taşımaz (test `sohbet|chat` geçen fiil ve alan adını reddeder). Ana oturumun sohbeti köprü jetonunun kapsamından gelir, modelin girdisinden değil.

### Geçmişi sil

`chat_clear{client_msg_id, sohbet_id}` yalnız kimliği bitmiş `/sohbet` bağlantısından işlenir ve yalnız o sohbete dokunur. Telefon onu yalnız bağlıyken yollar ve kopunca yeniden yollamaz. Sohbet yoksa ya da silinmişse `sohbet_bulunamadi`. O sohbette ana oturum turu ya da devir sürüyorsa, çalışan iş (`baslatiliyor`, `calisiyor`, `soru_bekliyor`) ya da bekleyen soru varsa `ack{ok:false, code:"sohbet_mesgul"}`. O sohbetin bekleyen planları (onay ya da izin bekleyen) kendiliğinden iptal edilir, telefon izinleri geri çekilir. Başarıda servis tek işlemde o sohbetin silinebilir olaylarını siler, sonra mezar taşını yazar: `event{chat_cleared{sohbet_id, sinir_seq}}`; `ack.seq` mezar taşının numarasıdır.

- "O sohbetin olayları" = `sohbetAnahtari(olay) === sohbet_id` olanlar: `ana` temizlenirken alansız (eski ve küresel) olaylar da silinir. Servis (`events.sohbet_id` NULL = küresel) ve telefon aynı kuralı uygular.
- Mezar taşı hiç silinmez (`SILINMEZ_OLAY_TURLERI`) ve yazıldığı an en yeni olaydır: `sinir_seq < seq`, `head_seq` hiç gerilemez. `sinir_seq`, silmeden hemen önceki küresel `head_seq`'tir. Alanı olmayan (v2) mezar taşı `ana`'nındır.
- Telefon `chat_cleared` gelince (canlıda da yüklemede de) kendi olay günlüğünden o sohbetin `seq <= sinir_seq` olan, yaşam döngüsü dışındaki olaylarını siler (o sohbetin eski mezar taşları dahil), `last_seq`'i korur, görünümü yeniden kurar ve yerine tek "Geçmiş silindi" notu koyar.
- Boruda (MCP) silme fiili yoktur: ana oturum kendi izini silemez.
- Silinmeyenler: iş, plan, soru kayıtları; iş dizinleri ve iş oturumlarının transkriptleri; ana oturumun yazdığı dosyalar; Telegram notları; Kotlin denetim günlüğü.

Sohbet anahtarı `sohbetAnahtari(kayit)` ile okunur (`sohbet_id ?? "ana"`), yukarıda "Çoklu sohbet".

### Plan onayı

Servis `plan_proposed{plan, plan_hash}` yollar. Telefon özeti yeniden hesaplar, tutmazsa planı göstermez. `plan_decision` özeti aynen geri getirir, servis yalnız o özetin metnini başlatır.

- `tur: "pc"`: `plan_decision{karar:"onay"}` yeter.
- `tur: "telefon"`: `plan_decision` yetmez, aynı `plan_hash` ile `/cihaz`'dan `grant_issued` da gerekir. Eksikse `ack.code` `izin_bekleniyor` olur, servis izin gelince başlatır. Ret için `karar:"ret"` yeter.

`kirli_kaynak` planın parçasıdır, özete girer ve servis doldurur: `plan_oner` girdisinde (`PlanTaslagi`) bu alan ve `plan_id` yoktur.

`plan_oner` girdisi `PlanOnerGirdi` = `PlanTaslagi` + isteğe bağlı `profil: "hafif" | "tam"` (varsayılan `tam`, `IS_PROFILLERI`). `profil` planın parçası **değildir**: plana, `plan_hash`'e, `plan_proposed`'a ve telefona giden plana girmez (Kotlin plan çözümü katıdır). Servis onu planla birlikte ayrı saklar, PC iş oturumunun komutunu seçer ve `job_started.profil`'e yazar. Telefon planında yok sayılır. Profil güvenlik sınırı değildir: iki profil de PC'de tam yetkilidir.

### Boru

Çerçeve `\n` ile biten tek satır JSON. İlk mesaj `kopru_hello{rol, jeton}`; cevap `kopru_welcome` ya da `kopru_ret`. Sonra `istek{istek_id, fiil, girdi}` → `yanit{istek_id, ok, sonuc | code}`. `sonuc`, `KOPRU_FIIL_SEMALARI[fiil].cikti` ile doğrulanır. Servis `fiilRoldeIzinliMi` ile rolü denetler, izinsizse `rol_fiil_izinsiz`.

| Rol | Fiiller |
|---|---|
| `eren` | `plan_oner, oturumlar, rapor_oku, projeler, uygulamalar, oturum_durdur, devir_ozeti` |
| `soru` | `kullaniciya_sor, soru_bekle` |
| `telefon` | `foreground, elements, screenshot, zoom, click, type_text, key, scroll, drag, wait, open_app, rapor_ver` |

Boruda kullanıcı mesajı gönderen fiil yoktur ve test bunu sabitler. `soru_id` köprüde üretilir: servis yeniden başlarsa köprü bağlanır ve `soru_bekle{soru_id}` ile beklemeyi sürdürür.

## `plan_hash`

`plan_hash = hex(SHA-256(UTF-8(kanonik(plan))))`, küçük harf, 64 karakter. Girdi şemadan geçmiş `Plan`dır; `plan_hash` planın alanı değildir. Saf gerçekleme `src/kanonik.ts`. Kotlin için sabit vektörler: [vektorler/plan-hash.json](vektorler/plan-hash.json).

Kanonikleştirme (RFC 8785 ile uyumlu altküme):

1. Nesne anahtarları UTF-16 kod birimine göre artan sıralanır, yerel ayar kullanılmaz. Kotlin'de `String.compareTo`.
2. Boşluk yoktur: `{"a":1,"b":[true,null]}`.
3. Değeri `undefined` olan alan yazılmaz. `null` yazılır. Dizi sırası korunur.
4. Sayılar yalnız güvenli tam sayıdır, ondalık biçimde. Ondalık, `NaN`, sonsuz reddedilir.
5. Metin çift tırnak içindedir. Yalnız şunlar kaçırılır: `"` → `\"`, `\` → `\\`, U+0008 `\b`, U+0009 `\t`, U+000A `\n`, U+000C `\f`, U+000D `\r`, kalan U+0000-U+001F `\u00xx` (küçük harf). Geri kalan her karakter olduğu gibi yazılır.
6. **Unicode normalleştirme yapılmaz.** Birleşik `ş` ile ayrışık `s` + U+0327 farklı özet verir.
7. Eşi olmayan vekil karakter reddedilir, `__proto__` anahtarı reddedilir.
