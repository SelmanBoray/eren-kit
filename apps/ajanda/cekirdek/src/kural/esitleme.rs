//! SAHİBİ: R2. Uygulamanın `/ajanda` eşitlemesi (`ajanda-kural.ts` `ajandaEsitlemeAdimi`,
//! `ajandaHelloAlanlari`). Bellek içi başvuru modelidir: motor (R4) aynı anlamı SQLite'ta uygular ve
//! kendi testinde aynı vektörlerle sınar. Vektör: `esitleme`.

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

/// `kayit` çerçevesi: yalnız revizyonu yereldekinden büyükse uygulanır; `son_rev` her çerçevede ilerler.
fn kayit_uygula<K: KopyaKaydi>(kayitlar: &mut BTreeMap<String, K>, son_rev: &mut i64, kayit: K) {
    *son_rev = (*son_rev).max(kayit.revizyon());
    if kayitlar.get(kayit.kayit_id()).is_some_and(|eski| eski.revizyon() >= kayit.revizyon()) {
        return;
    }
    kayitlar.insert(kayit.kayit_id().to_string(), kayit);
}

/// Bir adım (girdi değişmez, yeni kopya döner). `kayit` yalnız revizyonu yereldekinden büyükse
/// uygulanır, `son_rev` her çerçevede ilerler; tam telafide görünen kopya `esitlendi`'ye kadar değişmez.
/// - `Welcome` `tam` değil: kopya sürer, `depo_id` gelenle yazılır (süren bir tam telafi varsa atılır).
/// - `Welcome` `tam`: görünen kopya, `son_rev`, `depo_id` olduğu gibi kalır; gelenler `tam`'da toplanır.
/// - `Esitlendi`: toplanan kopyanın yerine geçer (gelmeyen kayıt düşer); tam yoksa değişmez.
/// - `Kopma`: toplananı atar; görünen kopya ve dolayısıyla sonraki `hello` eski haliyle kalır.
pub fn ajanda_esitleme_adimi<K: KopyaKaydi>(d: &AjandaKopya<K>, o: EsitlemeOlayi<K>) -> AjandaKopya<K> {
    match o {
        EsitlemeOlayi::Welcome { depo_id, tam: true } => AjandaKopya {
            tam: Some(TamTelafi { depo_id, son_rev: 0, kayitlar: BTreeMap::new() }),
            ..d.clone()
        },
        EsitlemeOlayi::Welcome { depo_id, tam: false } => {
            AjandaKopya { depo_id: Some(depo_id), son_rev: d.son_rev, kayitlar: d.kayitlar.clone(), tam: None }
        }
        EsitlemeOlayi::Kayit(k) => {
            let mut yeni = d.clone();
            match &mut yeni.tam {
                None => kayit_uygula(&mut yeni.kayitlar, &mut yeni.son_rev, k),
                Some(t) => kayit_uygula(&mut t.kayitlar, &mut t.son_rev, k),
            }
            yeni
        }
        EsitlemeOlayi::Esitlendi => match &d.tam {
            None => d.clone(),
            Some(t) => AjandaKopya { depo_id: Some(t.depo_id.clone()), son_rev: t.son_rev, kayitlar: t.kayitlar.clone(), tam: None },
        },
        EsitlemeOlayi::Kopma => AjandaKopya { tam: None, ..d.clone() },
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HelloAlanlari {
    pub son_rev: i64,
    pub depo_id: Option<String>,
    pub son_rev_izi: Option<AjandaRevIzi>,
}

/// Yalnız görünen kopyadan: `son_rev`, varsa `depo_id`, `son_rev` > 0 iken revizyonu `son_rev` olan
/// kaydın izi. Süren tam telafinin topladığı girmez. Revizyon tek sayaçtan geldiği için en çok bir
/// kayıt tutar (başvuru birden çoksa eklenme sırasıyla sonuncuyu alır; burada anahtar sırasıyla
/// sonuncu: bu ancak bozuk kopyada ayrışır).
pub fn ajanda_hello_alanlari<K: KopyaKaydi>(d: &AjandaKopya<K>) -> HelloAlanlari {
    let son_rev_izi = if d.son_rev > 0 {
        d.kayitlar
            .values()
            .rev()
            .find(|k| k.revizyon() == d.son_rev)
            .map(|k| AjandaRevIzi { kayit_id: k.kayit_id().to_string(), guncelleme_ms: k.guncelleme_ms() })
    } else {
        None
    };
    HelloAlanlari { son_rev: d.son_rev, depo_id: d.depo_id.clone(), son_rev_izi }
}

#[cfg(test)]
mod testler {
    use super::*;
    use crate::kural::telafi::{TelafiGirdisi, ajanda_telafi_tam_mi};

    fn iz(kayit_id: &str, revizyon: i64, guncelleme_ms: i64) -> KayitIzi {
        KayitIzi { kayit_id: kayit_id.into(), revizyon, guncelleme_ms }
    }

    fn kopya(depo_id: &str, son_rev: i64, kayitlar: &[KayitIzi]) -> AjandaKopya<KayitIzi> {
        AjandaKopya {
            depo_id: Some(depo_id.into()),
            son_rev,
            kayitlar: kayitlar.iter().map(|k| (k.kayit_id.clone(), k.clone())).collect(),
            tam: None,
        }
    }

    fn adimlar(mut d: AjandaKopya<KayitIzi>, olaylar: Vec<EsitlemeOlayi<KayitIzi>>) -> AjandaKopya<KayitIzi> {
        for o in olaylar {
            d = ajanda_esitleme_adimi(&d, o);
        }
        d
    }

    #[test]
    fn artimli_eski_revizyonu_uygulamaz_son_rev_ilerler() {
        let d = kopya("d_a", 7, &[iz("k_1", 7, 2000)]);
        let d = adimlar(
            d,
            vec![
                EsitlemeOlayi::Welcome { depo_id: "d_a".into(), tam: false },
                EsitlemeOlayi::Kayit(iz("k_1", 5, 1500)),
                EsitlemeOlayi::Kayit(iz("k_2", 8, 2100)),
                EsitlemeOlayi::Esitlendi,
            ],
        );
        assert_eq!(d.kayitlar["k_1"], iz("k_1", 7, 2000));
        assert_eq!(d.son_rev, 8);
        assert_eq!(ajanda_hello_alanlari(&d).son_rev_izi, Some(AjandaRevIzi { kayit_id: "k_2".into(), guncelleme_ms: 2100 }));
    }

    #[test]
    fn yarida_kesilen_tam_esitleme_gorunen_kopyayi_goturmez() {
        let bas = kopya("d_a", 7, &[iz("k_dis01", 7, 2000)]);
        let hello_once = ajanda_hello_alanlari(&bas);
        let d = adimlar(
            bas.clone(),
            vec![EsitlemeOlayi::Welcome { depo_id: "d_b".into(), tam: true }, EsitlemeOlayi::Kayit(iz("k_baska", 1, 10))],
        );
        // Telafi sürerken görünen kopya ve hello alanları değişmez.
        assert_eq!((&d.depo_id, d.son_rev, &d.kayitlar), (&bas.depo_id, bas.son_rev, &bas.kayitlar));
        assert_eq!(ajanda_hello_alanlari(&d), hello_once);
        assert!(d.tam.is_some());
        let d = ajanda_esitleme_adimi(&d, EsitlemeOlayi::Kopma);
        assert_eq!(d, bas, "kopma toplananı atar, görünen kopya kalır");
        assert_eq!(
            ajanda_hello_alanlari(&d),
            HelloAlanlari {
                son_rev: 7,
                depo_id: Some("d_a".into()),
                son_rev_izi: Some(AjandaRevIzi { kayit_id: "k_dis01".into(), guncelleme_ms: 2000 })
            }
        );
        // Yeniden bağlanınca servis yine tam telafi başlatır ve bu kez tamamlanır: gelmeyen kayıt düşer.
        let d = adimlar(
            d,
            vec![
                EsitlemeOlayi::Welcome { depo_id: "d_b".into(), tam: true },
                EsitlemeOlayi::Kayit(iz("k_baska", 1, 10)),
                EsitlemeOlayi::Kayit(iz("k_yeni", 3, 30)),
                EsitlemeOlayi::Esitlendi,
            ],
        );
        assert_eq!(d, kopya("d_b", 3, &[iz("k_baska", 1, 10), iz("k_yeni", 3, 30)]));
    }

    #[test]
    fn tam_telafide_eski_kopyadan_kucuk_revizyon_da_alinir() {
        // Geri yüklenen depo revizyonları baştan sayar: toplanan kopya eski kopyayla kıyaslanmaz.
        let d = adimlar(
            kopya("d_a", 50, &[iz("k_1", 50, 5000)]),
            vec![
                EsitlemeOlayi::Welcome { depo_id: "d_a".into(), tam: true },
                EsitlemeOlayi::Kayit(iz("k_1", 4, 400)),
                EsitlemeOlayi::Esitlendi,
            ],
        );
        assert_eq!(d, kopya("d_a", 4, &[iz("k_1", 4, 400)]));
    }

    #[test]
    fn geri_yukleme_sonrasi_tam_esitleme_karari() {
        // Telefon d_a'nın 7. revizyonunu görmüş (k_1 @2000). PC aynı depo_id'yle eski yedeğe döndü
        // ve 7. revizyonu bu kez k_2'ye verdi: numaralar tutar ama iz tutmaz, servis tam telafi seçer.
        let telefon = kopya("d_a", 7, &[iz("k_1", 7, 2000), iz("k_0", 3, 900)]);
        let h = ajanda_hello_alanlari(&telefon);
        let karar = |izdeki: Option<(&str, i64)>| {
            ajanda_telafi_tam_mi(&TelafiGirdisi {
                hello_son_rev: h.son_rev,
                hello_depo_id: h.depo_id.clone(),
                hello_son_rev_izi: h.son_rev_izi.clone(),
                depo_id: "d_a".into(),
                bas_rev: 9,
                izdeki: izdeki.map(|(k, t)| (k.to_string(), t)),
            })
        };
        assert!(!karar(Some(("k_1", 2000))), "geri yükleme yoksa artımlı");
        assert!(karar(Some(("k_2", 2600))), "geri yükleme: tam");
        // Tam telafi bittiğinde telefon servisin kopyasına döner; eski k_1 düşer.
        let d = adimlar(
            telefon,
            vec![
                EsitlemeOlayi::Welcome { depo_id: "d_a".into(), tam: true },
                EsitlemeOlayi::Kayit(iz("k_0", 3, 900)),
                EsitlemeOlayi::Kayit(iz("k_2", 7, 2600)),
                EsitlemeOlayi::Kayit(iz("k_3", 9, 2700)),
                EsitlemeOlayi::Esitlendi,
            ],
        );
        assert_eq!(d, kopya("d_a", 9, &[iz("k_0", 3, 900), iz("k_2", 7, 2600), iz("k_3", 9, 2700)]));
    }

    #[test]
    fn artimli_welcome_suren_tam_telafiyi_atar_ve_hello_bos_kopyada_izsiz() {
        let bos: AjandaKopya<KayitIzi> = AjandaKopya { depo_id: None, son_rev: 0, kayitlar: BTreeMap::new(), tam: None };
        assert_eq!(ajanda_hello_alanlari(&bos), HelloAlanlari { son_rev: 0, depo_id: None, son_rev_izi: None });
        let d = adimlar(
            bos,
            vec![
                EsitlemeOlayi::Welcome { depo_id: "d_a".into(), tam: true },
                EsitlemeOlayi::Kayit(iz("k_1", 1, 10)),
                EsitlemeOlayi::Welcome { depo_id: "d_a".into(), tam: false },
            ],
        );
        assert!(d.tam.is_none());
        assert!(d.kayitlar.is_empty());
        assert_eq!(d.depo_id.as_deref(), Some("d_a"));
        // Esitlendi tam yokken kopyayı değiştirmez.
        assert_eq!(ajanda_esitleme_adimi(&d, EsitlemeOlayi::Esitlendi), d);
    }
}
