//! Veri modeli: sözleşmedeki kayıt, işlem, `/ajanda` çerçeveleri ve ilgili tiplerin Rust karşılığı,
//! JSON çözme/kodlama ve şema doğrulaması (zod şemalarının birebir anlamı). Köprüden ve depodan
//! habersizdir; yalnız `serde_json::Value` konuşur. Bazı tipler `uniffi::Record`/`Enum` türetir:
//! Kotlin arayüzü kaydı aynı tiple görür (ayrı kopya tip yok).
//!
//! Başvuru: `apps/phone/protocol/src/ajanda.ts`, `ajanda-alan.ts`, `ajanda-zaman.ts`, `sinirlar.ts`,
//! `kanonik.ts`, `cozumle.ts`. Vektörler: `cekirdek/tests/vektorler.rs`.
//!
//! Sürümler (`surum`): her sürüm kendi içinde katıdır; çözme ve yazma bağlantı sürümünü değişken olarak
//! alır (`oku_surum`/`json_surum`, çerçevelerde `oku(v, surum)`). Gövde tiplerinin sürümsüz `oku`/`json`'ı
//! en yeni sürümdür (depo, kuyruk); çerçevelerin sürümsüz çözücüsü ve yazıcısı yoktur: kanal bağlantının
//! sürümünü durumunda tutar (`motor/kanal.rs`).

pub mod json;

pub mod alan;
pub mod cerceve;
pub mod eslesme;
pub mod islem;
pub mod kanonik;
pub mod kayit;
pub mod metin;
pub mod sinirlar;
pub mod surum;
pub mod takvim;
pub mod tekrar;
pub mod zaman;

pub use alan::{
    AjandaBaglanti, AjandaBolgeKonumu, AjandaEkRetKodu, AjandaEki, AjandaVaris, AjandaVarisPenceresi, V3Alanlari,
    V3Degisikligi, ajanda_bolge_anahtari, ajanda_bolge_yeri_degisir_mi, ajanda_url_alan_adi, ajanda_url_gecerli_mi,
    ajanda_yetenek_kesisimi,
};
pub use cerceve::{
    AjandaAsagi, AjandaRevIzi, AjandaYukari, CozumHatasi, CozumKodu, ajanda_asagi_coz_surum, ajanda_asagi_surume,
    ajanda_yukari_coz_surum,
};
pub use eslesme::{AjandaEslestirmeQr, ImzaRolu, ajanda_kimlik_imza_metni, kanal_kapsamda_mi};
pub use islem::{
    AjandaDegisiklik, AjandaGecmisGirdisi, AjandaIslem, AjandaKanalHatasi, AjandaParca, AjandaRetNedeni,
    AlanDegisikligi, IslemTuru, KayitGovdesi, KuyrukRetNedeni, SurumBolumu,
};
pub use json::{Alan, SemaHatasi};
pub use surum::{
    AJANDA_QR_SURUMU, AJANDA_SURUMLERI, AJANDA_SURUMU, DonmusHata, GeriDusus, Surum, ajanda_donmus_hata_oku,
    ajanda_geri_dusus, ajanda_ret_surumu_oku,
};
pub use kayit::{
    AjandaAlani, AjandaKaydi, AjandaKaynagi, AjandaOrnegi, AjandaYazar, GirdiYolu, KaynakYolu, KayitDurumu, KayitTuru,
    OrnekDurumu, TurKokeni, YazarKimligi, hatirlatma_etkin_mi, kullanici_emri_mi, otomasyon_mu,
};
pub use tekrar::{HaftaGunu, Tekrar, TekrarSikligi, ornek_gunleri_mi, ornek_gunu_mu, tekrar_ornekleri};
pub use zaman::{
    AjandaZamani, GUN_HATIRLATMA_VARSAYILAN_SAATI, GunBolumu, Hatirlatma, ZamanKesinligi, gun_hatirlatma_saati, varsayilan_hatirlatmalar,
    zaman_kurallari,
};

/// Yerel an: tarih, duvar saati, IANA dilimi (`AjandaYerelAn`, `YerelAn`).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct YerelAn {
    pub tarih: String,
    pub saat: String,
    pub saat_dilimi: String,
}
