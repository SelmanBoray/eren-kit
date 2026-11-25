//! Sözleşmenin sabitleri (`protocol/src/sinirlar.ts`): yalnız ajandanın kullandıkları, birebir.
//! Karakter sınırları UTF-16 birimi, adet sınırları öğe sayısıdır.

/// `/ajanda` kanalının sürümü (`AJANDA_SURUMU`).
pub const AJANDA_SURUMU: i64 = 1;

/// `/ajanda` çerçevesinin ayrıştırma öncesi üst sınırı (UTF-16 birimi): `AJANDA_AZAMI_CERCEVE.KANAL`.
pub const AZAMI_CERCEVE_KANAL: usize = 2 * 1024 * 1024;

/// `SINIRLAR`'ın ajandada kullanılan alt kümesi.
pub mod genel {
    pub const OPAK_ID: usize = 64;
    pub const NONCE_MIN: usize = 24;
    pub const NONCE_MAX: usize = 88;
    pub const ACIK_ANAHTAR_MAX: usize = 256;
    pub const IMZA_MAX: usize = 256;
    pub const ESLESTIRME_KODU_MIN: usize = 6;
    pub const ESLESTIRME_KODU_MAX: usize = 32;
    pub const CIHAZ_ETIKETI: usize = 64;
    pub const HATA_DETAYI: usize = 500;
    pub const YOL_SAYISI: usize = 8;
    pub const YOL_UZUNLUGU: usize = 128;
}

/// `AJANDA_SINIRLARI`, birebir.
pub mod ajanda {
    pub const BASLIK: usize = 200;
    pub const ACIKLAMA: usize = 4_000;
    pub const ZAMAN_IFADESI: usize = 120;
    pub const ALINTI: usize = 280;
    pub const SAAT_DILIMI: usize = 64;
    pub const TEKIL_ANAHTAR: usize = 128;
    pub const HATIRLATMA_ADET: usize = 8;
    pub const HATIRLATMA_ONCE_DK: i64 = 40_320;
    pub const SURE_DK: i64 = 10_080;
    pub const DONEM_GUN: i64 = 366;
    pub const TEKRAR_ARALIK: i64 = 99;
    pub const TEKRAR_ADET: i64 = 999;
    pub const ORNEK_ADET: usize = 500;
    pub const YIL_MIN: i64 = 1900;
    pub const YIL_MAX: i64 = 2199;
    pub const KAYIT_ADET: usize = 50_000;
    pub const GECMIS_SAYFA: usize = 20;
    pub const DAYANAK_SAPMA_DK: i64 = 10;
    pub const ISLEM_DENEME: u32 = 5;
    pub const KACIRILAN_PENCERE_DK: i64 = 360;
}
