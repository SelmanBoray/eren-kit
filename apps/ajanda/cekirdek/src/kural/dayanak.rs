//! SAHİBİ: R1. Modelin dayanağı (`ajanda-kural.ts` `dayanakGecerliMi`). Uygulama kullanmaz (araç
//! yolu servistedir) ama sözleşme iki vektör dosyasının da birebir geçmesini ister.
//! Vektör: `ajanda-kurallar.json` `dayanak`.

use super::yazilmadi;
use crate::model::YerelAn;

/// `dayanak.saat_dilimi` verilmişse mesaj anınınkiyle aynı, `tarih` mesaj anının yerel günüyle aynı ve
/// saat farkı en çok `DAYANAK_SAPMA_DK` dakika.
pub fn dayanak_gecerli_mi(tarih: &str, saat: &str, saat_dilimi: Option<&str>, mesaj_ani: &YerelAn) -> bool {
    let _ = (tarih, saat, saat_dilimi, mesaj_ani);
    yazilmadi!("kural::dayanak::dayanak_gecerli_mi (R1)")
}
