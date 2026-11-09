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

- **Her mesajda sürüm:** `v` tam olarak `PROTOKOL_SURUMU`.
- **Bilinmeyen alan hatadır.** Her nesne `strictObject`. Yok sayılmaz, çünkü yok sayılan alan onaylanmış özetin dışında kalırdı.
- **Tüm girdiler güvenilmez.** Her metin ve dizi alanının sınırı `SINIRLAR`, çerçevelerinki `AZAMI_CERCEVE` içindedir. Çözücüler (`sohbetYukariCoz` ve benzerleri) boyutu ayrıştırmadan önce denetler, hiç atmaz, gelen değeri hata çıktısına koymaz. Taşıma katmanı aynı sınırı baytta da uygular.
- **Plan metinlerinde** kontrol, sıfır genişlik ve yön karakterleri reddedilir; tek satırlık alanlarda satır sonu da. Onay ekranında görünen, özeti alınan metindir.

## Sürümleme

Tek tam sayı, `src/sinirlar.ts` içinde `PROTOKOL_SURUMU`. Mesaj, alan, kapalı liste öğesi eklemek ya da sınırı düşürmek sürüm artışıdır, çünkü karşı taraf bilinmeyeni reddeder. Sınırı yükseltmek de eski alıcıyı kırdığı için artıştır. Sürümler arası uyumluluk yoktur: iki taraf aynı sürümde olmalıdır, değilse `protokol_uyumsuz` döner. `plan_hash` kuralı değişirse aynı şekilde.

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
3. `event.event` kalıcı olaydır, tek artan `seq` taşır. `assistant_delta` ve `server_status` kalıcı değildir. `server_status.limit?` isteğe bağlıdır: `bes_saat?`, `haftalik?` (doluluk, 0-1) ve `bes_saat_sifirlanma_ms?`, `haftalik_sifirlanma_ms?` (sıfırlanma, epoch ms); alan yoksa istemci bilinmiyor sayar.
4. Kimlik sonrası her yukarı mesaj `client_msg_id` taşır ve `ack` alır. `ack.ok: false` ise `code` vardır, yeniden yollanmaz. Aynı kimlik yeniden gelirse servis aynı `ack`'i döner, ikinci kez işlemez.

`interrupt.turn_id` verilirse yalnız o tur kesilir, tur bittiyse `tur_gecersiz` döner.

### Plan onayı

Servis `plan_proposed{plan, plan_hash}` yollar. Telefon özeti yeniden hesaplar, tutmazsa planı göstermez. `plan_decision` özeti aynen geri getirir, servis yalnız o özetin metnini başlatır.

- `tur: "pc"`: `plan_decision{karar:"onay"}` yeter.
- `tur: "telefon"`: `plan_decision` yetmez, aynı `plan_hash` ile `/cihaz`'dan `grant_issued` da gerekir. Eksikse `ack.code` `izin_bekleniyor` olur, servis izin gelince başlatır. Ret için `karar:"ret"` yeter.

`kirli_kaynak` planın parçasıdır, özete girer ve servis doldurur: `plan_oner` girdisinde (`PlanTaslagi`) bu alan ve `plan_id` yoktur.

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
