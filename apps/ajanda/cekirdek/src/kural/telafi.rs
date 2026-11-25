//! SAHİBİ: R2. Telafi kipi (`ajanda-kural.ts` `ajandaTelafiTamMi`). Servisin kararıdır (`welcome.tam`);
//! uygulama yalnız vektör eşliği için taşır. Vektör: `telafi`.

use super::yazilmadi;
use crate::model::AjandaRevIzi;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TelafiGirdisi {
    pub hello_son_rev: i64,
    pub hello_depo_id: Option<String>,
    pub hello_son_rev_izi: Option<AjandaRevIzi>,
    pub depo_id: String,
    pub bas_rev: i64,
    /// Servis geçmişinde `rev` = `hello_son_rev` satırının kaydı ve `ts_ms`'i.
    pub izdeki: Option<(String, i64)>,
}

/// `depo_id` yok ya da farklı; `son_rev > bas_rev`; `son_rev` > 0 iken iz yok ya da tutmuyor -> tam.
pub fn ajanda_telafi_tam_mi(g: &TelafiGirdisi) -> bool {
    let _ = g;
    yazilmadi!("kural::telafi::ajanda_telafi_tam_mi (R2)")
}
