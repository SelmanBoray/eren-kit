/**
 * Kablo sözleşmesinin temel sürümü: `/cihaz`, köprü borusu, QR, eşleştirme (`pair_request`,
 * `pair_result`) ve kimlik imza metni (`eren-auth-v1`) bunu taşır. Kotlin tarafı bu değeri ve
 * aşağıdaki `SINIRLAR` bloğunu birebir kopyalar (`Sinirlar.kt`, `SozlesmeTest.kt`): değişmez.
 */
export const PROTOKOL_SURUMU = 1 as const;

/**
 * `/sohbet` kanalının sürümü: eşleştirme dışındaki bütün `/sohbet` mesajları bunu taşır.
 * Hangi türün hangi sürümde olduğu `sohbetSurumu` (sohbet.ts) ve README "Sürümleme"dedir.
 * 2: dilim 1 (geçmişi sil, servis bilgisi). 3: dilim 2 (çoklu sohbet, `sohbet_id`). 4: dilim 3 (kısayol: `input:"kisayol"`, `baglam`).
 * 5: plandan `kesin_yapilacaklar` ve `kesin_yapilmayacaklar` kalktı (`plan_proposed`, `plan_hash`).
 * `kurulum/kur.ts` bu satırı metin olarak okur: satır başında `export const SOHBET_SURUMU = <n>` kalmalı.
 */
export const SOHBET_SURUMU = 5 as const;

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

/**
 * Yalnız `/sohbet` (`SOHBET_SURUMU`) alanlarının sınırları. `SINIRLAR`'a eklenmez: Kotlin o bloğun
 * anahtar kümesini birebir sınar, bu sınırlar Kotlin'e hiç ulaşmaz.
 */
export const SOHBET_SINIRLARI = {
  /** `server_status.servis.surum`: `surum.json` `sha`'sı, kurulumdaki sürüm adı deseniyle aynı. */
  SERVIS_SURUMU: 64,
  /** Sohbet adı (v3): tek satır, UTF-16 birimi. Telefonun ad girdisi `maxLength` ile aynı. */
  SOHBET_ADI: 60,
  /** Silinmemiş sohbet üst sınırı (v3), `ana` dahil. `server_status.sohbetler` en çok bu kadar öğe. */
  SOHBET_ADET: 8,
  /** Kısayol bağlamının uygulama adı (v4): 1-80 UTF-16 birimi, kontrol karakteri yok. */
  BAGLAM_ADI: 80,
  /** `usage_report.isler` en çok bu kadar öğe (en yeni işler). */
  TUKETIM_IS_ADET: 50,
} as const;

/** Tek bir kablo çerçevesinin ayrıştırma öncesi üst sınırı. */
export const AZAMI_CERCEVE = {
  SOHBET: 2 * 1024 * 1024,
  CIHAZ: 10 * 1024 * 1024,
  KOPRU: 12 * 1024 * 1024,
} as const;

/**
 * `/ajanda` kanalının sürümü (ajanda uygulaması, eşleştirmesi ve QR'ı dahil). Öteki iki sabitten
 * bağımsızdır: `/sohbet`, `/cihaz`, boru ve `eren-auth-v1` baytları bundan etkilenmez; ajanda imza
 * metninin öneki de (`eren-ajanda-auth-v1`) bu sayıdan türemez. Kural README "Sürümleme" ile aynıdır:
 * mesaj, alan, kapalı liste öğesi eklemek ya da sınır değiştirmek artıştır.
 * 1: ilk dilim. 2: saatsiz gün kaydında gün hatırlatması ve `gun_bolumu`, `gece_teyidi_gerekli`
 * (`docs/AJANDA.md` "Sürüm 2").
 */
export const AJANDA_SURUMU = 2 as const;

/**
 * Yalnız ajanda alanlarının sınırları (`docs/AJANDA.md`). `SINIRLAR`'a eklenmez (Kotlin o bloğun
 * anahtar kümesini sınar). Karakter sınırları UTF-16 birimi, adet sınırları öğe sayısıdır.
 */
export const AJANDA_SINIRLARI = {
  /** Başlık: tek satır. */
  BASLIK: 200,
  /** Açıklama: çok satırlı. */
  ACIKLAMA: 4_000,
  /** Kullanıcının zaman ifadesi, birebir ("yarın 3'te"). */
  ZAMAN_IFADESI: 120,
  /** Kaynak izindeki kısa alıntı: tek satır. */
  ALINTI: 280,
  /** IANA saat dilimi adı. */
  SAAT_DILIMI: 64,
  TEKIL_ANAHTAR: 128,
  HATIRLATMA_ADET: 8,
  /** `once` hatırlatmasının en uzak öne alınışı: 28 gün, dakika. */
  HATIRLATMA_ONCE_DK: 40_320,
  /** Randevu süresi üst sınırı: 7 gün, dakika. */
  SURE_DK: 10_080,
  /** `donem` zamanının en uzun hali, iki uç dahil gün. */
  DONEM_GUN: 366,
  TEKRAR_ARALIK: 99,
  TEKRAR_ADET: 999,
  /** Tekrar eden kaydın örnek başına durum satırı üst sınırı. */
  ORNEK_ADET: 500,
  YIL_MIN: 1900,
  YIL_MAX: 2199,
  /** Silinmiş (mezar taşı) dahil kayıt üst sınırı: servis yeni eklemeyi `kayit_siniri` ile reddeder. */
  KAYIT_ADET: 50_000,
  /** `ajanda_listele` en çok bu kadar kayıt döner; `en_fazla` verilmezse `LISTE_VARSAYILAN`. */
  LISTE_ADET: 50,
  LISTE_VARSAYILAN: 20,
  /** `ajanda_listele.ara`. */
  ARAMA: 100,
  /** `gecmis` çerçevesinin sayfa boyu. */
  GECMIS_SAYFA: 20,
  /** Modele giden liste metninde açıklamanın kırpıldığı uzunluk (kablo sınırı `ACIKLAMA`). */
  MODEL_ACIKLAMA: 300,
  /** Araç `dayanak`'ının turun mesaj anından (aynı yerel gün içinde) sapabileceği dakika. */
  DAYANAK_SAPMA_DK: 10,
  /**
   * Uygulama kuyruğundaki bir işlemin sonuçsuz deneme sınırı (geçici ret ya da sonucu gelmeden
   * kopma): sınıra varan işlem ret listesine geçer, arkasındakiler gider (`ajandaKuyrukKarari`).
   */
  ISLEM_DENEME: 5,
  /**
   * Kurulmuş ama teslim edilmemiş hatırlatmanın kaçırılan olarak gösterildiği geçmiş, dakika
   * (`kacirilanHatirlatmalar`); daha eskisi sessizce düşer.
   */
  KACIRILAN_PENCERE_DK: 360,
  /**
   * Gece aralığı (v2): mesaj anının yerel saati 00:00 ile bu kadar dakika sonrası (dahil değil, 04:00)
   * arasındaysa insan turundaki takvime bağlı araç çağrısı `dayanak.gece_teyidi` ister
   * (`geceTeyidiEksikMi`, `gece_teyidi_gerekli`).
   */
  GECE_ARALIGI_DK: 240,
} as const;

/** `/ajanda` çerçevesinin ve ajanda borusunun ayrıştırma öncesi üst sınırı (UTF-16 birimi). */
export const AJANDA_AZAMI_CERCEVE = {
  KANAL: 2 * 1024 * 1024,
  BORU: 4 * 1024 * 1024,
} as const;
