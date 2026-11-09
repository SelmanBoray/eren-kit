# eren-kit telefon uygulaması (`apps/phone`)

> ⚠️ **Experimental / Deneysel.** Bu uygulama geliştirme aşamasındadır, henüz kullanıma hazır değildir. Arayüzler, protokol ve güvenlik modeli değişebilir. Test sunucusunda kimlik doğrulama yoktur; ağa açık çalıştırma.

**English summary.** A phone app for talking to your main Claude session running on a PC. The main session does not do the work itself: for every task it opens a fresh Claude Code session, hands the task over and reports the result back to the phone. It can also drive an Android phone through an accessibility service. This directory holds the shared protocol (`protocol/`), the PC service design (`server/`), architecture/security/measurement notes (`docs/`) and a standalone phone experiment (`deneyler/telefon/`). The assistant's display name is neutral and comes from the `EREN_KIT_ASSISTANT_NAME` environment variable (default "Claude"). Documentation is in Turkish. See the [root README](../../README.md) for the monorepo.

---

## Ne yapar

Telefon uygulamasından, bilgisayardaki ana Claude oturumuyla konuşursun. Ana oturum işin kendisini yapmaz, kod yazmaz; her iş için yeni bir Claude Code oturumu açar, işi o oturuma verir ve sonucu sana raporlar. Yapılacak ve yapılmayacak işlerin listesini ana oturum yazar, telefonda gösterir, sen onaylarsın. Telefon da yönetilebilir: bir iş oturumu, kısıtlı bir araç kümesiyle (ekran okuma, dokunma, yazma) Android telefonu kontrol eder.

Asistan adı `EREN_KIT_ASSISTANT_NAME` ortam değişkeninden gelir (varsayılan "Claude"); sunucu bunu `Ayar.asistanAdi` olarak okur. Kodda geçen `eren` önekli adlar (`@eren/protocol`, `eren-servis` vb.) tanımlayıcıdır; kişilik adı değildir.

## Mimari (özet)

- **`protocol/`** (`@eren/protocol`): telefon, PC servisi ve MCP köprülerinin ortak mesaj sözleşmesi; zod şemalarından türeyen tipler ve doğrulayıcılar. Cihaz kanalı: `protocol/CIHAZ.md`.
- **`server/`** (`@eren/server`): tek Node 24 + TypeScript süreci. Modüller: `gateway` (WebSocket), `konusma` (ana oturum süreci), `isler` (iş oturumları), `planlar`, `cihaz` (telefon komutları), `bildirim`, `kilit` (limit düzeneği), `depo` (SQLite). Modül sözleşmeleri: `server/MODULLER.md`.
- **MCP köprüleri:** ince stdio köprüleri; adlandırılmış boruyla servise bağlanır, mantık serviste kalır.
- **`deneyler/telefon/`:** ürün olmayan ölçüm denemesi: yalın Kotlin APK + Node test sunucusu.

Karar gerekçeleri `docs/MIMARI.md` içindedir. Not: kök `package.json` çalışma alanları arasında `app` (Expo/React Native istemci) listelenir, ancak bu dizinde şu an yoktur.

## Nasıl çalıştırılır

Gereksinim: Node 24 ve üzeri.

```bash
cd apps/phone
npm ci                       # bağımlılıkları kur
npm run test:protocol        # protokol testleri
npm run typecheck:protocol   # protokol tip denetimi
npm test -w server           # sunucu testleri
npm run typecheck -w server  # sunucu tip denetimi
```

Kök `package.json` çalışma alanlarında bulunmayan `app` dizini yüzünden `npm ci` sorun çıkarırsa, bunu bir hata olarak raporla; henüz doğrulanmadı.

### Telefon denemesi

`deneyler/telefon/` altındaki deneme, telefonu PC'den uzaktan okuyup yönlendirmenin mümkün olup olmadığını ölçer.

1. Adresleri ortam değişkenleriyle ver: `EREN_PC_IP` (PC adresi), `EREN_TELEFON_IP` (izinli telefon adresi), isteğe bağlı `EREN_PORT` (varsayılan 47800).
2. `deneyler/telefon/sunucu` içinde bağımlılıkları kur (`npm ci`) ve test sunucusunu başlat: `node sunucu.js` (ya da penceresiz: `baslat.vbs`; node `PATH`'ten bulunur, farklı kurulumda tam yol `EREN_KIT_NODE` ile verilir). Komut satırı istemcisi: `node cli.js durum`.
3. Telefonsuz öz sınama: `node oztest.js`.
4. APK'yı `deneyler/telefon/android/` altından derle; PC adresi derleme sırasında `EREN_KIT_PC_URL` ortam değişkeninden okunur (örn. `ws://<pc-adresi>:47800/`), verilmezse `PC_ADRESI_BURAYA` yer tutucusu kalır.
5. Telefon kurulumu: `deneyler/telefon/TELEFON_TALIMATI.md`. Sonuçlar: `docs/OLCUMLER.md`.

## Ortam değişkenleri

- `EREN_KIT_ASSISTANT_NAME`: asistan adı (varsayılan "Claude").
- `EREN_KIT_DATA_DIR`: sunucu veri kökü; mutlak yol olmalı. Verilmezse varsayılan `%LOCALAPPDATA%\eren-kit`. Eski bir kurulumun verisi başka klasördeyse bu değişkenle oraya yönlendirilir.
- `EREN_KIT_PC_URL` (APK derlemesi), `EREN_KIT_NODE` (`baslat.vbs`), `EREN_PC_IP`, `EREN_TELEFON_IP`, `EREN_PORT` (telefon denemesi): yukarıda açıklandı.

## Güvenlik notu

- Deneme sunucusunda kimlik doğrulama yoktur; yalnızca özel, güvenilir bir ağda ve izinli IP ile çalıştır.
- Tasarlanan servis modeli: eşleştirme normalde kapalıdır, telefon Keystore'da anahtar üretir, PC yalnızca açık anahtarı saklar, her bağlantıda karşılıklı imza sınaması yapılır; paylaşılan sır yoktur.
- Telefon iş oturumları Bash, dosya ve web aracı almaz; yalnızca telefon ve soru araçlarını kullanır. Hassas uygulamalar paket listesiyle (değişmez ret listesi) korunur; `FLAG_SECURE`'a güvenilmez.
- Model davranışı güvenlik kanıtı sayılmaz: güvence Kotlin kapısından ve izin modelinden gelir. Ayrıntı, kalan açıklar ve ölçüm sınırları: `docs/GUVENLIK.md`, `docs/OLCUMLER.md`.
- Deneme sırasında hassas uygulama açma, gerçek parola girme.

## Belgeler

- [docs/MIMARI.md](docs/MIMARI.md): mimari kararlar
- [docs/GUVENLIK.md](docs/GUVENLIK.md): güvenlik modeli
- [docs/OLCUMLER.md](docs/OLCUMLER.md): ölçümler
- [protocol/README.md](protocol/README.md), [protocol/CIHAZ.md](protocol/CIHAZ.md): protokol
- [server/MODULLER.md](server/MODULLER.md): servis modülleri
- [deneyler/telefon/README.md](deneyler/telefon/README.md): telefon denemesi

Monorepo ana sayfası: [../../README.md](../../README.md)
