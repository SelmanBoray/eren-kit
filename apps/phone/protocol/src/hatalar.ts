import { z } from "zod";

/**
 * Bütün protokolün kapalı hata kodu listesi. Yeni kod sürüm artışı gerektirir.
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
] as const;

export const HataKodu = z.enum(HATA_KODLARI);
export type HataKodu = z.infer<typeof HataKodu>;
