# Telefon uygulaması: iOS / iPadOS

Durum: 2026-11-09. Uygulama aynı Expo / React Native kod tabanından iOS'ta da derlenir ve açılır. Yalnız sohbet hedeflenir (MIMARI.md: "iPad'e yalnız sohbet"). Cihaz yönetimi Android'e özgüdür: tam yetki, uygulamalar, erişilebilirlik, ses kısayolu, Kotlin `eren-device` modülü.

## Bugün çalışan (iOS Simulator'da doğrulandı)

- **Derleme:** `expo prebuild -p ios`, ardından `pod install` ve `xcodebuild` (Release, iphonesimulator). Kodda iOS'a özel değişiklik gerekmedi; derleme başarılı.
- **Açılış:** uygulama açılır. Sohbet ekranı "PC ile eşleşme yok" der ve kuruluma yönlendirir.
- **Kurulum ekranı:** yerel modül yokken Android'e özgü bölümleri (tam yetki, uygulamalar ve denetim, telefon ayarları) göstermez. iOS'ta durumu açıklayan bir şerit gösterir (`src/ekranlar/modulYok.ts`).
- **Yerel modülsüz çalışma:** `src/cihaz/erenDevice.ts`, modül yokken her çağrıya `desteklenmiyor` döndürür. Ekranlar bu yüzden çökmez; bu tasarım zaten vardı.

Simülatörde çalıştırma:

```bash
cd apps/phone/app
npm ci
npx expo prebuild -p ios --no-install && (cd ios && pod install)
xcodebuild -workspace ios/*.xcworkspace -scheme <AppAdı> -configuration Release \
  -sdk iphonesimulator -destination 'id=<simülatör-udid>' -derivedDataPath build/ios build
xcrun simctl install <udid> build/ios/Build/Products/Release-iphonesimulator/<AppAdı>.app
xcrun simctl launch <udid> dev.eren.app
```

Not: Xcode projesinin adı `EREN_KIT_ASSISTANT_NAME` değerinden gelir (`app.config.ts`).

## iOS'ta gerçek sohbet için eksik olan: kimlik modülü

`/sohbet` kanalı bağlanmadan önce karşılıklı imza sınaması yapar (`protocol/CIHAZ.md`):
- İmza ECDSA P-256 + SHA-256, DER biçiminde, standart base64.
- Açık anahtar SPKI DER biçiminde.
- İmzalanan metin rol, kanal ve iki nonce'tan oluşur.

Android'de bunu Kotlin modülü Keystore ile yapar. iOS'ta karşılığı küçük bir Swift Expo modülüdür. JS yüzeyi aynıdır (`ErenDevice.types.ts`), iOS'ta yalnız şu dört çağrı gerçeklenir:

| Çağrı | iOS gerçeklemesi |
| --- | --- |
| `eslesme()` | Keychain'deki eşleşme kaydı: `device_id`, `host`, `port`, PC açık anahtarı |
| `eslestir()` | PC'deki `eren eslestir` QR'ı ya da kısa kod. Kamera için `AVFoundation` ya da `expo-camera` |
| `sohbetHello()` | 32 bayt `client_nonce` (`SecRandomCopyBytes`), tek kullanımlık 30 sn `oturum` |
| `sohbetSinama(...)` | Önce PC imzası `P256.Signing.PublicKey(derRepresentation:)` ile doğrulanır; tutarsa `telefon/sohbet` baytları imzalanır |

Anahtar:
- Gerçek cihazda `SecureEnclave.P256.Signing.PrivateKey`. Anahtar cihazdan çıkmaz ve isteğe bağlı olarak biyometriye bağlanabilir.
- Simülatörde Secure Enclave yoktur. Orada Keychain'de duran bir yazılım anahtarı (`P256.Signing.PrivateKey`) kullanılır.
- `signature.derRepresentation` ve `publicKey.derRepresentation` (SPKI) protokoldeki biçimlerle birebir aynıdır.

Diğer bütün çağrılar iOS'ta `desteklenmiyor` döner. Böylece yapısal sınır korunur: JS'e jeton ya da genel `imzala` açılmaz.

## Sunucu tarafı

Telefonun bağlandığı servis (`server/`) bugün Windows'u varsayar:
- `LOCALAPPDATA` ve `USERPROFILE`,
- `claude.exe` araması,
- adlandırılmış boru,
- Görev Zamanlayıcı.

iPhone, Windows PC'deki servise bağlanabilir; bunun için macOS sunucusu gerekmez.

Servisin Mac'te çalışması için gerekenler:
- yol çözümü (`veri-koku.ts`, `ayar.ts`);
- PATH'te `claude`;
- Unix soketi;
- launchd.

macOS portu (#1) sırasında bunun ilk hali yazılmış, sunucu hızla değiştiği için geri çekilmişti. Sunucu oturunca ayrı bir PR olarak gelebilir.

## Önerilen sıra

1. Swift kimlik modülü: yukarıdaki dört çağrı. Birim testi olarak `protocol/vektorler` imza vektörleri Swift'te doğrulanır.
2. Eşleştirme ekranı (QR ya da kod) ve iPad yerleşimi.
3. macOS sunucu portu (isteğe bağlı; Windows sunucusuyla da çalışır).
4. CI: macOS runner'da iOS Simulator derlemesi. Ağır bir iş (15+ dk), yalnız `apps/phone/app` değişince tetiklenebilir.
