//! SAHİBİ: R2. Telafi kipi (`ajanda-kural.ts` `ajandaTelafiTamMi`). Servisin kararıdır (`welcome.tam`);
//! uygulama yalnız vektör eşliği için taşır. Vektör: `telafi`.

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
/// Son koşul, aynı `depo_id`'yle yedekten geri yüklenip revizyon numaraları yeniden kullanılınca
/// ayrışmayı yakalar.
pub fn ajanda_telafi_tam_mi(g: &TelafiGirdisi) -> bool {
    if g.hello_depo_id.as_deref() != Some(g.depo_id.as_str()) {
        return true;
    }
    if g.hello_son_rev > g.bas_rev {
        return true;
    }
    if g.hello_son_rev == 0 {
        return false;
    }
    match (&g.hello_son_rev_izi, &g.izdeki) {
        (Some(iz), Some((kayit_id, ts_ms))) => iz.kayit_id != *kayit_id || iz.guncelleme_ms != *ts_ms,
        _ => true,
    }
}

#[cfg(test)]
mod testler {
    use super::*;

    fn iz(kayit_id: &str, guncelleme_ms: i64) -> Option<AjandaRevIzi> {
        Some(AjandaRevIzi { kayit_id: kayit_id.into(), guncelleme_ms })
    }

    fn girdi() -> TelafiGirdisi {
        TelafiGirdisi {
            hello_son_rev: 7,
            hello_depo_id: Some("d_a".into()),
            hello_son_rev_izi: iz("k_1", 2000),
            depo_id: "d_a".into(),
            bas_rev: 9,
            izdeki: Some(("k_1".into(), 2000)),
        }
    }

    #[test]
    fn iz_tutarsa_artimli() {
        assert!(!ajanda_telafi_tam_mi(&girdi()));
        // Hiç eşitlenmemiş ama aynı depo: iz gerekmez.
        let g = TelafiGirdisi { hello_son_rev: 0, hello_son_rev_izi: None, izdeki: None, ..girdi() };
        assert!(!ajanda_telafi_tam_mi(&g));
    }

    #[test]
    fn depo_degisti_ya_da_telefon_ileride() {
        assert!(ajanda_telafi_tam_mi(&TelafiGirdisi { hello_depo_id: None, ..girdi() }));
        assert!(ajanda_telafi_tam_mi(&TelafiGirdisi { hello_depo_id: Some("d_b".into()), ..girdi() }));
        assert!(ajanda_telafi_tam_mi(&TelafiGirdisi { bas_rev: 6, ..girdi() }));
    }

    #[test]
    fn ayni_depo_idli_geri_yukleme_izden_yakalanir() {
        // PC aynı `depo_id`'yle yedekten geri yüklendi; revizyon 7 bu kez başka bir kayda verildi.
        // Numaralar tutsa da iz tutmaz: tam telafi.
        assert!(ajanda_telafi_tam_mi(&TelafiGirdisi { izdeki: Some(("k_2".into(), 2000)), ..girdi() }));
        // Aynı kayda ama başka zamanda yazıldı.
        assert!(ajanda_telafi_tam_mi(&TelafiGirdisi { izdeki: Some(("k_1".into(), 2500)), ..girdi() }));
        // Servis geçmişinde o revizyon yok, ya da telefon iz yollamadı.
        assert!(ajanda_telafi_tam_mi(&TelafiGirdisi { izdeki: None, ..girdi() }));
        assert!(ajanda_telafi_tam_mi(&TelafiGirdisi { hello_son_rev_izi: None, ..girdi() }));
    }
}
