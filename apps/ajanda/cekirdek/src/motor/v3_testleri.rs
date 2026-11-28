//! v3 alan kuralları iyimser uygulamada ve yerel kipin yazarında (ikisi de `iyimser::islem_uygula`): bölge
//! başka ada değişince konum düşer, yazılışı değişince kalır, bölgesiz varış `tutarsiz_kayit`'tır. Kurallar
//! paylaşılan katmandadır (`kural::birlesim`, `AjandaKaydi::kurallar`); bu testler motorun onları
//! kullandığını sınar. Bugün v3 değişikliği yalnız v3 bağlantıdan ya da v3 kuyruğundan gelebilir (Kotlin
//! formu v2 gövdesidir), bu yüzden köprü yüzeyinden değil doğrudan `islem_uygula`'yla sınanır.

use super::iyimser::{IyimserBaglam, Uygulama, islem_uygula};
use crate::kural::SabitOfsetCevirici;
use crate::model::{AjandaIslem, AjandaKaydi, AjandaRetNedeni, Surum};
use serde_json::json;

fn kayit(ek: serde_json::Value) -> AjandaKaydi {
    let mut v = json!({
        "kayit_id": "k_market01", "revizyon": 20, "tur": "gorev", "baslik": "Süt al", "hatirlatmalar": [], "ornekler": [],
        "durum": "acik", "taslak": false, "silindi": false, "elle_alanlar": [],
        "kaynak": {"yol": "elle", "tur_kokeni": "insan", "device_id": "cihaz1"},
        "olusturma_ms": 1_795_000_000_000_i64, "guncelleme_ms": 1_795_000_000_000_i64,
        "bolge": "Market", "bolge_konumu": {"enlem_e6": 41_008_240, "boylam_e6": 28_978_359, "yaricap_m": 150}
    });
    for (a, d) in ek.as_object().unwrap() {
        v[a] = d.clone();
    }
    AjandaKaydi::oku(&v, "").unwrap()
}

fn guncelle(degisiklik: serde_json::Value) -> AjandaIslem {
    let v = json!({"islem": "guncelle", "kayit_id": "k_market01", "temel_revizyon": 20, "degisiklik": degisiklik});
    AjandaIslem::oku_surum(&v, "", Surum::V3).unwrap()
}

fn uygula(k: &AjandaKaydi, islem: &AjandaIslem) -> Uygulama {
    let cevirici = SabitOfsetCevirici::yeni([("Europe/Istanbul", 180)]);
    let b = IyimserBaglam {
        device_id: "cihaz1".into(),
        simdi_ms: 1_795_000_100_000,
        cihaz_dilimi: "Europe/Istanbul".into(),
        cevirici: &cevirici,
    };
    islem_uygula(Some(k), islem, b.simdi_ms, &b)
}

#[test]
fn bolge_baska_ada_degisince_konum_duser() {
    let Uygulama::Yeni(y) = uygula(&kayit(json!({})), &guncelle(json!({"bolge": "Bakkal"}))) else { panic!("yeni hal") };
    assert_eq!(y.v3.bolge.as_deref(), Some("Bakkal"));
    assert_eq!(y.v3.bolge_konumu, None);
    assert_eq!(y.elle_alanlar.iter().map(|a| a.ad()).collect::<Vec<_>>(), ["bolge", "bolge_konumu"]);
}

#[test]
fn yazilisi_degisen_bolge_konumu_korur() {
    let k = kayit(json!({}));
    let Uygulama::Yeni(y) = uygula(&k, &guncelle(json!({"bolge": "MARKET"}))) else { panic!("yeni hal") };
    assert_eq!(y.v3.bolge_konumu, k.v3.bolge_konumu);
}

#[test]
fn bolgesiz_varis_tutarsiz_kayit() {
    let k = kayit(json!({"varis": {"cikista": true}}));
    assert_eq!(uygula(&k, &guncelle(json!({"bolge": null}))), Uygulama::Ret(AjandaRetNedeni::TutarsizKayit));
    assert!(matches!(uygula(&k, &guncelle(json!({"bolge": null, "varis": null}))), Uygulama::Yeni(_)));
}
