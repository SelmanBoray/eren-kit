# ajanda-olcum

Atılabilir ölçüm uygulaması. Yapılacaklar/takvim uygulamasının hatırlatmaları tamamen telefonda kuracağı
varsayımını sınar: **kesin alarmlar ve periyodik arka plan işi bu telefonda gerçekten zamanında çalışıyor mu?**
İnternet izni yoktur; günlükte yalnız zamanlar ve cihaz olguları bulunur.

## Ne ölçer

- **Kesin alarm** (`setExactAndAllowWhileIdle`): 15 dakikada bir, sabit ızgara üzerinde (48 saatte 192 örnek).
- **Çalar saat alarmı** (`setAlarmClock`): 3 saatte bir, 7,5 dk kaydırılmış. Bu tür alarm telefonu Doze'dan
  uyandırdığı için kesin alarm ölçümünü bozmasın diye seyrek tutuldu.
- **Periyodik iş** (JobScheduler, 15 dk): biri kısıtsız, biri "ağ varken" koşullu. Gerçek çalışma aralıkları kaydedilir.
- Her çalmada: gecikme, ekran açık mı, Doze'da mı, şarjda mı, pil optimizasyonundan muaf mı, bekletme kovası,
  süreç soğuk mu başladı (ör. uygulama kaydırılıp atıldıktan sonra).
- Yeniden başlatma: kapanış/açılış yayını geldi mi, alarmlar açılıştan kaç saniye sonra yeniden kuruldu.
- Zorla durdurma: sistemin kaydettiği süreç çıkış nedenleri (Android 11+) ve alarm niyetlerinin sistemde kalıp kalmadığı.
- Saat ve saat dilimi değişimi.
- Cihaz olguları: Android sürümü, üretici/model, MIUI/HyperOS sürümü, kesin alarm izni, pil muafiyeti, bildirim izni.

Her slotun planlanan anı önceden bilindiği için, çalmayan her alarm tek tek sayılır ve nedenine göre ayrılır:
telefon kapalıydı / yeniden başlatmadan sonra henüz kurulmamıştı / uygulama zorla durdurulmuştu /
hiç kurulmamıştı / **açıklanamayan** (pil yönetimi veya Doze). Planlanan anın üzerinden 30 dk geçmeden "kaçtı" denmez.

## Kullanıcı ne yapar

1. APK'yı kur (`app/build/outputs/apk/debug/app-debug.apk`, debug anahtarıyla imzalı). Uygulamayı aç,
   **Ölçümü başlat**'a bas. "Bildirim izni iste"yi onayla.
2. **İlk 24 saat:** başka ayara dokunma, telefonu normal kullan. Bu, varsayılan durumun ölçümüdür.
3. Bu sürede birer kez dene (önce uygulamadaki ilgili **işaret** düğmesine bas):
   - uygulamayı son uygulamalardan kaydırıp at;
   - telefonu yeniden başlat (sonra uygulamayı **açma**, kendiliğinden toparlanıyor mu görelim);
   - saat dilimini değiştirip birkaç dakika sonra geri al.
   - Gece telefonu ekranı kapalı, şarjsız bırakmak Doze ölçümü için yeterli.
4. **Sonraki 24 saat:** "Pil optimizasyonundan muaf tut"a bas; "Uygulama bilgisi"nden Xiaomi'nin
   **Otomatik başlatma** iznini aç ve pil tasarrufunu **Kısıtlama yok** yap. Aynı denemeleri tekrarla.
   Günlük her olayda muafiyet durumunu tuttuğu için iki dönem özette ayrı görünür.
5. Bitince **Paylaş (dosya olarak)** ya da **Dosyaya kaydet** ile `.txt` dosyasını gönder. Dosyanın başında özet,
   altında ham günlük vardır (adb gerekmez).

## Sonuç nasıl yorumlanır

- **Kesin alarm, pil: optimize ediliyor** satırı varsayılan durumdur. Kaçırma oranı ~%0 ve gecikme p95 ≤ 1 dk ise
  mimari varsayım tutuyor. Doze satırlarında birkaç dakikalık gecikme olağandır.
- **Açıklanamayan** kaçırmalar ya da >15 dk gecikmeler pil yönetiminin alarmı yuttuğunu gösterir. Muafiyet
  döneminde kayboluyorsa, uygulama kurulumda muafiyet + otomatik başlatma istemelidir.
- **Yeniden başlatmalar**: "açılış yayını GELMEDİ" ve "KURULMADI" → otomatik başlatma kapalıyken hatırlatmalar
  açılıştan sonra kullanıcı uygulamayı açana dek ölüdür.
- **Uygulama zorla durdurulmuştu** nedeni kaydırıp atmayla geliyorsa, bu telefonda kaydırma alarmları siliyor demektir.
- **Çalar saat** serisi kesin seriden belirgin iyiyse, önemli hatırlatmalar için `setAlarmClock` kullanılmalı.
- **Periyodik iş** aralık ortancası 15 dk'ya yakınsa eşitleme için JobScheduler/WorkManager yeterli; saatlerle
  ölçülüyorsa PC eşitlemesi uygulama açılışına ya da kullanıcı eylemine bağlanmalı.

## Derleme

```
set ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk
gradlew.bat --offline testDebugUnitTest assembleDebug
```

Gradle 8.14, AGP 8.13.0, Kotlin 2.2.20, compile/target SDK 36, minSdk 26; çalışma zamanında bağımlılık yok.
Saf mantık (`cekirdek/`: günlük biçimi, plan ızgarası, analiz, rapor) JUnit ile sınanır.
