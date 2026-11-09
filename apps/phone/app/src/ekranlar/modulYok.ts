/**
 * Yerel modül yokken (iOS/iPadOS, Expo Go, geliştirme) gösterilen açıklama. iOS'ta yalnız sohbet
 * hedeflenir; cihaz yönetimi (tam yetki, uygulamalar, erişilebilirlik) Android'e özgüdür.
 */
export function modulYokMetni(platform: string): string {
  return platform === "ios"
    ? "iPhone/iPad'de yalnız sohbet: tam yetki, uygulamalar ve erişilebilirlik gibi cihaz yönetimi Android'e özgüdür. " +
        "iOS'ta eşleşme için iOS kimlik modülü henüz yok."
    : "Bu cihazda yerel modül yok (geliştirme ya da Expo Go). Kurulum adımları çalışmaz.";
}
