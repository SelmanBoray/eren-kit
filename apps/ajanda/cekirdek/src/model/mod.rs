//! Veri modeli: sözleşmedeki kayıt, işlem, `/ajanda` çerçeveleri ve ilgili tiplerin Rust karşılığı,
//! JSON çözme/kodlama ve şema doğrulaması (zod şemalarının birebir anlamı). Köprüden ve depodan
//! habersizdir; yalnız `serde_json::Value` konuşur. Bazı tipler `uniffi::Record`/`Enum` türetir:
//! Kotlin arayüzü kaydı aynı tiple görür (ayrı kopya tip yok).
//!
//! Başvuru: `apps/phone/protocol/src/ajanda.ts`, `ajanda-zaman.ts`, `sinirlar.ts`, `kanonik.ts`,
//! `cozumle.ts`. Vektörler: `cekirdek/tests/vektorler.rs`.

pub mod json;

pub mod cerceve;
pub mod eslesme;
pub mod islem;
pub mod kanonik;
pub mod kayit;
pub mod metin;
pub mod sinirlar;
pub mod takvim;
pub mod tekrar;
pub mod zaman;

pub use cerceve::{AjandaAsagi, AjandaRevIzi, AjandaYukari, CozumHatasi, CozumKodu, ajanda_asagi_coz, ajanda_yukari_coz};
pub use eslesme::{AjandaEslestirmeQr, ImzaRolu, ajanda_kimlik_imza_metni, kanal_kapsamda_mi};
pub use islem::{
    AjandaDegisiklik, AjandaGecmisGirdisi, AjandaIslem, AjandaKanalHatasi, AjandaParca, AjandaRetNedeni,
    AlanDegisikligi, IslemTuru, KayitGovdesi, KuyrukRetNedeni,
};
pub use json::{Alan, SemaHatasi};
pub use kayit::{
    AjandaAlani, AjandaKaydi, AjandaKaynagi, AjandaOrnegi, AjandaYazar, GirdiYolu, KaynakYolu, KayitDurumu, KayitTuru,
    OrnekDurumu, TurKokeni, YazarKimligi, hatirlatma_etkin_mi, kullanici_emri_mi, otomasyon_mu,
};
pub use tekrar::{HaftaGunu, Tekrar, TekrarSikligi, ornek_gunleri_mi, ornek_gunu_mu, tekrar_ornekleri};
pub use zaman::{AjandaZamani, Hatirlatma, ZamanKesinligi, varsayilan_hatirlatmalar, zaman_kurallari};

/// Yerel an: tarih, duvar saati, IANA dilimi (`AjandaYerelAn`, `YerelAn`).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct YerelAn {
    pub tarih: String,
    pub saat: String,
    pub saat_dilimi: String,
}
