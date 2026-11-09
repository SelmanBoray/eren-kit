/** Kablo sözleşmesinin sürümü. Her mesajın `v` alanı tam olarak bu değerdir. */
export const PROTOKOL_SURUMU = 1 as const;

/** Karakter sınırları UTF-16 birimi, adet sınırları öğe sayısıdır. */
export const SINIRLAR = {
  OPAK_ID: 64,
  JETON_MIN: 32,
  JETON_MAX: 128,
  NONCE_MIN: 24,
  NONCE_MAX: 88,
  ACIK_ANAHTAR_MAX: 256,
  IMZA_MAX: 256,
  ESLESTIRME_KODU_MIN: 6,
  ESLESTIRME_KODU_MAX: 32,
  CIHAZ_ETIKETI: 64,
  HATA_DETAYI: 500,
  YOL_SAYISI: 8,
  YOL_UZUNLUGU: 128,

  KULLANICI_METNI: 32_000,
  ASISTAN_METNI: 256_000,
  DELTA_METNI: 16_000,
  SISTEM_NOTU: 1_000,

  PLAN_BASLIK: 120,
  PLAN_CWD: 1_024,
  /** Windows komut satırı sınırı olan 32.767 karakterin altında kalır. */
  GOREV_METNI: 20_000,
  PLAN_MADDE: 500,
  PLAN_MADDE_ADET: 64,
  PLAN_UYGULAMA_ADET: 16,
  IZINLI_METIN: 4_000,
  IZINLI_METIN_ADET: 16,
  KIRLI_KAYNAK_ADET: 32,

  RAPOR_MADDE: 1_000,
  RAPOR_MADDE_ADET: 64,
  RAPOR_DOSYA_YOLU: 512,
  RAPOR_DOSYA_ADET: 256,
  RAPOR_GOVDE: 64_000,

  SORU_METNI: 4_000,
  SECENEK_METNI: 200,
  SECENEK_ADET: 8,
  CEVAP_METNI: 8_000,

  PAKET_ADI: 255,
  UYGULAMA_ADI: 120,
  UYGULAMA_LISTESI_ADET: 2_000,
  ELEMENT_ROL: 64,
  ELEMENT_METIN: 2_000,
  /** Modele giden element satırında `ad` ve `deger` için kırpma sınırı (kablo sınırı ELEMENT_METIN). */
  ELEMENT_SATIR_METIN: 500,
  ELEMENT_ADET: 500,
  ELEMENT_SORGU: 200,
  ON_PLAN_BASLIK: 256,
  YAZILAN_METIN: 4_000,
  KOORDINAT_MAX: 20_000,
  TEKRAR_MAX: 10,
  KAYDIRMA_MAX: 20,
  BEKLEME_SANIYE_MAX: 30,
  EKRAN_BASE64: 8 * 1024 * 1024,
  BILDIRIM_BASLIK: 120,
  BILDIRIM_METIN: 500,

  PROJE_ADI: 120,
  PROJE_NOTU: 500,
  PROJE_ADET: 512,
  OTURUM_ADET: 256,
  DEVIR_OZETI: 32_000,
} as const;

/** Tek bir kablo çerçevesinin ayrıştırma öncesi üst sınırı. */
export const AZAMI_CERCEVE = {
  SOHBET: 2 * 1024 * 1024,
  CIHAZ: 10 * 1024 * 1024,
  KOPRU: 12 * 1024 * 1024,
} as const;
