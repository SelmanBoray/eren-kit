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

/// R1: `ekle`'nin iyimser hali (ve yerel yazarın kaydı) v3 alanlarını taşır; verilen v3 alanları servis gibi
/// `elle_alanlar`'a kanonik sırada girer.
#[test]
fn v3_alanli_ekle_v3_alanlarini_ve_elle_alanlari_tasir() {
    let v = json!({
        "islem": "ekle", "kayit_id": "k_yeni01", "tur": "gorev", "baslik": "Ekmek", "hatirlatmalar": [],
        "girdi_yolu": "elle", "simge": "alisveris", "bolge": "Fırın",
    });
    let islem = AjandaIslem::oku_surum(&v, "", Surum::V3).unwrap();
    let cevirici = SabitOfsetCevirici::yeni([("Europe/Istanbul", 180)]);
    let b = IyimserBaglam { device_id: "cihaz1".into(), simdi_ms: 1_795_000_100_000, cihaz_dilimi: "Europe/Istanbul".into(), cevirici: &cevirici };
    let Uygulama::Yeni(y) = islem_uygula(None, &islem, b.simdi_ms, &b) else { panic!("yeni hal") };
    assert_eq!((y.v3.simge.as_deref(), y.v3.bolge.as_deref()), (Some("alisveris"), Some("Fırın")));
    assert_eq!(y.elle_alanlar.iter().map(|a| a.ad()).collect::<Vec<_>>(), ["tur", "baslik", "hatirlatmalar", "simge", "bolge"]);
}

/// R1: dökme kuralı (`kuyruga_islemler`) v3 alanlarını taşır: temelsiz kayıt `ekle`'si v3'lü, temelli kaydın
/// farkı v3 farkını içerir; telefonun kaldırdığı alan `null`, bölge başka yere değişirken korunan konum açıkça
/// gider (servis onu düşürmesin). v3 farkı olmayan kayıtta işlem yoktur (`icerik_ayni`).
#[test]
fn dokme_kurali_v3_alanlarini_tasir() {
    use super::yerel::{icerik_ayni, kuyruga_islemler};
    use crate::model::Alan;
    let t = kayit(json!({"simge": "is"}));
    let l = kuyruga_islemler(None, &t, false);
    let AjandaIslem::Ekle { v3, .. } = &l[0].0 else { panic!("ekle") };
    assert_eq!(v3, &t.v3);
    assert!(kuyruga_islemler(Some(&t), &t, false).is_empty());

    let mut k = t.clone();
    k.v3.simge = None;
    k.v3.bolge = Some("Bakkal".into());
    assert!(!icerik_ayni(&t, &k));
    let l = kuyruga_islemler(Some(&t), &k, false);
    let [(AjandaIslem::Guncelle { degisiklik, .. }, _)] = l.as_slice() else { panic!("tek guncelle: {l:?}") };
    assert_eq!(degisiklik.v3.simge, Alan::Kaldir);
    assert_eq!(degisiklik.v3.bolge, Alan::Deger("Bakkal".into()));
    assert_eq!(degisiklik.v3.bolge_konumu, Alan::Deger(t.v3.bolge_konumu.unwrap()), "korunan konum açıkça gider");
    // Yalnız yazılışı değişen bölgede konum değişmemişse gitmez (servis korur).
    k.v3.bolge = Some("MARKET".into());
    let l = kuyruga_islemler(Some(&t), &k, false);
    let [(AjandaIslem::Guncelle { degisiklik, .. }, _)] = l.as_slice() else { panic!("tek guncelle: {l:?}") };
    assert_eq!(degisiklik.v3.bolge_konumu, Alan::Yok);
}

/// R5: silinecek (temelde canlı, telefonda silinmiş) kaydın v3 farkı dökülmez: v2 serviste ertelenir ve
/// arkasındaki `sil`'in sırasını tutardı (silme süresiz beklerdi). Gövde farkı ve `sil` gider; silinmeyen kayıtta
/// v3 farkı yine gider.
#[test]
fn silinecek_kaydin_v3_farki_dokulmez() {
    use super::yerel::kuyruga_islemler;
    let t = kayit(json!({"simge": "is"}));
    let mut k = t.clone();
    k.baslik = "Süt al!".into();
    k.v3.simge = Some("ev".into());
    let l = kuyruga_islemler(Some(&t), &k, false);
    let [(AjandaIslem::Guncelle { degisiklik, .. }, _)] = l.as_slice() else { panic!("tek guncelle: {l:?}") };
    assert!(!degisiklik.v3.bos_mu(), "canlı kayıtta v3 farkı gider");
    k.silindi = true;
    let l = kuyruga_islemler(Some(&t), &k, false);
    let [(AjandaIslem::Guncelle { degisiklik, .. }, _), (AjandaIslem::Sil { .. }, _)] = l.as_slice() else {
        panic!("guncelle ve sil: {l:?}")
    };
    assert!(degisiklik.v3.bos_mu(), "silinecek kaydın v3 farkı yok: {degisiklik:?}");
    assert_eq!(degisiklik.baslik.as_deref(), Some("Süt al!"));
    // Yalnız v3 farkı olan silinecek kayıtta yalnız `sil`.
    k.baslik = t.baslik.clone();
    let l = kuyruga_islemler(Some(&t), &k, false);
    assert!(matches!(l.as_slice(), [(AjandaIslem::Sil { .. }, _)]), "{l:?}");
}

/// R10: temelsiz birleşmede PC'nin `varis`'i telefonun başka bir bölgesine taşınmaz (varış bölgesine bağlıdır);
/// telefonda bölge yoksa PC'nin bölgesi, konumu ve varışı birlikte gelir; aynı yerse eksik varış PC'den.
#[test]
fn temelsiz_birlesmede_varis_bolgesinden_kopmaz() {
    use super::yerel::pc_v3_alanlariyla;
    let pc = kayit(json!({"varis": {"cikista": true}}));
    let mut tel = kayit(json!({}));
    tel.v3.bolge = Some("Ev".into());
    tel.v3.bolge_konumu = None;
    let b = pc_v3_alanlariyla(&tel, &pc);
    assert_eq!((b.v3.bolge.as_deref(), b.v3.bolge_konumu, b.v3.varis.as_ref()), (Some("Ev"), None, None));
    assert!(b.gecerli_mi().is_ok());

    tel.v3.bolge = None;
    let b = pc_v3_alanlariyla(&tel, &pc);
    assert_eq!((&b.v3.bolge, &b.v3.bolge_konumu, &b.v3.varis), (&pc.v3.bolge, &pc.v3.bolge_konumu, &pc.v3.varis));

    tel.v3.bolge = Some("MARKET".into());
    let b = pc_v3_alanlariyla(&tel, &pc);
    assert_eq!((b.v3.bolge.as_deref(), &b.v3.varis), (Some("MARKET"), &pc.v3.varis), "aynı yer: varış PC'den");
}
