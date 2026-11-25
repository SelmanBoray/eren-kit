//! SAHİBİ: R1. Tekrar eden kaydın tek örneğinin durumu (`ajanda-kural.ts` `ajandaOrnekDurumuUygula`):
//! `durum` işleminin `ornek_tarihi`'li hali; motorun iyimser uygulaması bunu kullanır.
//! Vektör: `ajanda-kurallar.json` `ornek_durumu`.

use super::yazilmadi;
use crate::model::{AjandaKaydi, AjandaOrnegi, KayitDurumu};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OrnekDurumuSonucu {
    /// `ornekler`: yeni tam liste (tarih sırasıyla). `atilan`: `ORNEK_ADET` için atılan eski satırlar.
    Tamam { ornekler: Vec<AjandaOrnegi>, degisti: bool, atilan: Vec<AjandaOrnegi> },
    /// `ornek_gecersiz`.
    Gecersiz,
}

/// Tekrarsız kayıtta ya da serinin günü olmayan tarihte `Gecersiz`. `Acik` satırı kaldırır;
/// `Tamam`/`Iptal` ekler ya da değiştirir. `ORNEK_ADET` aşılırsa `bugun`'den (kaydın dilimindeki yerel
/// gün) önceki en eski satırlar atılır (az önce değişen hariç); yine aşılıyorsa `Gecersiz`.
pub fn ajanda_ornek_durumu_uygula(
    kayit: &AjandaKaydi,
    ornek_tarihi: &str,
    durum: KayitDurumu,
    bugun: &str,
) -> OrnekDurumuSonucu {
    let _ = (kayit, ornek_tarihi, durum, bugun);
    yazilmadi!("kural::ornek::ajanda_ornek_durumu_uygula (R1)")
}
