# `/cihaz` sözleşmesi

Telefondaki Kotlin ön plan servisi ile bilgisayar servisi arasındaki kanal. Dilim 3'te (tam yetki, kısayol) bu kablo ve `vektorler/` değişmedi; değişiklikler `/sohbet` v4'te ve telefonun içindedir. `/sohbet` v5'te (plandan `kesin_yapilacaklar` ve `kesin_yapilmayacaklar` kalktı) bu kablo yine değişmedi, ama `vektorler/plan-hash.json` yeniden üretildi: Kotlin onay ekranının plan çözümü ve özeti bu alanlar olmadan kurulur. JavaScript bu kanalı görmez. Kotlin bu paketi kullanmaz, JSON'u kendi işler; kaynak gerçek `src/cihaz.ts` şemalarıdır ve bu belgenin bütün JSON örnekleri test sırasında o şemalardan geçirilir.

## Bağlantı

- Adres: `ws://<tailscale-ip>:<port>/cihaz`. Telefon hep arayan taraftır, telefonda dinleyen port yoktur.
- Çerçeve: bir WebSocket metin mesajı, bir UTF-8 JSON nesnesi. Üst sınır 10 MiB.
- Her mesajda `"v": 1` ve `"type"` zorunludur. `v` farklıysa karşı taraf `error{code:"protokol_uyumsuz"}` yollar ve kapatır.
- **Bilinmeyen alan hatadır.** Fazla alanı olan mesaj reddedilir, yok sayılmaz. Şemaya alan eklemek sürüm artışıdır.
- Tam sayılar güvenli tam sayıdır (en çok 2^53-1). Yorum ya da sondaki virgül yoktur.
- Kimlikler (`*_id`): 1-64 karakter, `[A-Za-z0-9_-]`. `token`: 32-128 karakter, aynı alfabe. Telefon jetonu en az 32 rastgele bayttan üretir.
- Paket adı: `^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$`, en çok 255 karakter.

## El sıkışma

Sıra sabittir. Bitmeden başka mesaj yollanırsa bağlantı `error{code:"yetkisiz"}` ile kapanır.

1. Telefon: `hello`. `client_nonce` 32 rastgele bayt, standart base64.

```json
{"v":1,"type":"hello","device_id":"tel-1","client_nonce":"QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNA=="}
```

2. Bilgisayar: `auth_challenge`. Telefon `server_signature` imzasını eşleştirmede aldığı bilgisayar açık anahtarıyla doğrular. Tutmazsa bağlantıyı keser ve hiçbir şey yollamaz.

```json
{"v":1,"type":"auth_challenge","server_nonce":"WllYV1ZVVFNSUVBPTk1MS0pJSEdGRURDQkEwMTIzNA==","server_signature":"MEUCIQDabc123+/defGHIjklMNOpqrSTUvwxYZ0123=="}
```

3. Telefon: `auth_response`. Bilgisayar eşleşmiş açık anahtar ve eşleşmiş Tailscale IP ile doğrular.

```json
{"v":1,"type":"auth_response","signature":"MEUCIQDabc123+/defGHIjklMNOpqrSTUvwxYZ0123=="}
```

4. Bilgisayar: `welcome`. Telefon saat farkını burada hesaplar.

```json
{"v":1,"type":"welcome","server_time_ms":1790000000000}
```

5. Telefon sırasıyla yollar: `device_state`, `app_list`, aktif her izin için `grant_issued`. Son adım sayesinde yeniden başlayan servis belleğindeki jetonları geri alır.

İmza: ECDSA P-256 + SHA-256 (`SHA256withECDSA`), DER, standart base64. Açık anahtar: SPKI DER (`key.public.encoded`), standart base64. İmzalanan baytlar şu metnin UTF-8 halidir, satırlar `\n` ile ayrılır, sonda satır sonu yoktur:

```
eren-auth-v1
<rol>
cihaz
<device_id>
<client_nonce>
<server_nonce>
```

`<rol>` telefonun imzasında `telefon`, bilgisayarın imzasında `pc` değeridir. `/sohbet` için üçüncü satır `sohbet` olur, bu yüzden imza kanallar arasında taşınamaz. Eşleştirme `/cihaz`'dan yapılmaz; `device_id` ve anahtarlar eşleştirmeden gelir.

Hata mesajı, örneğin:

```json
{"v":1,"type":"error","code":"imza_gecersiz"}
```

`error.code` listesi `src/hatalar.ts`. Bu kanalda beklenenler: `protokol_uyumsuz`, `gecersiz_mesaj`, `mesaj_cok_buyuk`, `yetkisiz`, `imza_gecersiz`, `ip_uyusmuyor`, `cihaz_bilinmiyor`, `zaman_asimi` (süre dolunca gateway yollar), `kanal_desteklenmiyor` (iPad `/cihaz`'a bağlanamaz).

## Saat

`cmd.deadline_ms` bilgisayar saatinde mutlak andır (epoch ms). Telefon saatine güvenilmez:

- `welcome` alınınca `fark = server_time_ms - System.currentTimeMillis()` saklanır.
- `cmd` alınınca `System.currentTimeMillis() + fark > deadline_ms` ise komut çalıştırılmaz, `denied: "deadline_gecti"` döner.

## Komut: `cmd`

| Alan | Tür | Anlam |
|---|---|---|
| `cmd_id` | kimlik | Sonuçta aynen döner |
| `grant_id` | kimlik | Telefonun verdiği izin |
| `token` | jeton | İznin jetonu, sabit zamanlı karşılaştırılır |
| `deadline_ms` | tam sayı | Bkz. Saat |
| `name` | metin | Aşağıdaki kapalı liste |
| `args` | nesne | Komuta özel, bilinmeyen alan `gecersiz_arg` |

Komutlar kuyruklanmaz. Komut çalışırken gelen ikinci komut `denied: "mesgul"` alır. Bağlantı koparsa çalışan komut iptal edilir, sonucu saklanmaz ve yeniden yollanmaz; bilgisayar bunu `belirsiz` sayar.

Denetim sırası: `deadline_gecti`, `izin_yok` / `izin_geri_cekildi`, `jeton_yanlis`, `izin_suresi_bitti`, `erisilebilirlik_kapali`, `kilit_ekrani`, ön plan denetimleri, mod ve metin denetimleri, `butce_doldu`. İlk takılan neden döner. Ön plan her eylemden hemen önce yeniden okunur. Ekran görüntüsünden sonra da okunur: değiştiyse resim atılır, `on_plan_izin_disi` döner. Bütçeden yalnız `click`, `type_text`, `key`, `scroll`, `drag`, `open_app` düşer, bütün denetimleri geçtikten sonra 1 azalır.

### Komut adları

Koordinatlar son ekran görüntüsünün pikselidir, tam sayı, 0-20000.

| Ad | `args` | Dönüş |
|---|---|---|
| `foreground` | `{}` | yalnız `foreground` |
| `elements` | `query?` (en çok 200) | `payload.kind = "elements"` |
| `screenshot` | `{}` | `payload.kind = "image"` |
| `zoom` | `x0, y0, x1, y1`; `x1 > x0`, `y1 > y0` | `payload.kind = "image"` |
| `click` | ya `element` ya `x` ile `y`; `clicks?` (1-2), `long_press?` | yalnız `foreground` |
| `type_text` | `text` (1-4000) | yalnız `foreground` |
| `key` | `keys`, `repeat?` (1-10) | yalnız `foreground` |
| `scroll` | `direction`, `amount?` (1-20), `x?` ile `y?` birlikte | yalnız `foreground` |
| `drag` | `x0, y0, x1, y1` | yalnız `foreground` |
| `wait` | `seconds`, 0'dan büyük, en çok 30, ondalık olabilir | yalnız `foreground` |
| `open_app` | `package` | yalnız `foreground` |

`keys` kapalı listesi: `back`, `home`, `enter`, `dpad_up`, `dpad_down`, `dpad_left`, `dpad_right`, `dpad_center`. `direction`: `up`, `down`, `left`, `right`.

`open_app` yalnız `PackageManager.getLaunchIntentForPackage` ile açar. Paket izin listesinde değilse `on_plan_izin_disi`. Değer paket adı biçiminde değilse (URL, intent metni) `url_intent_yasak`. Telefonun URL ya da intent açan hiçbir komutu yoktur.

Örnekler:

```json
{"v":1,"type":"cmd","cmd_id":"c1","grant_id":"g1","token":"abcdefghijklmnopqrstuvwxyz012345_-ABCDEFG","deadline_ms":1790000030000,"name":"foreground","args":{}}
```

```json
{"v":1,"type":"cmd","cmd_id":"c2","grant_id":"g1","token":"abcdefghijklmnopqrstuvwxyz012345_-ABCDEFG","deadline_ms":1790000030000,"name":"elements","args":{"query":"gönder"}}
```

```json
{"v":1,"type":"cmd","cmd_id":"c3","grant_id":"g1","token":"abcdefghijklmnopqrstuvwxyz012345_-ABCDEFG","deadline_ms":1790000030000,"name":"screenshot","args":{}}
```

```json
{"v":1,"type":"cmd","cmd_id":"c4","grant_id":"g1","token":"abcdefghijklmnopqrstuvwxyz012345_-ABCDEFG","deadline_ms":1790000030000,"name":"zoom","args":{"x0":0,"y0":100,"x1":360,"y1":400}}
```

```json
{"v":1,"type":"cmd","cmd_id":"c5","grant_id":"g1","token":"abcdefghijklmnopqrstuvwxyz012345_-ABCDEFG","deadline_ms":1790000030000,"name":"click","args":{"element":12}}
```

```json
{"v":1,"type":"cmd","cmd_id":"c6","grant_id":"g1","token":"abcdefghijklmnopqrstuvwxyz012345_-ABCDEFG","deadline_ms":1790000030000,"name":"type_text","args":{"text":"Geliyorum"}}
```

```json
{"v":1,"type":"cmd","cmd_id":"c7","grant_id":"g1","token":"abcdefghijklmnopqrstuvwxyz012345_-ABCDEFG","deadline_ms":1790000030000,"name":"key","args":{"keys":"back"}}
```

```json
{"v":1,"type":"cmd","cmd_id":"c8","grant_id":"g1","token":"abcdefghijklmnopqrstuvwxyz012345_-ABCDEFG","deadline_ms":1790000030000,"name":"scroll","args":{"direction":"down","amount":3}}
```

```json
{"v":1,"type":"cmd","cmd_id":"c9","grant_id":"g1","token":"abcdefghijklmnopqrstuvwxyz012345_-ABCDEFG","deadline_ms":1790000030000,"name":"drag","args":{"x0":10,"y0":900,"x1":10,"y1":200}}
```

```json
{"v":1,"type":"cmd","cmd_id":"c10","grant_id":"g1","token":"abcdefghijklmnopqrstuvwxyz012345_-ABCDEFG","deadline_ms":1790000030000,"name":"wait","args":{"seconds":1.5}}
```

```json
{"v":1,"type":"cmd","cmd_id":"c11","grant_id":"g1","token":"abcdefghijklmnopqrstuvwxyz012345_-ABCDEFG","deadline_ms":1790000030000,"name":"open_app","args":{"package":"com.example.mesaj"}}
```

## Sonuç: `cmd_result`

| Alan | Tür | Anlam |
|---|---|---|
| `cmd_id` | kimlik | Komutunki |
| `ok` | mantıksal | Komut çalıştı mı |
| `foreground` | nesne ya da `null` | `{baslik, paket}`; her zaman yollanır, bilinmiyorsa `null` |
| `payload` | nesne | Yalnız `ok: true` ile, yalnız `elements`, `screenshot`, `zoom` için |
| `denied` | metin | Kapı reddetti. Yalnız `ok: false` ile |
| `hata` | metin | Kapı izin verdi, eylem olmadı. Yalnız `ok: false` ile |

`ok: false` ise `denied` ile `hata`'dan tam olarak biri bulunur, `payload` bulunmaz.

İzin dışındaki pakette `foreground.baslik` boş metin yollanır, çünkü pencere başlığı okunmamış içerik taşıyabilir. Başlık en çok 256 karakter; uzunsa Kotlin kırpar.

```json
{"v":1,"type":"cmd_result","cmd_id":"c5","ok":true,"foreground":{"baslik":"Mesajlar","paket":"com.example.mesaj"}}
```

```json
{"v":1,"type":"cmd_result","cmd_id":"c6","ok":false,"foreground":{"baslik":"","paket":"com.example.banka"},"denied":"hassas_uygulama"}
```

```json
{"v":1,"type":"cmd_result","cmd_id":"c5","ok":false,"foreground":{"baslik":"Mesajlar","paket":"com.example.mesaj"},"hata":"element_bulunamadi"}
```

`elements` sonucu. Alanlar: `id` (0 ve üzeri, son `elements` çağrısına özel), `rol` (`[A-Za-z0-9_.-]`, en çok 64), `ad` ve `deger` (en çok 2000; uzunsa Kotlin kırpar), `x, y` (merkez), `disabled?`, `password?`. Parola alanında `password: true` yollanır, `deger` asla yollanmaz. En çok 500 eleman; sınıra takılırsa `truncated: true`.

```json
{"v":1,"type":"cmd_result","cmd_id":"c2","ok":true,"foreground":{"baslik":"Mesajlar","paket":"com.example.mesaj"},"payload":{"kind":"elements","truncated":false,"elements":[{"id":1,"rol":"button","ad":"Gönder","x":980,"y":2210},{"id":2,"rol":"edit","ad":"Mesaj","deger":"Merhaba","x":500,"y":2210}]}}
```

Resim sonucu. `mime`: `image/jpeg` ya da `image/png`. `image_base64`: standart base64, en çok 8 MiB. `scale`: gerçek piksel = resim pikseli × `scale`. `width`, `height`: resmin kendi boyutu.

```json
{"v":1,"type":"cmd_result","cmd_id":"c3","ok":true,"foreground":{"baslik":"Mesajlar","paket":"com.example.mesaj"},"payload":{"kind":"image","mime":"image/jpeg","image_base64":"QUJD","width":720,"height":1600,"scale":1.5}}
```

## Dönüş dili

Kotlin yapısal alan yollar, satır üretmez. Modele giden metni bilgisayardaki köprü, `computer-use-windows` dilinde kurar (`src/cihaz-metin.ts`). Okunan metindeki satır sonu, kontrol ve yön karakterlerini ancak alanlar ayrıyken kaçırmak mümkündür; hazır satır gelseydi sahte `[12] button` satırı ayırt edilemezdi.

Eylemler tek satırdır:

```
ok | foreground: "Mesajlar" (com.example.mesaj)
denied: hassas_uygulama | foreground: "" (com.example.banka)
error: element_bulunamadi | foreground: "Mesajlar" (com.example.mesaj)
ok | foreground: none
```

`elements`:

```
window: "Mesajlar" (com.example.mesaj) — 2 elements
[1] button "Gönder" @980,2210
[2] edit "Mesaj" = "Merhaba" @500,2210
```

Satır biçimi `[id] rol "ad" = "değer" @x,y`; değer yoksa ` = "..."` kısmı yoktur, varsa `@` öncesine ` (disabled)` ve ` (password)` eklenir. Tırnak içinde `\`, `"`, satır sonu, kontrol ve yön karakterleri (U+061C dahil) kaçırılır. `ad` ve `deger` önce 500 birime kırpılır, sonra kaçırılır; kırpılmışsa değerin sonuna `...[kirpildi N]` gelir (N kırpılan birim sayısı), örn. `[1] edit "xxx...[kirpildi 1]" @1,2`. Boş listede `no accessible elements; use screenshot`, kırpılmışsa `… truncated at N; use query to narrow` satırı gelir.

Resim: `screen 720x1600 (scale 1.50) | foreground: "Mesajlar" (com.example.mesaj)`, resim ayrı içerik olarak eklenir.

## `denied` nedenleri

Kapalı listedir. Listede olmayan değer şemadan geçmez.

| Neden | Ne zaman |
|---|---|
| `izin_yok` | `grant_id` telefonda bilinmiyor |
| `izin_geri_cekildi` | İzin vardı, kullanıcı ya da bilgisayar geri çekti |
| `izin_suresi_bitti` | Süresi doldu |
| `jeton_yanlis` | `token` tutmuyor |
| `butce_doldu` | Eylem bütçesi bitti |
| `deadline_gecti` | Bkz. Saat |
| `on_plan_izin_disi` | Ön plan paketi izin listesinde değil |
| `hassas_uygulama` | Paket hassas listede |
| `yeni_uygulama` | Paket telefonda kurulu değil ya da imzası okunamıyor (0.4.3'ten beri yalnız bu anlamda; kurulu sıradan uygulama varsayılan açıktır, banka/para/kimlik uygulamaları ve sistem bileşenleri otomatik hassastır) |
| `degismez_ret` | eren-kit telefon uygulaması, Ayarlar, kurucu, Play, izin diyalogları, üretici güvenlik uygulaması, Tailscale |
| `izin_disi_pencere` | Ekran görüntüsü sırasında izin dışı pencere görünüyor |
| `kilit_ekrani` | Telefon kilitli |
| `parola_alani` | Parola alanına yazma ya da değerini okuma |
| `yalniz_oku_yazma` | `oku` modunda `type_text` ya da `key` |
| `yalniz_oku_ham_dokunma` | `oku` modunda `click` için `x, y` ya da `drag` |
| `yalniz_oku_etiket` | `oku` modunda gönder, sil, öde etiketli düğüme dokunma |
| `metin_kilidi` | Yazılacak metin `izinli_metin` içinde birebir yok ya da yazma izni metin taşımıyor |
| `url_intent_yasak` | URL ya da intent açma denemesi |
| `erisilebilirlik_kapali` | Erişilebilirlik servisi kapalı |
| `ekran_korumali` | Pencere `FLAG_SECURE`, ekran alınamaz |
| `mesgul` | Başka komut çalışıyor |
| `desteklenmeyen_komut` | `name` listede yok ya da bu cihazda yapılamıyor |
| `gecersiz_arg` | `args` tabloya uymuyor |

`hata` nedenleri: `element_bulunamadi`, `uygulama_bulunamadi`, `ekran_alinamadi`, `eylem_basarisiz`, `zaman_asimi`.

## İzinler

İzin telefonda, Kotlin'in `FLAG_SECURE` onay ekranında üretilir ve orada saklanır. Onay ekranı planı JavaScript'ten alır, `plan_hash` değerini kendisi yeniden hesaplar (README, "plan_hash"), uygulama adlarını PackageManager'dan gösterir. Yazma izni biyometri ister. Tam yetki açıksa (telefondaki ayrı bir bayrak) izin onay ekranı olmadan, aynı doğrulamalarla otomatik de üretilebilir. İznin kaynağı (`ONAY` ya da `OTO`) yalnız telefondaki denetim günlüğünde yazılıdır; `grant_issued` ve başka hiçbir çerçeve onu taşımaz.

`grant_issued`, telefondan: yeni izin ve her `welcome` sonrası aktif izinlerin tekrarı. `kalan_ms` kalan süre, `butce` kalan eylem hakkı.

```json
{"v":1,"type":"grant_issued","grant_id":"g1","token":"abcdefghijklmnopqrstuvwxyz012345_-ABCDEFG","plan_id":"plan-2","plan_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","mod":"oku","uygulamalar":["com.example.mesaj"],"kalan_ms":3600000,"butce":200}
```

`grant_revoked`, telefondan: izin bitti. `neden`: `kullanici_durdurdu`, `suresi_bitti`, `butce_bitti`, `is_bitti`, `is_iptal`, `limit_kilit`, `erisilebilirlik_kapandi`.

```json
{"v":1,"type":"grant_revoked","grant_id":"g1","neden":"kullanici_durdurdu"}
```

`grant_revoke`, bilgisayardan: izni geri çek. Telefon uygular, `grant_revoked` ile doğrular. `grant_id: null` bütün izinler demektir. Yeni izin isteyemez, yalnız kapatır.

```json
{"v":1,"type":"grant_revoke","grant_id":null,"neden":"limit_kilit"}
```

## Durum, uygulama listesi, bildirim

`device_state`, telefondan: bağlanınca ve her değişimde. `a11y` erişilebilirlik servisi şu an bağlı mı (servis yalnız izin varken açıldığından izin yokken normalde false; bu kapalı bir arıza değil), `adb_enabled` USB hata ayıklama açık mı, `kilitli` telefon kilitli mi.

```json
{"v":1,"type":"device_state","a11y":true,"adb_enabled":false,"kilitli":false}
```

`app_list`, telefondan: bağlanınca ve kurulum değişince, tam liste. En çok 2000 uygulama. `ad` PackageManager'dan gelir, en çok 120 karakter, güvenilmez metindir. `durum`: `acik`, `hassas`, `yeni` (0.4.3'ten beri kurulu olmayan ya da imzası okunamayan paket; tam listede kurulu uygulama için normalde görülmez), `degismez`.

```json
{"v":1,"type":"app_list","uygulamalar":[{"paket":"com.example.mesaj","ad":"Mesajlar","durum":"acik"}]}
```

`notify`, bilgisayardan: kısa bildirim. `tur`: `plan`, `soru`, `is_bitti`, `sistem`. `baslik` en çok 120, `metin` en çok 500.

```json
{"v":1,"type":"notify","notify_id":"n1","tur":"soru","baslik":"Soru var","metin":"İş 7 cevap bekliyor."}
```

`notify_ack`, telefondan: bildirim gösterildi. Gelmezse bilgisayar yedek kanala düşer.

```json
{"v":1,"type":"notify_ack","notify_id":"n1"}
```
