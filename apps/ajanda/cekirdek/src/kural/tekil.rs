//! SAHİBİ: R2. Tekilleştirme (`ajanda.ts` `ajandaTekilAnahtari`, `ajandaEsDegisikligi`;
//! `ajanda-kural.ts` `ajandaTekilKarari`). Servisin işidir; uygulama yalnız vektör eşliği için taşır.
//! Kanonik JSON ve SHA-256: `model::kanonik`. Zaman çekirdeği: `AjandaZamani::cekirdek_json`.
//! Vektörler: `tekil_anahtar`, `es_degisikligi`, `tekil_karar`.

use super::yazilmadi;
use crate::model::{AjandaZamani, AlanDegisikligi, Hatirlatma, KayitDurumu, KayitTuru, YazarKimligi};

/// `"t1:" + sha256(kanonik JSON {kapsam, tur, baslik, zaman: çekirdek | null})`.
pub fn ajanda_tekil_anahtari(kapsam: &str, tur: KayitTuru, baslik: &str, zaman: Option<&AjandaZamani>) -> String {
    let _ = (kapsam, tur, baslik, zaman);
    yazilmadi!("kural::tekil::ajanda_tekil_anahtari (R2)")
}

/// Emirde açık eşe yansıyan alanlar: verilmişse `aciklama`, `hatirlatmalar`; eş `an` ve girdi `an`
/// ise ve `sure_dk` farklıysa eşin zamanı yeni süreyle (eşin `ifade`'si korunur).
pub fn ajanda_es_degisikligi(
    es_zaman: Option<&AjandaZamani>,
    aciklama: Option<&str>,
    zaman: Option<&AjandaZamani>,
    hatirlatmalar: Option<&[Hatirlatma]>,
) -> AlanDegisikligi {
    let _ = (es_zaman, aciklama, zaman, hatirlatmalar);
    yazilmadi!("kural::tekil::ajanda_es_degisikligi (R2)")
}

/// Eşin karara giren durumu.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EsDurumu {
    pub silindi: bool,
    pub durum: KayitDurumu,
    pub taslak: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TekilKarari {
    Ekle,
    ZatenVar { sira: usize },
    Onayla { sira: usize },
}

/// `esler` oluşturma sırasıyla. Emirde yalnız açık eş engeller (taslaksa `Onayla`); emir olmayan
/// otomasyonda her eş engeller (açık yoksa `sira` 0).
pub fn ajanda_tekil_karari(esler: &[EsDurumu], yazar: YazarKimligi) -> TekilKarari {
    let _ = (esler, yazar);
    yazilmadi!("kural::tekil::ajanda_tekil_karari (R2)")
}
