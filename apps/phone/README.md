# eren-kit telefon uygulaması (`apps/phone`)

> ⚠️ **Experimental / Deneysel.** Bu uygulama geliştirme aşamasındadır, henüz kullanıma hazır değildir. Arayüzler, protokol ve güvenlik modeli değişebilir. Bilinen riskler ve kalan açıklar: [docs/GUVENLIK.md](docs/GUVENLIK.md).

**English summary.** A phone app for talking to your main Claude session running on a PC. The main session does not do the work itself: for every task it opens a fresh Claude Code session, hands the task over and reports the result back to the phone. It can also drive an Android phone through an accessibility service. This directory holds the shared protocol (`protocol/`), the PC service (`server/`), the Expo / React Native client with its Kotlin `eren-device` module (`app/`), the install tooling (`kurulum/`) and architecture/security/measurement notes (`docs/`). Release APKs must be signed with your own keystore (see "Release derlemesi ve imza"); the build refuses the Android debug key. The assistant's display name is neutral and comes from the `EREN_KIT_ASSISTANT_NAME` environment variable (default "Claude"); the data root and the scheduled task name are configurable too (see "Ortam değişkenleri"). Documentation is in Turkish. See the [root README](../../README.md) for the monorepo.

---

## Ne yapar

Telefon uygulamasından, bilgisayardaki ana Claude oturumuyla konuşursun. Ana oturum işin kendisini yapmaz, kod yazmaz; her iş için yeni bir Claude Code oturumu açar, işi o oturuma verir ve sonucu sana raporlar. Ana oturum işi bir plan olarak yazar ve telefonda gösterir; tam yetki açıkken plan onay beklemeden başlar, onay yalnız gerçekten karar gereken durumlarda istenir. Birden fazla sohbet açılabilir; her sohbetin kendi ana oturumu vardır. Telefon da yönetilebilir: bir iş oturumu, kısıtlı bir araç kümesiyle (ekran okuma, dokunma, yazma) Android telefonu kontrol eder. Sesle (dikte düğmesi ya da kısayol) gönderdiğin mesajın cevabı telefonda yerleşik seslendiriciyle okunur ("Sustur" ile kesilir). Tur sürerken ekranda "yazıyor" yerine asistanın o anki işi görünür ("düşünüyor", "komut çalıştırıyor · 42 sn" gibi; yalnız sabit kategori gider, araç içeriği gitmez).

Asistan adı `EREN_KIT_ASSISTANT_NAME` ortam değişkeninden gelir (varsayılan "Claude"); sunucu bunu `Ayar.asistanAdi` olarak okur, uygulama derleme anında alır. Kodda geçen `eren` önekli adlar (`@eren/protocol`, `dev.eren.*`, `eren-device`, `eren-servis` vb.) tanımlayıcıdır; kişilik adı değildir ve kurulu uygulamanın güncellenebilmesi için değişmez.

## Mimari (özet)

- **`protocol/`** (`@eren/protocol`): telefon, PC servisi ve MCP köprülerinin ortak mesaj sözleşmesi; zod şemalarından türeyen tipler ve doğrulayıcılar. Cihaz kanalı: [protocol/CIHAZ.md](protocol/CIHAZ.md).
- **`server/`** (`@eren/server`): tek Node 24 + TypeScript süreci. Modüller: `gateway` (WebSocket), `konusma` (ana oturum süreci), `isler` (iş oturumları), `planlar`, `cihaz` (telefon komutları), `bildirim`, `kilit` (limit düzeneği), `depo` (SQLite). Modül sözleşmeleri: [server/MODULLER.md](server/MODULLER.md).
- **`app/`** (`eren-app`): Expo / React Native istemci (TypeScript) ve Android tarafı için `app/modules/eren-device` Kotlin modülü. Saf Kotlin çekirdek (izin, denetim, komut işleyici) ayrı bir JVM Gradle projesidir; Android adaptörü ve Expo köprüsü onun üstünde durur. Modül dökümü: [app/TASARIM.md](app/TASARIM.md). Çalışma alanı dışındadır: kendi `package.json` ve `package-lock.json` dosyasıyla ayrı kurulur.
- **`kurulum/`**: servisin sürümlü dağıtımı (`kur.ts`), zamanlanmış görev kaydı ve yardımcı komutlar. Servis işletimi: [docs/SERVIS.md](docs/SERVIS.md).
- **MCP köprüleri:** ince stdio köprüleri; adlandırılmış boruyla servise bağlanır, mantık serviste kalır.
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
npm run android                  # expo run:android: yalnız geliştirme (debug) derlemesi, Android SDK gerekir
```

#### Release derlemesi ve imza

Telefona kalıcı kurulacak APK release derlemesidir: `npx expo run:android --variant release` ya da `npx expo prebuild -p android` ardından `cd android && ./gradlew assembleRelease` (Windows'ta `.\gradlew.bat assembleRelease`; çıktı `android/app/build/outputs/apk/release/app-release.apk`). Expo şablonu release'i herkesin bildiği Android debug anahtarıyla imzalar; aynı anahtarla imzalanmış başka bir APK kurulu uygulamanın "güncellemesi" olarak kurulup eşleşmeyi ve tam yetkiyi devralabilirdi. `app/plugins/with-release-imza.js` bu yüzden prebuild'de debug imza satırını söker ve imzayı yalnız sizin keystore'unuzdan kurar. Bir kerelik adımlar:

1. Keystore'u repo dışında oluşturun:
   ```bash
   keytool -genkeypair -v -storetype PKCS12 -keystore <repo-dışı-yol>/eren-kit-release.p12 -alias eren-kit -keyalg RSA -keysize 4096 -validity 10000
   ```
2. Dört ayarı repo dışından verin: `~/.gradle/gradle.properties` dosyasına (yolda `/` kullanın) ya da aynı adlı ortam değişkeni olarak (ayrıca `-P` bayrağıyla da verilebilir): `EREN_KIT_RELEASE_STORE_FILE` (keystore'un mutlak yolu), `EREN_KIT_RELEASE_STORE_PASSWORD`, `EREN_KIT_RELEASE_KEY_ALIAS` (örnekte `eren-kit`), `EREN_KIT_RELEASE_KEY_PASSWORD` (PKCS12 keystore'da keystore parolasıyla aynıdır).
3. Keystore'u ve parolasını yedekleyin. Kaybolursa kurulu uygulama aynı imzayla güncellenemez (kaldırıp yeniden kurmak ve yeniden eşleşmek gerekir). Keystore repoya konmaz (`app/.gitignore` `*.p12`, `*.jks`, `*.keystore` dosyalarını dışarıda tutar).

Ayar eksikse, keystore'da verilen ad yoksa ya da verilen anahtar bir Android debug sertifikasıysa release derlemesi açık bir hatayla durur ve bu adımları yazar. Debug derlemesi (`npm run android`) etkilenmez.

**Önceden oluşmuş `android/` klasörü: önce prebuild.** Plugin yalnız prebuild sırasında uygulanır ve `npx expo run:android` `app/android/` klasörü varsa prebuild'i hiç çalıştırmaz. Bu plugin gelmeden önce (örneğin daha eski bir `npm run android` ile) oluşmuş bir `android/` klasörü bu yüzden plugin'i hiç almamıştır ve release'i debug anahtarıyla imzalar. Böyle bir çalışma kopyanız varsa ilk release derlemesinden önce bir kez şunu çalıştırın (ya da `app/android/` klasörünü silin); `android/` içinde elle yaptığınız değişiklikler silinir:

```powershell
npx expo prebuild -p android --clean
```

Plugin bunu ayrıca denetler: `android/app/build.gradle` plugin'in ürettiği bloğu taşımıyorsa release yolu (`expo run:android --variant release` ve Gradle'ın release paketlemesinde çağırdığı `expo export:embed`) bu komutu yazan bir hatayla durur; debug derlemesi ve `expo start` yalnız uyarır. Denetim Expo yapılandırması okunurken çalışır; Gradle'ı Expo dışından, JS paketlemesi olmadan çalıştıran bir yol bunu atlayabilir, prebuild adımını yine de atlamayın.

**Geçiş notu (debug imzalı eski kurulum).** Daha önce debug anahtarıyla imzalı bir release APK kurduysanız yeni imzalı APK onun üzerine kurulamaz (Android imza uyuşmazlığı). Uygulamayı kaldırıp yeni APK'yı kurun; ardından eşleşmeyi yeniden yapın (`eren eslestir`; eski kaydı PC'de `eslestir.ts --kaldir` ile kaldırın, [docs/GUVENLIK.md](docs/GUVENLIK.md#eşleşmeyi-kaldırma-kaybolan-ya-da-çalınan-telefon)), tam yetkiyi gerekiyorsa yeniden açın ve adb ile verilen `WRITE_SECURE_SETTINGS` / `GET_USAGE_STATS` izinleri için `node --disable-warning=ExperimentalWarning kurulum/telefon.ts`'i yeniden çalıştırın ([docs/SERVIS.md](docs/SERVIS.md#telefon-kurulumu)).

**Geçiş notu (ses tuşu kısayolu, eski sürüm).** Eski sürümler ses tuşu kısayolunu kurarken iki ayarı kalıcı olarak değiştiriyordu: telefonun önceki erişilebilirlik kısayolu hedefinin (`accessibility_shortcut_target_service`) üzerine yazıyor ve Android'in ilk kullanımda gösterdiği "kısayol neyi açar" onayını `accessibility_shortcut_dialog_shown=1` ile bastırıyordu. Yeni sürüm kısayolu mevcut hedeflerin yanına ekler ve onay ayarına hiç yazmaz, ama eski sürümün değiştirdiğini geri almaz; önceki hedefin değeri hiç saklanmadığı için geri alamaz da. Eski sürümde kısayolu kurduysanız: önceki kısayolunuzu Ayarlar > Erişilebilirlik'te ilgili hizmetin kısayol anahtarından yeniden seçin; onayın yeniden gösterilmesini istiyorsanız adb bağlıyken `adb shell settings put secure accessibility_shortcut_dialog_shown 0` çalıştırın (anahtar Android'in gizli ayarıdır; komut gerçek cihazda denenmedi).

Saf Kotlin çekirdeğin birim testleri: `cd app/modules/eren-device/cekirdek` içinde `.\gradlew.bat test`. APK derlemesinde görünen asistan adı `EREN_KIT_ASSISTANT_NAME`'den gelir; verilmezse uygulama adı (launcher) `eren-kit` olur. Telefon kurulumu ve cihaz tarafı ayrıntısı [app/TASARIM.md](app/TASARIM.md) ve [docs/GUVENLIK.md](docs/GUVENLIK.md) içindedir.

### Servis kurulumu

Servisin sürümlü dağıtımı `kurulum/kur.ts` ile yapılır: temiz bir kopyayı test eder, veri kökünün altındaki `uygulama\` klasörüne kopyalar ve zamanlanmış görevle çalışan bekçiye bildirir. Komutlar `apps/phone` içinden çalıştırılır:

```powershell
node --disable-warning=ExperimentalWarning kurulum/kur.ts               # test kapısı + kurulum
node --disable-warning=ExperimentalWarning kurulum/kur.ts --yalniz-test # yalnız test kapısı, kurmaz
node --disable-warning=ExperimentalWarning kurulum/kur.ts --durum       # salt okunur: veri kökü, olası çakışmalar
node --disable-warning=ExperimentalWarning kurulum/kur.ts --izin-duzelt # veri kökünü yalnız bu hesap, SYSTEM ve Administrators'a daralt
```

**Veri kökünün izni.** Veri kökü özel anahtarı, veritabanını, köprü jetonlarını ve servisin çalıştırdığı kodu tutar; bu yüzden yalnız sizin hesabınıza, SYSTEM'e ve Administrators'a açık olmalıdır. Servis başka hesaplara açık bir kökle açılmaz (nedeni ve düzeltme komutu `servis.log`'a yazılır); kök yoksa yalnız size açık olarak oluşturur. `kur.ts` (ve `--geri-al`) kopyalamadan önce kökü denetler: eren-kit'e ait görünen kökü (içinde `uygulama` ya da `eren.db` var ya da boş) kendisi daraltır, başka bir klasörü yalnız `--izin-duzelt` ile bilerek daraltır, sürücü kökünü hiç daraltmaz. Daraltma olursa `UYARI:` satırı çıkar: o hesaplara güvenmiyorsanız eşleşmeleri kaldırıp yeniden eşleştirin, sunucu anahtarını (`sunucu-anahtar.pem`) ve Telegram jetonunu yenileyin. `--izin-duzelt` servisin gerçekten kullanacağı kökü düzeltir: Görev Zamanlayıcı'nın başlattığı servis kalıcı kullanıcı ortamını gördüğü için kökü kalıcı ortamdaki `EREN_KIT_DATA_DIR`'den (yoksa `%LOCALAPPDATA%\eren-kit`) alır, düzelttiği kökü terminale yazar ve bu kabuktaki değer farklıysa ayrıca uyarır; kalıcı ortam okunamazsa bu kabuğun kökünü uyarıyla düzeltir. `%LOCALAPPDATA%` altındaki kök, izinlerini üst klasörden kalıtımla alıp başka bir yerel gruba (ör. bir korumalı alan/sandbox grubu) okunabilir olabilir; daraltma o grubun erişimini keser, kökün altında başka bir aracın korumalı alanı çalışıyorsa etkilenebilir (doğrulanmadı).

Temizlik denetimi (commit'lenmemiş değişiklik var mı, test sürerken kod değişti mi) yalnız `apps/phone` ağacına bakar: depodaki başka paketlerde değişiklik ya da depoya giren ilgisiz bir commit kurulumu durdurmaz. Sürüm adı da `apps/phone` içeriğine bağlıdır: `apps/phone`'a dokunan son commit'in kısa sha'sı; aynı içerikte kurulu bir sürüm varsa (önceki kurulumların depo HEAD'iyle adlandırdığı sürümler dahil) onun adı yeniden kullanılır. Depoya giren ilgisiz commit yeni sürüm üretmez, eski sürümleri de saklama sınırından erken düşürmez.

Kurulum, yeni sürümün beklenen veri kökünde çalıştığını doğrulamadan başarı bildirmez (bekçinin bildirdiği kök; bunu bildirmeyen eski bekçide beklenen kökteki servis günlüğü). Bekçi başka bir kök bildirirse kurulum, servisin kararlı hâle gelmesini beklemeden hemen durur. Önce servis durdurulur ve görev kapatılır, sonra `guncel` önceki sürüme döner; geri alma başarısız olursa servis yine durmuş kalır ve mesaj bunu da söyler. Ortam düzeltilince `eren baslat` ile açılır. `eren baslat` da `kur.ts` gibi kabuk ile kalıcı ortamı karşılaştırır, sonra servisin beklenen kökte açıldığını aynı yöntemle doğrular. Servis başka bir kökte açılırsa onu durdurur ve görevi kapatır.

`--durum` (ve `eren durum`) veri kökünü, bekçinin çalıştığı veri kökünü ve eski kurulumla olası çakışmaları gösterir. Zamanlanmış görevin kaydı (`kurulum/gorev-kaydet.ts`), geri alma (`--geri-al`), `eren` komutu ve diğer bayraklar [docs/SERVIS.md](docs/SERVIS.md) içindedir.

**Ortam değişkenlerini kalıcı kullanıcı ortamına yaz.** Görev Zamanlayıcı'nın başlattığı servis yalnız kalıcı ortamı görür; bir kabukta geçici verilen değişken servise ulaşmaz. Önce değişkenleri kalıcı kullanıcı ortamına yaz, sonra yeni bir kabuk aç (açık kabuk sonradan yazılan değeri görmez), sonra `kur.ts`'i çalıştır:

```powershell
[Environment]::SetEnvironmentVariable("EREN_KIT_DATA_DIR", "<mutlak-yol>", "User")
[Environment]::SetEnvironmentVariable("EREN_KIT_PHONE_TASK_NAME", "<görev-adı>", "User")
[Environment]::SetEnvironmentVariable("EREN_KIT_ASSISTANT_NAME", "<asistan-adı>", "User")
```

Değişken vermezsen varsayılanlar geçerlidir (aşağıda "Ortam değişkenleri"); yalnız varsayılanlarla kuruyorsan bu adım gerekmez.

**Kabuk ile kalıcı ortam uyuşmazsa kurulum durur.** `kur.ts` (`--geri-al` dahil), `gorev-kaydet.ts` ve `eren baslat`, hiçbir şeye dokunmadan önce kabuktaki değerleri kalıcı ortamla karşılaştırır. `EREN_KIT_DATA_DIR` kabukta ve kalıcı ortamda farklıysa kurulum "hiçbir şey değişmedi" diyerek durur: aksi halde servis başka köke yazar ve veri bölünür. Çözüm: değeri kalıcı ortama yaz ya da kabuktaki değeri kaldır, sonra yeni bir kabuk aç. Görev adı ya da asistan adı farkı yalnız uyarıdır; kurulum sürer. Görev Zamanlayıcı'nın yeni kalıcı ortamı oturumu kapatıp açmadan görüp görmediği ölçülmedi; görmezse kurulum sonrası veri kökü doğrulaması bunu yakalar.

**Eski kurulum korumaları.** Daha önceki bir kurulumun görevi ya da verisi (eski adlar aşağıda "Mevcut bir kurulumu sürdürmek"te) yeni ayarlarla çakışırsa `kur.ts` (`--geri-al` dahil), `gorev-kaydet.ts`, `eren dur` ve `eren baslat`, hiçbir şeye dokunmadan önce durur:

1. Eski görev kayıtlıysa ve etkin görev adı başkaysa durur (iki servis çalışmasın diye). Bayrakla geçilemez: ya görev adını eskiye bağla ya da eski görevi önce sil.
2. Eski veri klasöründe `uygulama` ya da veritabanı (`eren.db`) varsa ve etkin veri kökü başkaysa durur (veri bölünmesin diye). Yeni kökle bilerek kurmak için `--eski-koku-yoksay` ver (`kur.ts`, `kur.ts --geri-al`, `gorev-kaydet.ts`, `eren dur` ve `eren baslat` ile).

Ayrıntı ve yer tutuculu örnekler: [docs/SERVIS.md](docs/SERVIS.md#ortam-değişkenleri-ve-mevcut-kurulum); ilk kurulum ve güncelleme akışı: [İlk kurulum](docs/SERVIS.md#ilk-kurulum), [Güncelleme ve geri alma](docs/SERVIS.md#güncelleme-ve-geri-alma).

## Ortam değişkenleri

- `EREN_KIT_ASSISTANT_NAME`: asistan adı (varsayılan "Claude"). Sunucuda persona metinlerine, bildirimlere ve ilk ana sohbet adına girer; uygulamada derleme anında okunur ve launcher adını belirler (verilmezse `eren-kit`).
- `EREN_KIT_DATA_DIR`: veri kökü; mutlak yol olmalı. Verilmezse varsayılan `%LOCALAPPDATA%\eren-kit`. Sunucu, bekçi ve kurulum aynı kuralı uygular; kurulum klasörü `<veri kökü>\uygulama\...`, bekçi günlüğü `<veri kökü>\logs` altındadır. Servis kurulurken üç `EREN_KIT_*` değişkeni de kalıcı kullanıcı ortamında olmalıdır (yukarıda "Servis kurulumu"). Klasör yalnız sizin hesabınıza, SYSTEM'e ve Administrators'a açık olmalıdır, yoksa servis açılmaz (yukarıda "Veri kökünün izni"). Kullanıcı profilinizin dışındaki bir klasör (`C:\…`, `D:\…`) önerilmez: oralarda Windows varsayılanı çoğunlukla bütün yerel kullanıcılara erişim verir; böyle bir kök ya boş ve yeni olmalı ya da `--izin-duzelt` ile bilerek daraltılmalıdır.
- `EREN_KIT_PHONE_TASK_NAME`: kurulumun kaydettiği zamanlanmış görevin adı (varsayılan `eren-kit-telefon`).
- `EREN_KIT_RELEASE_STORE_FILE`, `EREN_KIT_RELEASE_STORE_PASSWORD`, `EREN_KIT_RELEASE_KEY_ALIAS`, `EREN_KIT_RELEASE_KEY_PASSWORD`: release APK imzası (yukarıda "Release derlemesi ve imza"). Ortam değişkeni ya da `~/.gradle/gradle.properties` özelliği olarak verilir; repoya yazılmaz. Eksikse release derlemesi durur; debug derlemesi bunları istemez.

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

- Servis modeli: eşleştirme normalde kapalıdır, telefon Keystore'da anahtar üretir, PC yalnızca açık anahtarı saklar, her bağlantıda karşılıklı imza sınaması ve eşleşmiş Tailscale IP denetimi yapılır; paylaşılan sır yoktur. Yeni bir PC ile eşleşmek telefonun tam yetkisini kapatır. El sıkışmadan sonraki çerçevelerin gizliliği ve bütünlüğü Tailscale'e (WireGuard) dayanır; kanal kendisi şifrelenmemiş `ws://`'dir (ayrıntı: [docs/GUVENLIK.md](docs/GUVENLIK.md), kalan açık 36).
- **Tailnet ACL'iyle servisin portunu yalnız telefonunuza açın.** Kimlik doğrulama öncesi yüzey (eşleştirme ve el sıkışma) Tailscale arayüzünü görebilen her tailnet düğümüne açıktır (paylaşılan düğümler, subnet router arkasındaki cihazlar dahil). Tailscale IP'si yalnız ikinci etkendir: subnet router arkasındaki birçok cihaz aynı IP'den gelir ve bu denetim onları ayıramaz (kalan açık 35).
- **Güvenilmeyen başka yerel hesap olan makineye kurmayın.** Servis sabit adlı Windows borularını kullanır (`\\.\pipe\eren-kopru`, `\\.\pipe\eren-servis-tekil`, `\\.\pipe\eren-bekci`); aynı makinedeki başka bir yerel hesap bu adları önceden alıp servisi açılmaz hâle getirebilir ya da köprünün yolladığı jetonu alabilir. Kodla düzeltilmedi (kalan açık 37). Veri kökü izni daraltma uyarısı (`UYARI:` satırı) görürseniz eşleşmeleri ve sunucu anahtarını yenileyin (yukarıda "Veri kökünün izni").
- Telefon iş oturumları Bash, dosya ve web aracı almaz; yalnızca telefon araçlarını kullanır; kullanıcıya soru sormaz, belirsizlikte en makul yorumla ilerler. Kurulu sıradan uygulamalar varsayılan olarak açıktır. Ayarlar, Play Store, paket kurucu, izin pencereleri, Tailscale, ana ekran ve klavye değişmez ret listesindedir. Banka, para ve kimlik uygulamaları ad ve paket adından **tahminle** kapalı başlar; tahmin her uygulamayı yakalamaz (liste Türkiye odaklıdır; yurt dışındaki bir bankanın uygulaması açık başlayabilir). Kurulumdan sonra Uygulamalar ekranını gözden geçirip istemediklerinizi kapatın. `FLAG_SECURE`'a güvenilmez.
- Telefonun ağ çıkışı yalnız PC servisi değildir: QR okuma Google'ın kod tarayıcısıyla (ML Kit tabanlı) yapılır, dikte cihazın sistem tanıyıcısına (çoğu cihazda Google bulutu) gider; ağ trafiği ölçülmedi (kalan açık 38). PC'den gelen bildirimlerin kilit ekranında görünmesi telefonun bildirim ayarına bağlıdır (39).
- Model davranışı güvenlik kanıtı sayılmaz: güvence Kotlin kapısından ve izin modelinden gelir. Ayrıntı, kalan açıklar ve ölçüm sınırları: [docs/GUVENLIK.md](docs/GUVENLIK.md), [docs/OLCUMLER.md](docs/OLCUMLER.md).
- Denerken hassas uygulama açmayın, gerçek parola girmeyin.

## Belgeler

- [docs/MIMARI.md](docs/MIMARI.md): mimari kararlar
- [docs/GUVENLIK.md](docs/GUVENLIK.md): güvenlik modeli
- [docs/SERVIS.md](docs/SERVIS.md): servis işletimi (bekçi, zamanlanmış görev, kurulum düzeni)
- [docs/TASARIM.md](docs/TASARIM.md): arayüz tasarım dili
- [docs/OLCUMLER.md](docs/OLCUMLER.md): ölçümler
- [protocol/README.md](protocol/README.md), [protocol/CIHAZ.md](protocol/CIHAZ.md): protokol
- [server/MODULLER.md](server/MODULLER.md): servis modülleri
- [app/TASARIM.md](app/TASARIM.md): telefon uygulaması modülleri

Monorepo ana sayfası: [../../README.md](../../README.md)
