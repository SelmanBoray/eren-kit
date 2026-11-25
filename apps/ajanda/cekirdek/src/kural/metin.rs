//! SAHİBİ: R1 (metin ve zaman kuralları). Uygulamanın giriş temizliği ve form hazırlığı.
//! Başvuru: `ajanda-zaman.ts` `ajandaMetniTemizle`; `docs/AJANDA.md` "Uygulama" → "Metin girişi".
//! Vektör: `ajanda-kurallar.json` `gorunmez.metinler[].temiz`.

use super::yazilmadi;
use crate::model::KayitGovdesi;

/// Formdaki bir alanın neden kabul edilmediği. `alan`: `baslik`, `aciklama`, `zaman.ifade` gibi yol.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GirdiSorunu {
    pub alan: String,
    pub neden: String,
}

/// `ajandaMetniTemizle`: `ajanda_gorunmez_var_mi`'nin kabul etmediği her kod noktasını atar, bağlamındaki
/// emoji birleştiricilerini korur. Çıktıda `ajanda_gorunmez_var_mi` yanlıştır; geçerli metinde kimliktir.
/// Satır sonu, sekme ve kenar boşluğu bu işin dışındadır.
pub fn ajanda_metni_temizle(metin: &str) -> String {
    let _ = metin;
    yazilmadi!("kural::metin::ajanda_metni_temizle (R1)")
}

/// Elle ekleme/düzenleme formunun gövdesini kabloya hazırlar: her metin alanına `ajanda_metni_temizle`,
/// sonra alanın kuralı (tek satırlık alanda kenar boşluğu kırpılır; satır sonu/sekme kararı R1'in,
/// MIMARI.md'ye yazılır). Sonuç `KayitGovdesi::dogrula`'dan geçmeli; geçmiyorsa ilk sorun döner.
/// Motor (`ekle`, `duzenle`) kuyruğa koymadan önce bunu çağırır.
pub fn govdeyi_hazirla(govde: KayitGovdesi) -> Result<KayitGovdesi, GirdiSorunu> {
    let _ = govde;
    yazilmadi!("kural::metin::govdeyi_hazirla (R1)")
}
