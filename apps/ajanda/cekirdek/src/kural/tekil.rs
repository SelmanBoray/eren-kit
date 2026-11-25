//! SAHİBİ: R2. Tekilleştirme (`ajanda.ts` `ajandaTekilAnahtari`, `ajandaEsDegisikligi`;
//! `ajanda-kural.ts` `ajandaTekilKarari`). Servisin işidir; uygulama yalnız vektör eşliği için taşır.
//! Kanonik JSON ve SHA-256: `model::kanonik`. Zaman çekirdeği: `AjandaZamani::cekirdek_json`.
//! Vektörler: `tekil_anahtar`, `es_degisikligi`, `tekil_karar`.

use crate::model::kanonik::{kanonik_json, sha256_hex};
use crate::model::{
    Alan, AjandaZamani, AlanDegisikligi, Hatirlatma, KayitDurumu, KayitTuru, YazarKimligi, kullanici_emri_mi,
};
use serde_json::{Value, json};

/// `"t1:" + sha256(kanonik JSON {kapsam, tur, baslik, zaman: çekirdek | null})`.
pub fn ajanda_tekil_anahtari(kapsam: &str, tur: KayitTuru, baslik: &str, zaman: Option<&AjandaZamani>) -> String {
    let zaman = zaman.map_or(Value::Null, AjandaZamani::cekirdek_json);
    let govde = json!({ "kapsam": kapsam, "tur": tur.json(), "baslik": baslik, "zaman": zaman });
    format!("t1:{}", sha256_hex(kanonik_json(&govde).as_bytes()))
}

/// Emirde açık eşe yansıyan alanlar: verilmişse `aciklama`, `hatirlatmalar`; eş `an` ve girdi `an`
/// ise ve `sure_dk` farklıysa eşin zamanı yeni süreyle (eşin `ifade`'si korunur).
pub fn ajanda_es_degisikligi(
    es_zaman: Option<&AjandaZamani>,
    aciklama: Option<&str>,
    zaman: Option<&AjandaZamani>,
    hatirlatmalar: Option<&[Hatirlatma]>,
) -> AlanDegisikligi {
    let mut d = AlanDegisikligi::default();
    if let Some(a) = aciklama {
        d.aciklama = Alan::Deger(a.to_string());
    }
    if let Some(h) = hatirlatmalar {
        d.hatirlatmalar = Some(h.to_vec());
    }
    let yeni_sure = match zaman {
        Some(AjandaZamani::An { sure_dk, .. }) => *sure_dk,
        _ => None,
    };
    match (es_zaman, yeni_sure) {
        (Some(AjandaZamani::An { tarih, saat, sure_dk, saat_dilimi, ifade }), Some(sure)) if *sure_dk != Some(sure) => {
            d.zaman = Alan::Deger(AjandaZamani::An {
                tarih: tarih.clone(),
                saat: saat.clone(),
                sure_dk: Some(sure),
                saat_dilimi: saat_dilimi.clone(),
                ifade: ifade.clone(),
            });
        }
        _ => {}
    }
    d
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
    let acik = esler.iter().position(|e| !e.silindi && e.durum == KayitDurumu::Acik);
    if kullanici_emri_mi(yazar.yol, yazar.tur_kokeni) {
        return match acik {
            None => TekilKarari::Ekle,
            Some(sira) if esler[sira].taslak => TekilKarari::Onayla { sira },
            Some(sira) => TekilKarari::ZatenVar { sira },
        };
    }
    if esler.is_empty() {
        return TekilKarari::Ekle;
    }
    TekilKarari::ZatenVar { sira: acik.unwrap_or(0) }
}

#[cfg(test)]
mod testler {
    use super::*;
    use crate::model::{KaynakYolu, TurKokeni};

    const IST: &str = "Europe/Istanbul";

    fn an(saat: &str, sure_dk: Option<i32>, ifade: &str) -> AjandaZamani {
        AjandaZamani::An {
            tarih: "2026-11-26".into(),
            saat: saat.into(),
            sure_dk,
            saat_dilimi: IST.into(),
            ifade: Some(ifade.into()),
        }
    }

    #[test]
    fn anahtar_ifade_ve_sureyi_saymaz_saati_sayar() {
        let a = ajanda_tekil_anahtari("sohbet:ana", KayitTuru::Randevu, "Dişçi", Some(&an("15:00", None, "yarın 3'te")));
        assert!(a.starts_with("t1:") && a.len() == 67);
        assert_eq!(a, ajanda_tekil_anahtari("sohbet:ana", KayitTuru::Randevu, "Dişçi", Some(&an("15:00", Some(30), "bugün 3'te"))));
        assert_ne!(a, ajanda_tekil_anahtari("sohbet:ana", KayitTuru::Randevu, "Dişçi", Some(&an("16:00", None, "x"))));
        assert_ne!(a, ajanda_tekil_anahtari("sohbet:ana", KayitTuru::Randevu, "Dişçi", None));
        assert_ne!(a, ajanda_tekil_anahtari("sohbet:baska", KayitTuru::Randevu, "Dişçi", Some(&an("15:00", None, "x"))));
    }

    #[test]
    fn es_degisikligi_sureyi_isler_ifadeyi_korur() {
        let es = an("15:00", None, "yarın 3'te");
        let d = ajanda_es_degisikligi(Some(&es), Some("Dolgu"), Some(&an("15:00", Some(30), "26'sında")), Some(&[Hatirlatma::Once { dk: 30 }]));
        assert_eq!(d.aciklama, Alan::Deger("Dolgu".into()));
        assert_eq!(d.hatirlatmalar, Some(vec![Hatirlatma::Once { dk: 30 }]));
        assert_eq!(d.zaman, Alan::Deger(an("15:00", Some(30), "yarın 3'te")));
        // Aynı süre ya da süresiz girdi: zaman değişmez; hiçbir şey verilmediyse değişiklik boştur.
        let es30 = an("15:00", Some(30), "yarın 3'te");
        assert!(ajanda_es_degisikligi(Some(&es30), None, Some(&an("15:00", Some(30), "x")), None).bos_mu());
        assert!(ajanda_es_degisikligi(Some(&es), None, Some(&an("15:00", None, "x")), None).bos_mu());
        // Eş `an` değilse süre işlenmez.
        let gun = AjandaZamani::Gun { tarih: "2026-11-26".into(), saat_dilimi: IST.into(), ifade: None };
        assert!(ajanda_es_degisikligi(Some(&gun), None, Some(&an("15:00", Some(30), "x")), None).bos_mu());
    }

    #[test]
    fn tekil_karar_emir_ve_otomasyon() {
        let es = |silindi, durum, taslak| EsDurumu { silindi, durum, taslak };
        let insan = YazarKimligi { yol: KaynakYolu::SohbetAraci, tur_kokeni: TurKokeni::Insan };
        let sentetik = YazarKimligi { yol: KaynakYolu::SohbetAraci, tur_kokeni: TurKokeni::Sentetik };
        let silinmis_taslak = es(true, KayitDurumu::Acik, true);
        let bitmis = es(false, KayitDurumu::Tamam, false);
        let acik_taslak = es(false, KayitDurumu::Acik, true);
        assert_eq!(ajanda_tekil_karari(&[], insan), TekilKarari::Ekle);
        assert_eq!(ajanda_tekil_karari(&[], sentetik), TekilKarari::Ekle);
        // Emirde silinmiş/bitmiş eş engellemez; otomasyon onları yeniden yaratmaz.
        assert_eq!(ajanda_tekil_karari(&[silinmis_taslak, bitmis], insan), TekilKarari::Ekle);
        assert_eq!(ajanda_tekil_karari(&[silinmis_taslak, bitmis], sentetik), TekilKarari::ZatenVar { sira: 0 });
        // Açık taslak: emir onaylar, otomasyon onaylamaz.
        assert_eq!(ajanda_tekil_karari(&[bitmis, acik_taslak], insan), TekilKarari::Onayla { sira: 1 });
        assert_eq!(ajanda_tekil_karari(&[bitmis, acik_taslak], sentetik), TekilKarari::ZatenVar { sira: 1 });
    }
}
