# ajanda-bolge-olcum

Atılabilir ölçüm uygulaması (`dev.eren.olcum.bolge`). Ajanda'ya eklenecek **bölge hatırlatması** ("şu yere
varınca hatırlat") için koda geçmeden önce şunu ölçer: **hedef telefonda bir yere varış ne kadar gecikmeyle,
ne sıklıkla hiç ve ne sıklıkla yanlış algılanıyor?**

Üç algılama yolu aynı anda çalışır; her olay hangi yoldan geldiğiyle kaydedilir:

| Kol | Ne | Not |
|---|---|---|
| Play Hizmetleri geofence | `GeofencingClient`: giriş, çıkış, bekleme (3 dk) | `INITIAL_TRIGGER_ENTER`; tek PendingIntent |
| Android yakınlık uyarısı | `LocationManager.addProximityAlert` | Play Hizmetleri kullanmaz; bölge başına PendingIntent |
| Wi-Fi bağlantısı (yan işaret) | `registerNetworkCallback(PendingIntent)` | yalnız bölgeye eşlenen ağa bağlanınca; yalnız giriş |

Ön plan hizmeti yoktur: asıl uygulamanın kalıcı bildirim olmadan nasıl davranacağı ölçülür. 30 dakikada bir
çalışan denetim işi (JobScheduler) pil örneği alır ve düşmüş kolları yeniden kurar; bu iş de ikinci bir
"canlanma yolu" olarak ölçülür.

## Gizlilik

- Bölge koordinatları ve adları yalnız uygulamanın özel deposunda (`files/bolgeler.tsv`) durur. Yedekleme
  ve cihazdan cihaza aktarım kapalı.
- Günlükte ve paylaşılan raporda yalnız zaman, "bölge N" etiketi, merkeze uzaklık (m), doğruluk (m), kol,
  koşul ve cihaz/sürüm olguları vardır. Koordinat, bölge adı, Wi-Fi ağ adı, cihaz kimliği **yoktur**.
- Wi-Fi ağ adı hiç saklanmaz: bölgeye eşlerken cihaza özel rastgele tuzla özeti alınır, sonra yalnız
  "eşleşti / eşleşmedi" yazılır.
- Üç katman koruma: alanları günlüğe çeviren tek yer (`cekirdek/Konum.kt` → `Kayitlar`) koordinatı uzaklığa
  indirger; her günlük satırı yasak anahtar ve koordinat biçimli değer süzgecinden geçer; dışa vermeden önce
  metin cihazdaki gerçek koordinat ve adlara karşı taranır (raporun son satırı: `gizlilik denetimi: temiz`).
  `GizlilikTest` bu üçünü sınar.
- Uygulamada `INTERNET` izni yoktur (birleştirilmiş manifestte de yok; bir kitaplık eklerse `tools:node="remove"`
  siler). Logcat'e uygulama bir şey yazmaz. Play Hizmetleri'nin kendi iç günlükleri bu uygulamanın denetiminde değildir.

## Kullanıcı ne yapar (iki hafta)

### Kurulum (ilk gün, 10 dk)

1. APK'yı kur: `app/build/outputs/apk/debug/app-debug.apk` (hata ayıklama anahtarıyla imzalı).
2. Uygulamayı aç, **1. Kurulum** bölümünde sırayla:
   - **① Kesin konum izni** → "Kesin" seçili kalsın, "Uygulamayı kullanırken".
   - **② Arka plan konumu** → açılan ayar sayfasında **"Her zaman izin ver"**, geri dön.
   - **③ Bildirim izni**.
   Üstte ✓/✗ satırları her iznin durumunu gösterir.
3. **2. Bölgeler**: sık gittiğin en az iki yerde (biri kapalı alan olsun) **"Bulunduğum yeri bölge olarak kaydet"**:
   ad yaz, yarıçap seç (100/150/250 m; kararsızsan 150), kapalı alandaysan işaretle, Wi-Fi'ye bağlıysan
   "Wi-Fi'yi eşle"yi işaretle, **Konum almaya başla**. Ekranda her kaynağın (Play birleşik, GPS, ağ) ilk
   konum süresi ve doğruluğu canlı görünür; "En iyi" ±30 m'nin altına inince ya da 1-2 dk sonra **Bu konumu kaydet**.
4. **Ölçümü başlat**. Üstteki satır yeşil **İZLEME ETKİN** olmalı; kırmızıysa nedenini yazar
   (izin yok, konum kapalı, kurulamadı...).

### Her gün (iki hafta boyunca)

- Telefonu normal kullan. Bölgelerden birine **varınca** bildirim gelir: "vardın mı?"
  - Gerçekten yeni vardıysan **Yeni vardım**; yalnız önünden/yakınından geçiyorsan **Yalnız geçiyorum**.
  - Daha önce vardıysan ya da zaten oradaysan bildirime dokun → **"… dk önce varmıştım"** /
    **"Zaten buradaydım"** / **"Bölgede değildim"**. Süreler bildirimin geldiği ana göre sorulur, bildirimi
    geç görmen sorun değil.
  - Çıkış bildirimi de aynı şekilde: **Yeni çıktım** / **Çıkmadım**.
- **Bildirim gelmediyse** (asıl ölçülen bu): bölgeye vardıktan sonra 2-3 dk içinde bildirim yoksa uygulamayı
  aç → bölgenin **Vardım** düğmesi (geç kaldıysan "… dk önce"). Kısayol: uygulama simgesine uzun bas →
  "Vardım: <ad>". Çıkışta da **Çıktım**. Bölgenin önünden geçip girmediysen **Önünden geçtim**
  (yanlış tetiklenmeyi ölçmek için değerli).
- Yanıtlanmamış bildirimler ana ekranda **3. Yanıt bekleyen bildirimler** altında durur; akşam topluca yanıtla.
- Hedef: iki haftada her dönem için **en az 10** gerçek varış (bölge başına günde bir varış yeter).

### Bir kez yapılacak denemeler (her dönemde birer kez)

Denemeden **hemen önce** "4. Deneme işareti"ndeki ilgili düğmeye bas:

1. **Kaydırıp atacağım** → uygulamayı son uygulamalardan kaydırıp at; bir sonraki varışa kadar uygulamayı açma.
2. **Yeniden başlatacağım** → bölgenin içindeyken telefonu yeniden başlat; sonra uygulamayı **açma**.
   (Kendiliğinden yeniden kuruluyor mu, kurulunca "zaten buradaydım" türü yanlış bildirim geliyor mu ölçülür.)
3. **Konumu kapatıp açacağım** → hızlı ayarlardan konumu kapat, birkaç dakika sonra aç.
4. **Pil tasarrufunu açtım** → pil tasarrufu açıkken en az bir varış yaşa, sonra kapat.
5. Bir de bölgedeyken **"Şu anki konumu sına"** (kapalı alanda): merkeze uzaklık ve doğruluk kaydedilir.

Gece telefonu ekranı kapalı, şarjsız bırakmak derin uyku (Doze) ölçümü için yeterli.

### Hafta 1: varsayılan ayarlar

Pil ve otomatik başlatma ayarlarına **dokunma**. Bu, asıl uygulamanın kurulduğu gün kullanıcıda olacak durum.

### Hafta 2: otomatik başlatma + pil muafiyeti

**5. Dönem** bölümünde:
1. **Pil optimizasyonundan muaf tut** → izin ver.
2. **HyperOS: otomatik başlatma** → bu uygulama için aç; geri dönünce "Otomatik başlatmayı açtım"ı işaretle.
3. **HyperOS: pil tasarrufu → Kısıtlama yok**; geri dönünce ilgili kutuyu işaretle.
   (Ekran açılmazsa Uygulama bilgisi'nden aynı ayarlar.)
4. **İkinci döneme geç**. Denemeleri tekrarla.

### Bitirince

**Paylaş** ya da **Dosyaya kaydet** ile `.txt` raporu gönder. Dosyanın başında özet, altında ham günlük vardır
(adb gerekmez). Ayrıca Ayarlar → Pil'de "Bölge Ölçüm"ün payını not edip ekle (uygulama bunu okuyamaz).

## Rapor nasıl okunur

Her dönem için ("Tüm ölçüm", "Dönem 1", "Dönem 2") kol başına bir blok:

- **gerçek varış N: yakalanan, kaçan, bekleyen → kaçırma %x (pay/payda)**. Gerçek varış = elle "Vardım" ya da
  "vardım" etiketli bildirim (20 dk içindeki ikisi tek varıştır, elle olan yeğlenir). Algı, varıştan en çok
  10 dk önce (etiket tahmini kaba) ile 60 dk sonrası arasında (ve çıkıştan önce) gelirse yakalandı sayılır.
  60 dk dolmadıysa "bekleyen". Konumu kullanıcı kapatmışken olan varışlar paydaya girmez.
- **kaçanların nedeni**: `konum kapalıydı`, `kol kurulu değildi` (ör. yeniden başlatmadan sonra kurulmadı),
  `açıklanamayan` (kol kuruluydu ama haber gelmedi: üretici kısıtı/konum servisi).
- **gecikme**: algı − gerçek varış; ortanca, p95, en kötü, dağılım. Wi-Fi kolu yalnız Wi-Fi eşli bölgelerde sayılır.
  Bekleme satırına 3 dk bekleme süresi dahildir.
- **yanlış tetik**: kullanıcının etiketine göre `önünden geçme`, `sınır/zaten içerideydim` (sınırda gidip gelme,
  "çıkmadım"), `hayali`. **kurulum tetiği**: kol kurulduktan 3 dk içinde gelen giriş (zaten içerideyken kurulma,
  ör. yeniden başlatma sonrası) — varış sayılmaz, ayrıca gösterilir. **etiketsiz**: yanıtlanmamış ve hiçbir
  varışla eşleşmeyen algı.
- **koşula göre**: gecikme (ekran kapalı/açık, Doze, soğuk süreç, pil tasarrufu, şarjda) ve kaçırma
  (kaydırıp atma sonrası, yeniden başlatma sonrası uygulama açılmadan, konum kapatıp açma sonrası, pil tasarrufu, olağan).
- **Yeniden başlatmalar**: açılış yayını geldi mi, süreci ilk ne uyandırdı (açılış yayını / periyodik iş / konum
  olayı / kullanıcı), her kol açılıştan kaç saniye sonra yeniden kuruldu ya da **KURULMADI**.
- **Konum kapatıp açma**: Play Hizmetleri hata olayı (1000) geldi mi, kollar konum açıldıktan ne kadar sonra kuruldu.
- **Konum alma**: kayıt/sınama başına ilk konum, ±50 m ve ±20 m'ye iniş süresi, en iyi doğruluk, kaynak; sınamada
  merkeze uzaklık. Kapalı alan satırları ayrıca işaretlidir.
- **Pil**: şarjsız aralıklarda telefonun toplam düşüşü (%/saat), dönem başına. Uygulamaya özgü değildir; iki dönemi
  ve Ayarlar → Pil'deki payı birlikte oku.
- **Sistem izleri**: soğuk girişte kol izlerinin (PendingIntent) sistemde bulunup bulunmadığı, kurulum hataları,
  Play hata kodları, süreç çıkış nedenleri (ör. "kullanıcı istedi" = kaydırma zorla durdurma gibi davranıyor),
  son cihaz olguları (HyperOS sürümü, Play Hizmetleri sürümü, izinler, bekletme kovası, otomatik başlatma okuması).

## Karar ölçütü

Bir giriş kolu, ilgili dönemde **en az 10 gerçek varışla**:

- **kaçırma < %5** ve **gecikme p95 < 5 dk** ise **GEÇER**; değilse **GEÇMEZ** (nedeniyle); 10'dan az varışta
  **VERİ YETERSİZ**.

Yorum:
- Play kolu **Dönem 1**'de geçiyorsa: Ajanda yalnız Play geofence ile yapılabilir.
- Yalnız **Dönem 2**'de geçiyorsa: Ajanda kurulumda pil muafiyeti + otomatik başlatma istemeli ve bunu
  kullanıcıya açıkça göstermeli.
- Hiçbir dönemde geçmiyorsa: bölge hatırlatması "en iyi çaba" olarak sunulmalı ya da ön plan hizmeti gibi daha
  pahalı bir yol ayrıca ölçülmeli.
- Çerçeve (yakınlık uyarısı) kolu Play'den belirgin iyi değilse Play Hizmetleri'siz yol gereksiz.
- Wi-Fi kolu yan işarettir: Play kolu kapalı alanda geç kalıyor ama Wi-Fi zamanında geliyorsa, iki işaretin
  birleşimi değerlendirilebilir.
- Yanlış tetik oranı ve "kaydırıp atma / yeniden başlatma sonrası" kaçırmaları ayrıca karara not düşülür.

## Doğrulanmadı (ölçüm ortaya çıkaracak)

Bu noktalar Android 16 / HyperOS'ta kodda varsayılmadı; sonuçları günlükte ayrı alanlarla görünür:

- HyperOS'ta son uygulamalardan kaydırma zorla durdurma gibi mi davranıyor (kayıtlar silinir mi):
  `DENETIM piVar=0` ve süreç çıkış nedeni 10.
- Otomatik başlatma kapalıyken açılış yayını ve JobScheduler işi gelir mi: yeniden başlatma bölümü.
- Otomatik başlatma izninin okunması gizli MIUI API'siyle (işlem 10008) denenir; `bilinmiyor(...)` dönebilir.
  Kullanıcı beyanı ayrıca kaydedilir. HyperOS ayar ekranlarının bileşen adları sürüme göre değişebilir.
- Çerçeve yakınlık uyarısının Android 16'da arka planda ne sıklıkla değerlendirildiği; konum kapatılıp açılınca
  kalıp kalmadığı.
- Play Hizmetleri'nin uygulama güncellemesinden sonra geofence'leri koruyup korumadığı (güncellemede yine de yeniden kurulur).
- Wi-Fi ağ adının arka planda okunabilmesi (`kimlik=alinamadi` sayısı) ve bağlantı yayınının tekrarlanması.
- PendingIntent izi denetimi sezgiseldir: sistem kaydı bir süre tutabilir; `piVar=1` kesin kanıt değildir,
  `piVar=0` güçlü işarettir.

## Derleme

```
set ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk
gradlew.bat --offline testDebugUnitTest assembleDebug
```

Gradle 8.14, AGP 8.13.0, Kotlin 2.2.20, compile/target SDK 36, minSdk 31, yalnız arm64 (yerel kod yok).
Tek çalışma zamanı bağımlılığı `com.google.android.gms:play-services-location:21.3.0` (ilk derlemede Gradle
önbelleğine iner; sonra `--offline` çalışır). Saf mantık (`cekirdek/`: günlük biçimi, gizlilik süzgeçleri,
eşleştirme ve gecikme/kaçırma analizi, rapor) JUnit ile sınanır.
