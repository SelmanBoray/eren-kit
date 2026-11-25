//! SAHİBİ: R2. Uygulamanın `/ajanda` eşitlemesi (`ajanda-kural.ts` `ajandaEsitlemeAdimi`,
//! `ajandaHelloAlanlari`). Bellek içi başvuru modelidir: motor (R4) aynı anlamı SQLite'ta uygular ve
//! kendi testinde aynı vektörlerle sınar. Vektör: `esitleme`.

use super::yazilmadi;
use crate::model::{AjandaKaydi, AjandaRevIzi};
use std::collections::BTreeMap;

/// Eşitlemenin baktığı alanlar.
pub trait KopyaKaydi: Clone {
    fn kayit_id(&self) -> &str;
    fn revizyon(&self) -> i64;
    fn guncelleme_ms(&self) -> i64;
}

impl KopyaKaydi for AjandaKaydi {
    fn kayit_id(&self) -> &str {
        &self.kayit_id
    }
    fn revizyon(&self) -> i64 {
        self.revizyon
    }
    fn guncelleme_ms(&self) -> i64 {
        self.guncelleme_ms
    }
}

/// Yalnız izi taşıyan kayıt (vektörler ve hafif testler).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KayitIzi {
    pub kayit_id: String,
    pub revizyon: i64,
    pub guncelleme_ms: i64,
}

impl KopyaKaydi for KayitIzi {
    fn kayit_id(&self) -> &str {
        &self.kayit_id
    }
    fn revizyon(&self) -> i64 {
        self.revizyon
    }
    fn guncelleme_ms(&self) -> i64 {
        self.guncelleme_ms
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TamTelafi<K> {
    pub depo_id: String,
    pub son_rev: i64,
    pub kayitlar: BTreeMap<String, K>,
}

/// Sunucu kopyası: `kayitlar` görünen ve alarmları kurulan kopya; `tam` süren tam telafinin topladıkları.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AjandaKopya<K> {
    pub depo_id: Option<String>,
    pub son_rev: i64,
    pub kayitlar: BTreeMap<String, K>,
    pub tam: Option<TamTelafi<K>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EsitlemeOlayi<K> {
    Welcome { depo_id: String, tam: bool },
    Kayit(K),
    Esitlendi,
    Kopma,
}

/// Bir adım (girdi değişmez, yeni kopya döner). `kayit` yalnız revizyonu yereldekinden büyükse
/// uygulanır, `son_rev` her çerçevede ilerler; tam telafide görünen kopya `esitlendi`'ye kadar değişmez.
pub fn ajanda_esitleme_adimi<K: KopyaKaydi>(d: &AjandaKopya<K>, o: EsitlemeOlayi<K>) -> AjandaKopya<K> {
    let _ = (d, o);
    yazilmadi!("kural::esitleme::ajanda_esitleme_adimi (R2)")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HelloAlanlari {
    pub son_rev: i64,
    pub depo_id: Option<String>,
    pub son_rev_izi: Option<AjandaRevIzi>,
}

/// Yalnız görünen kopyadan: `son_rev`, varsa `depo_id`, `son_rev` > 0 iken revizyonu `son_rev` olan
/// kaydın izi.
pub fn ajanda_hello_alanlari<K: KopyaKaydi>(d: &AjandaKopya<K>) -> HelloAlanlari {
    let _ = d;
    yazilmadi!("kural::esitleme::ajanda_hello_alanlari (R2)")
}
