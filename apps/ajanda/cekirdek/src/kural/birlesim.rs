//! SAHİBİ: R2 (birleştirme, tekilleştirme, kuyruk, eşitleme kuralları). Alan düzeyinde birleştirme
//! (`ajanda.ts` `ajandaDegisikligiUygula`, `ornekleriBuda`). Motorun iyimser uygulaması ve kuyruğun
//! taze kopya üstüne yeniden uygulanması bunu kullanır.
//! Vektör: `ajanda-kurallar.json` `birlestirme`.

use super::yazilmadi;
use crate::model::{AjandaAlani, AjandaKaydi, AjandaOrnegi, AlanDegisikligi, YazarKimligi};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AjandaBirlesimi {
    /// Yeni hal; `revizyon`, `guncelleme_ms` çağıranındır. Şemadan geçirilmemiştir (`gecerli_mi`).
    pub kayit: AjandaKaydi,
    /// Kanonik sırada.
    pub uygulanan: Vec<AjandaAlani>,
    pub korunan: Vec<AjandaAlani>,
    /// Tekrar kalktığı, çapa ya da kural değiştiği için atılan örnek satırları.
    pub budanan_ornekler: Vec<AjandaOrnegi>,
}

/// Değeri aynı olan alan atlanır (kanonik JSON eşitliği; `Kaldir` yokken aynıdır). Emir olmayan
/// değişiklikte (`kullanici_emri_mi` yanlış) `elle_alanlar`'daki alan değişmez, `korunan`'a girer.
/// Emirde her alan uygulanır ve `elle_alanlar`'a eklenir. `tekrar` ya da `zaman` uygulanınca seriye
/// ait olmayan örnek satırları budanır. Hatırlatma listesine dokunulmaz.
pub fn ajanda_degisikligi_uygula(
    kayit: &AjandaKaydi,
    degisiklik: &AlanDegisikligi,
    yazar: YazarKimligi,
) -> AjandaBirlesimi {
    let _ = (kayit, degisiklik, yazar);
    yazilmadi!("kural::birlesim::ajanda_degisikligi_uygula (R2)")
}
