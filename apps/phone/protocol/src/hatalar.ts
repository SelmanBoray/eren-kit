import { z } from "zod";

/**
 * Bütün protokolün kapalı hata kodu listesi. Yeni kod sürüm artışı gerektirir; tek istisna yalnız
 * yetenek jetonunu isteyen bağlantıya giden kodlardır (`MEDYA_HATA_KODLARI`, README "Sürümleme").
 * Telefon kapısının reddi ayrı listededir: `DENIED_NEDENLERI`.
 */
export const HATA_KODLARI = [
  // Genel
  "protokol_uyumsuz",
  "gecersiz_mesaj",
  "mesaj_cok_buyuk",
  "zaman_asimi",
  "ic_hata",
  // Kimlik ve eşleştirme
  "yetkisiz",
  "imza_gecersiz",
  "ip_uyusmuyor",
  "cihaz_bilinmiyor",
  "kanal_desteklenmiyor",
  "eslestirme_kapali",
  "eslestirme_kodu_gecersiz",
  // Telefon komutu: kopuksa ve sonucu bilinmeyen
  "telefon_bagli_degil",
  "belirsiz",
  // Plan
  "plan_gecersiz",
  "plan_bulunamadi",
  "plan_hash_uyusmuyor",
  "plan_zaten_sonuclandi",
  "izin_bekleniyor",
  // İş ve rapor
  "is_bulunamadi",
  "is_zaten_bitti",
  "rapor_yok",
  "rapor_zaten_verildi",
  // Soru
  "soru_bulunamadi",
  "soru_zaten_cevaplandi",
  // Sohbet
  "tur_gecersiz",
  "eren_hazir_degil",
  "limit_kilitli",
  // Köprü
  "jeton_gecersiz",
  "rol_fiil_izinsiz",
  "yinelenen_istek",
  // Devir
  "ozet_reddedildi",
  // `/sohbet` (SOHBET_SURUMU): yalnız `/sohbet`'te gider. v2 (dilim 1):
  "sohbet_mesgul",
  // v3 (dilim 2, çoklu sohbet):
  "sohbet_bulunamadi",
  "sohbet_siniri",
  "sohbet_silinemez",
  // Medya eki (yetenek `medya1`, sürüm artmadan): yalnız jetonu isteyen `/sohbet` bağlantısına gider.
  "medya_yok",
  "medya_reddedildi",
  "medya_siniri",
] as const;

export const HataKodu = z.enum(HATA_KODLARI);
export type HataKodu = z.infer<typeof HataKodu>;

/**
 * Yalnız `/sohbet`'e (`SOHBET_SURUMU`) özgü kodlar, `HATA_KODLARI`'nın sonunda. v1 mesajları
 * (`/cihaz`, eşleştirme) bunları taşımaz. `sohbet_mesgul` v2'de, gerisi v3'te geldi.
 */
export const SOHBET_HATA_KODLARI = [
  "sohbet_mesgul",
  "sohbet_bulunamadi",
  "sohbet_siniri",
  "sohbet_silinemez",
] as const;

/**
 * Medya ekine özgü kodlar (yetenek `medya1`), `HATA_KODLARI`'nın en sonunda. Yalnız `medya1` isteyen
 * `/sohbet` bağlantısına gider: `media_state.code` ve `ekler`'li `user_message`'ın `ack.code`'u.
 * Jetonsuz bağlantıya hiç gitmez (eski APK bilinmeyen kodu reddederdi), v1 kümesine de girmez.
 * - `medya_yok`: kayıt yok, bitmemiş, başka cihazın, başka sohbetin, zaten bir mesaja bağlı ya da silinmiş.
 * - `medya_reddedildi`: tür, koklama, çözme, süre ya da boyut denetimi tutmadı; disk yazma hatası da.
 * - `medya_siniri`: cihazın bekleyen kayıt sınırı (`MEDYA_SINIRLARI.BEKLEYEN_YUKLEME`) ya da disk kotası.
 */
export const MEDYA_HATA_KODLARI = ["medya_yok", "medya_reddedildi", "medya_siniri"] as const;

/**
 * v1 mesajlarının kod kümesi: `HATA_KODLARI`'nın v1'deki hali, sırası aynı. Kotlin `HataKodu`
 * (IcSozlesme.kt) bu kümeyi kopyalar; `/cihaz` `error` ve `pair_result` bununla doğrulanır.
 * `/sohbet`'e ve medyaya özgü kodlar düşülür: düşülmeyen yeni kod Kotlin'in v1 kümesine sızar.
 */
export const HataKoduV1 = HataKodu.exclude([...SOHBET_HATA_KODLARI, ...MEDYA_HATA_KODLARI]);
export type HataKoduV1 = z.infer<typeof HataKoduV1>;
