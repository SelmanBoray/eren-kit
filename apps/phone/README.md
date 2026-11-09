# eren-kit telefon uygulaması (`apps/phone`)

> ⚠️ **Experimental / Deneysel.** Bu uygulama geliştirme aşamasındadır, henüz kullanıma hazır değildir. Arayüzler, protokol ve güvenlik modeli değişebilir. Test sunucusunda kimlik doğrulama yoktur; ağa açık çalıştırma.

**English summary.** A phone app for talking to your main Claude session running on a PC. The main session does not do the work itself: for every task it opens a fresh Claude Code session, hands the task over and reports the result back to the phone. It can also drive an Android phone through an accessibility service. This directory holds the shared protocol (`protocol/`), the PC service (`server/`), the Expo / React Native client with its Kotlin `eren-device` module (`app/`), the install tooling (`kurulum/`), architecture/security/measurement notes (`docs/`) and a standalone phone experiment (`deneyler/telefon/`). The assistant's display name is neutral and comes from the `EREN_KIT_ASSISTANT_NAME` environment variable (default "Claude"); the data root and the scheduled task name are configurable too (see "Ortam değişkenleri"). Documentation is in Turkish. See the [root README](../../README.md) for the monorepo.

---

## Ne yapar

Telefon uygulamasından, bilgisayardaki ana Claude oturumuyla konuşursun. Ana oturum işin kendisini yapmaz, kod yazmaz; her iş için yeni bir Claude Code oturumu açar, işi o oturuma verir ve sonucu sana raporlar. Yapılacak ve yapılmayacak işlerin listesini ana oturum yazar, telefonda gösterir, sen onaylarsın. Birden fazla sohbet açılabilir; her sohbetin kendi ana oturumu vardır. Telefon da yönetilebilir: bir iş oturumu, kısıtlı bir araç kümesiyle (ekran okuma, dokunma, yazma) Android telefonu kontrol eder.

Asistan adı `EREN_KIT_ASSISTANT_NAME` ortam değişkeninden gelir (varsayılan "Claude"); sunucu bunu `Ayar.asistanAdi` olarak okur, uygulama derleme anında alır. Kodda geçen `eren` önekli adlar (`@eren/protocol`, `dev.eren.*`, `eren-device`, `eren-servis` vb.) tanımlayıcıdır; kişilik adı değildir ve kurulu uygulamanın güncellenebilmesi için değişmez.

## Mimari (özet)

- **`protocol/`** (`@eren/protocol`): telefon, PC servisi ve MCP köprülerinin ortak mesaj sözleşmesi; zod şemalarından türeyen tipler ve doğrulayıcılar. Cihaz kanalı: [protocol/CIHAZ.md](protocol/CIHAZ.md).
- **`server/`** (`@eren/server`): tek Node 24 + TypeScript süreci. Modüller: `gateway` (WebSocket), `konusma` (ana oturum süreci), `isler` (iş oturumları), `planlar`, `cihaz` (telefon komutları), `bildirim`, `kilit` (limit düzeneği), `depo` (SQLite). Modül sözleşmeleri: [server/MODULLER.md](server/MODULLER.md).
- **`app/`** (`eren-app`): Expo / React Native istemci (TypeScript) ve Android tarafı için `app/modules/eren-device` Kotlin modülü. Saf Kotlin çekirdek (izin, denetim, komut işleyici) ayrı bir JVM Gradle projesidir; Android adaptörü ve Expo köprüsü onun üstünde durur. Modül dökümü: [app/TASARIM.md](app/TASARIM.md). Çalışma alanı dışındadır: kendi `package.json` ve `package-lock.json` dosyasıyla ayrı kurulur.
- **`kurulum/`**: servisin sürümlü dağıtımı (`kur.ts`), zamanlanmış görev kaydı ve yardımcı komutlar. Servis işletimi: [docs/SERVIS.md](docs/SERVIS.md).
- **MCP köprüleri:** ince stdio köprüleri; adlandırılmış boruyla servise bağlanır, mantık serviste kalır.
- **`deneyler/telefon/`:** ürün olmayan ölçüm denemesi: yalın Kotlin APK + Node test sunucusu.
- **`docs/`:** mimari kararlar, güvenlik modeli, servis işletimi, tasarım dili ve ölçümler (aşağıda "Belgeler").

Karar gerekçeleri [docs/MIMARI.md](docs/MIMARI.md) içindedir.

## Nasıl çalıştırılır

Gereksinim: Node 24 ve üzeri (Windows). `apps/phone` kökü yalnız `protocol` ve `server` çalışma alanlarını içerir; `app` kendi kilit dosyasıyla ayrı kurulur.

```bash
cd apps/phone
npm ci                           # protocol + server bağımlılıkları
npm run test:protocol            # protokol testleri
npm run typecheck:protocol       # protokol tip denetimi
npm test -w server               # sunucu testleri
npm run typecheck -w server      # sunucu tip denetimi
```

`server/test/dis-dunya.test.ts` canlı servisle aynı tekil boruyu kullanır; servis açıkken çakışır, servisi kapatmadan çalıştırma.

Kurulum betiklerinin testi ve tip denetimi (yine `apps/phone` içinden):

```bash
node --disable-warning=ExperimentalWarning --test "kurulum/test/**/*.test.ts"   # kurulum testleri
npx tsc --noEmit -p kurulum/tsconfig.json                                       # kurulum tip denetimi
```

### Telefon uygulaması (`app/`)

```bash
cd apps/phone/app
npm ci                           # app kendi package-lock.json'ıyla kurulur
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p tsconfig.test.json
node --test "test/**/*.test.ts"  # JS çekirdeği ve ekran mantığı testleri
npm start                        # expo start
npm run android                  # expo run:android (APK derlemesi, Android SDK gerekir)
```

Saf Kotlin çekirdeğin birim testleri: `cd app/modules/eren-device/cekirdek` içinde `.\gradlew.bat test`. APK derlemesinde görünen asistan adı `EREN_KIT_ASSISTANT_NAME`'den gelir; verilmezse uygulama adı (launcher) `eren-kit` olur. Telefon kurulumu ve cihaz tarafı ayrıntısı [app/TASARIM.md](app/TASARIM.md) ve [docs/GUVENLIK.md](docs/GUVENLIK.md) içindedir.

### Servis kurulumu

Servisin sürümlü dağıtımı `kurulum/kur.ts` ile yapılır: temiz bir kopyayı test eder, veri kökünün altındaki `uygulama\` klasörüne kopyalar ve zamanlanmış görevle çalışan bekçiye bildirir. Komutlar `apps/phone` içinden çalıştırılır:

```powershell
node --disable-warning=ExperimentalWarning kurulum/kur.ts               # test kapısı + kurulum
node --disable-warning=ExperimentalWarning kurulum/kur.ts --yalniz-test # yalnız test kapısı, kurmaz
node --disable-warning=ExperimentalWarning kurulum/kur.ts --durum       # salt okunur: veri kökü, olası çakışmalar
```

`--durum` (ve `eren durum`) veri kökünü ve eski kurulumla olası çakışmaları gösterir. Zamanlanmış görevin kaydı (`kurulum/gorev-kaydet.ts`), geri alma (`--geri-al`), `eren` komutu ve diğer bayraklar [docs/SERVIS.md](docs/SERVIS.md) içindedir.

**Ortam değişkenlerini kalıcı kullanıcı ortamına yaz.** Görev Zamanlayıcı'nın başlattığı servis yalnız kalıcı ortamı görür; bir kabukta geçici verilen değişken servise ulaşmaz. Önce değişkenleri kalıcı kullanıcı ortamına yaz, sonra yeni bir kabuk aç (açık kabuk sonradan yazılan değeri görmez), sonra `kur.ts`'i çalıştır:

```powershell
[Environment]::SetEnvironmentVariable("EREN_KIT_DATA_DIR", "<mutlak-yol>", "User")
[Environment]::SetEnvironmentVariable("EREN_KIT_PHONE_TASK_NAME", "<görev-adı>", "User")
[Environment]::SetEnvironmentVariable("EREN_KIT_ASSISTANT_NAME", "<asistan-adı>", "User")
```

Değişken vermezsen varsayılanlar geçerlidir (aşağıda "Ortam değişkenleri"); yalnız varsayılanlarla kuruyorsan bu adım gerekmez.

**Kabuk ile kalıcı ortam uyuşmazsa kurulum durur.** `kur.ts` (`--geri-al` dahil) ve `gorev-kaydet.ts`, hiçbir şeye dokunmadan önce kabuktaki değerleri kalıcı ortamla karşılaştırır. `EREN_KIT_DATA_DIR` kabukta ve kalıcı ortamda farklıysa kurulum "hiçbir şey değişmedi" diyerek durur: aksi halde servis başka köke yazar ve veri bölünür. Çözüm: değeri kalıcı ortama yaz ya da kabuktaki değeri kaldır, sonra yeni bir kabuk aç. Görev adı ya da asistan adı farkı yalnız uyarıdır; kurulum sürer. Görev Zamanlayıcı'nın yeni kalıcı ortamı oturumu kapatıp açmadan görüp görmediği ölçülmedi.

**Eski kurulum korumaları.** Daha önceki bir kurulumun görevi ya da verisi (eski adlar aşağıda "Mevcut bir kurulumu sürdürmek"te) yeni ayarlarla çakışırsa `kur.ts` (`--geri-al` dahil) ve `gorev-kaydet.ts`, hiçbir şeye dokunmadan önce durur:

1. Eski görev kayıtlıysa ve etkin görev adı başkaysa durur (iki servis çalışmasın diye). Bayrakla geçilemez: ya görev adını eskiye bağla ya da eski görevi önce sil.
2. Eski veri klasöründe `uygulama` ya da veritabanı (`eren.db`) varsa ve etkin veri kökü başkaysa durur (veri bölünmesin diye). Yeni kökle bilerek kurmak için `--eski-koku-yoksay` ver (`kur.ts`, `kur.ts --geri-al` ve `gorev-kaydet.ts` ile).

Ayrıntı ve yer tutuculu örnekler: [docs/SERVIS.md](docs/SERVIS.md#ortam-değişkenleri-ve-mevcut-kurulum); ilk kurulum ve güncelleme akışı: [İlk kurulum](docs/SERVIS.md#ilk-kurulum), [Güncelleme ve geri alma](docs/SERVIS.md#güncelleme-ve-geri-alma).

### Telefon denemesi

`deneyler/telefon/` altındaki deneme, telefonu PC'den uzaktan okuyup yönlendirmenin mümkün olup olmadığını ölçer.

1. Adresleri ortam değişkenleriyle ver: `EREN_PC_IP` (PC adresi), `EREN_TELEFON_IP` (izinli telefon adresi), isteğe bağlı `EREN_PORT` (varsayılan 47800).
2. `deneyler/telefon/sunucu` içinde bağımlılıkları kur (`npm ci`) ve test sunucusunu başlat: `node sunucu.js` (ya da penceresiz: `baslat.vbs`; node `PATH`'ten bulunur, farklı kurulumda tam yol `EREN_KIT_NODE` ile verilir). Komut satırı istemcisi: `node cli.js durum`.
3. Telefonsuz öz sınama: `node oztest.js`.
4. APK'yı `deneyler/telefon/android/` altından derle; PC adresi derleme sırasında `EREN_KIT_PC_URL` ortam değişkeninden okunur (örn. `ws://<pc-adresi>:47800/`), verilmezse `PC_ADRESI_BURAYA` yer tutucusu kalır.
5. Telefon kurulumu: `deneyler/telefon/TELEFON_TALIMATI.md`. Sonuçlar: [docs/OLCUMLER.md](docs/OLCUMLER.md).

## Ortam değişkenleri

- `EREN_KIT_ASSISTANT_NAME`: asistan adı (varsayılan "Claude"). Sunucuda persona metinlerine, bildirimlere ve ilk ana sohbet adına girer; uygulamada derleme anında okunur ve launcher adını belirler (verilmezse `eren-kit`).
- `EREN_KIT_DATA_DIR`: veri kökü; mutlak yol olmalı. Verilmezse varsayılan `%LOCALAPPDATA%\eren-kit`. Sunucu, bekçi ve kurulum aynı kuralı uygular; kurulum klasörü `<veri kökü>\uygulama\...`, bekçi günlüğü `<veri kökü>\logs` altındadır. Servis kurulurken üç `EREN_KIT_*` değişkeni de kalıcı kullanıcı ortamında olmalıdır (yukarıda "Servis kurulumu").
- `EREN_KIT_PHONE_TASK_NAME`: kurulumun kaydettiği zamanlanmış görevin adı (varsayılan `eren-kit-telefon`).
- `EREN_KIT_PC_URL` (APK derlemesi), `EREN_KIT_NODE` (`baslat.vbs`), `EREN_PC_IP`, `EREN_TELEFON_IP`, `EREN_PORT` (telefon denemesi): yukarıda açıklandı.

### Mevcut bir kurulumu sürdürmek

Daha önce başka bir veri klasörü, görev adı ya da asistan adıyla kurulmuş bir kurulum varsa, aynı değerleri üç değişkenle ver; yeni varsayılanlar eski verinin ve görevin yerine geçmez. Servis bu değerleri yalnız kalıcı ortamdan okuduğu için kalıcı kullanıcı ortamına yaz ve yeni bir kabuk aç:

```powershell
[Environment]::SetEnvironmentVariable("EREN_KIT_DATA_DIR", "C:\Users\<kullanıcı>\AppData\Local\<eski-veri-klasörü>", "User")   # mutlak yol
[Environment]::SetEnvironmentVariable("EREN_KIT_PHONE_TASK_NAME", "<eski-görev-adı>", "User")
[Environment]::SetEnvironmentVariable("EREN_KIT_ASSISTANT_NAME", "<eski-asistan-adı>", "User")
```

Eski kurulumun veri klasörü ya da görevi etkin ayarlarla çakışırsa `kur.ts` durur (yukarıdaki "Eski kurulum korumaları"); eski veri klasörünü bilerek yok sayıp yeni kökle kurmak için `--eski-koku-yoksay` kullanılır. Tam örnek: [docs/SERVIS.md](docs/SERVIS.md#ortam-değişkenleri-ve-mevcut-kurulum).

Mevcut veritabanındaki ana sohbetin adı yeniden adlandırılmaz; yeni ad yalnız yeni oluşturulan ana sohbete uygulanır.

## Güvenlik notu

- Deneme sunucusunda kimlik doğrulama yoktur; yalnızca özel, güvenilir bir ağda ve izinli IP ile çalıştır.
- Tasarlanan servis modeli: eşleştirme normalde kapalıdır, telefon Keystore'da anahtar üretir, PC yalnızca açık anahtarı saklar, her bağlantıda karşılıklı imza sınaması yapılır; paylaşılan sır yoktur.
- Telefon iş oturumları Bash, dosya ve web aracı almaz; yalnızca telefon ve soru araçlarını kullanır. Hassas uygulamalar paket listesiyle (değişmez ret listesi) korunur; `FLAG_SECURE`'a güvenilmez.
- Model davranışı güvenlik kanıtı sayılmaz: güvence Kotlin kapısından ve izin modelinden gelir. Ayrıntı, kalan açıklar ve ölçüm sınırları: [docs/GUVENLIK.md](docs/GUVENLIK.md), [docs/OLCUMLER.md](docs/OLCUMLER.md).
- Deneme sırasında hassas uygulama açma, gerçek parola girme.

## Belgeler

- [docs/MIMARI.md](docs/MIMARI.md): mimari kararlar
- [docs/GUVENLIK.md](docs/GUVENLIK.md): güvenlik modeli
- [docs/SERVIS.md](docs/SERVIS.md): servis işletimi (bekçi, zamanlanmış görev, kurulum düzeni)
- [docs/TASARIM.md](docs/TASARIM.md): arayüz tasarım dili
- [docs/OLCUMLER.md](docs/OLCUMLER.md): ölçümler
- [protocol/README.md](protocol/README.md), [protocol/CIHAZ.md](protocol/CIHAZ.md): protokol
- [server/MODULLER.md](server/MODULLER.md): servis modülleri
- [app/TASARIM.md](app/TASARIM.md): telefon uygulaması modülleri
- [deneyler/telefon/README.md](deneyler/telefon/README.md): telefon denemesi

Monorepo ana sayfası: [../../README.md](../../README.md)
