//! Sözleşmenin sabitleri (`protocol/src/sinirlar.ts`): yalnız ajandanın kullandıkları, birebir.
//! Karakter sınırları UTF-16 birimi, adet sınırları öğe sayısıdır.

// `AJANDA_SURUMU` ve `AJANDA_SURUMLERI` `surum.rs`'tedir (bağlantı sürümü kanalın durumundadır).

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
    /// v2: mesaj anının yerel saati 00:00 ile bu kadar dakika sonrası (dahil değil) arası gece aralığıdır.
    pub const GECE_ARALIGI_DK: i64 = 240;

    // v3 (genişleme kuralı 5: bu sınırlar büyütülmez)

    /// `simge` anahtarı, ASCII.
    pub const SIMGE: usize = 32;
    /// `bolge` adı: tek satır.
    pub const BOLGE: usize = 60;
    /// `bolge_konumu.yaricap_m`, metre, iki uç dahil.
    pub const BOLGE_YARICAP_MIN: i64 = 50;
    pub const BOLGE_YARICAP_MAX: i64 = 1_000;
    pub const KAYIT_BAGLANTI_ADET: usize = 10;
    /// `baglantilar[].url`: yazdırılabilir ASCII (`alan::ajanda_url_gecerli_mi`).
    pub const BAGLANTI_URL: usize = 2_000;
    /// `baglantilar[].baslik`: tek satır.
    pub const BAGLANTI_BASLIK: usize = 120;
    /// Kayıt başına ek üstverisi.
    pub const EK_ADET: usize = 8;
    /// Bir ekin (küçültülmüş dosyanın) bayt üst sınırı: 4 MiB.
    pub const EK_BAYT: i64 = 4 * 1024 * 1024;
    /// `ekler[].genislik`/`yukseklik`, piksel.
    pub const EK_KENAR: i64 = 65_535;
    /// `ekler[].mime`, ASCII.
    pub const EK_MIME: usize = 127;
    /// `ek_parca.veri`'nin ham bayt üst sınırı (256 KiB; base64 hali `alan::ajanda_base64_boyu(EK_PARCA)`).
    pub const EK_PARCA: i64 = 256 * 1024;
    /// İndirmede bir `ek_iste`'ye en çok bu kadar `ek_parca`, sonra `ek_durum`.
    pub const EK_PENCERE: usize = 4;
    /// Servisin bütün eklere ayırdığı varsayılan alan (2 GiB). Kablo sınırı değildir.
    pub const EK_TOPLAM_BAYT: i64 = 2 * 1024 * 1024 * 1024;
    /// Hiçbir silinmemiş kayıtta geçmeyen ekin servisteki dosyasının silindiği gün. Kablo sınırı değildir.
    pub const EK_SAKLAMA_GUN: i64 = 30;
    /// `yetenekler` listesi ve bir yetenek adı.
    pub const YETENEK_ADET: usize = 32;
    pub const YETENEK_ADI: usize = 32;
}
