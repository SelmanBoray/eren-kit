//! Yerel kipte erteleme yoktur (`kanal.rs` "Erteleme"): servis yok, v3 alanları yerel yazarda kısıtsız
//! uygulanır, kuyruk ve ertelenen sayısı sıfırdır. Bugün v3 alanlı işlem köprü yüzeyinden gelemez (Kotlin
//! formu v2 gövdesidir): yerel yazar (`yerel_yaz`) doğrudan çağrılır. Ayrıca ret girdisinin v3 özeti (`sorgu::v3_ozeti`).

use super::*;
use crate::kopru::sahte::{SahteKimlik, SahteZaman};
use crate::kopru::tipler::{BaglantiKipi, BaglantiYetenekleri};
use crate::model::{AjandaDegisiklik, AjandaIslem, Alan, GirdiYolu, KayitGovdesi, KayitTuru, V3Alanlari, V3Degisikligi};

const SIMDI: i64 = 1_795_606_200_000;

fn govde(baslik: &str) -> KayitGovdesi {
    KayitGovdesi { tur: KayitTuru::Gorev, baslik: baslik.into(), aciklama: None, zaman: None, hatirlatmalar: vec![], tekrar: None }
}

/// Eşleşmesiz yeni veritabanı yerel kiptedir (göç 4). `f` yerel yazarla işlem yapar.
fn yerel_motor(f: impl FnOnce(&mut Motor, &Ortam, &mut Etkiler)) -> Motor {
    let mut m = Motor::ac(":memory:").unwrap();
    assert!(m.yerel_mi().unwrap());
    let (kimlik, zaman) = (SahteKimlik::default(), SahteZaman::yeni(SIMDI));
    let o = Ortam { kimlik: &kimlik, zaman: &zaman };
    let mut e = Etkiler::default();
    f(&mut m, &o, &mut e);
    m
}

fn yerel_yetenekler(m: &Motor) {
    assert_eq!(
        m.baglanti_yetenekleri().unwrap(),
        BaglantiYetenekleri { kip: BaglantiKipi::Yerel, surum: None, v3_alanlari: true, yetenekler: vec![], ertelenen: 0 }
    );
    assert!(m.depo.kuyruk().unwrap().is_empty());
    assert_eq!(m.baglanti_durumu().unwrap().kuyrukta, 0);
}

#[test]
fn yerel_kipte_v3_guncellemesi_kisitsiz_uygulanir_erteleme_yok() {
    let m = yerel_motor(|m, o, e| {
        let ekle = AjandaIslem::Ekle { kayit_id: "k_yerel01".into(), govde: govde("Süt al"), v3: V3Alanlari::default(), girdi_yolu: GirdiYolu::Elle };
        assert!(m.yerel_yaz(o, e, ekle).unwrap());
        let v3 = V3Degisikligi { simge: Alan::Deger("alisveris".into()), bolge: Alan::Deger("Market".into()), ..Default::default() };
        let g = AjandaIslem::Guncelle { kayit_id: "k_yerel01".into(), temel_revizyon: 1, degisiklik: AjandaDegisiklik { v3, ..Default::default() } };
        assert!(m.yerel_yaz(o, e, g).unwrap());
    });
    let g = super::sorgu::kayit(&m.depo, "k_yerel01").unwrap().unwrap();
    assert_eq!((g.kayit.v3.simge.as_deref(), g.kayit.v3.bolge.as_deref()), (Some("alisveris"), Some("Market")));
    assert_eq!((g.bekleyen, g.ertelenen), (false, false));
    yerel_yetenekler(&m);
}

#[test]
fn yerel_kipte_v3_alanli_ekleme_kisitsiz_uygulanir() {
    let m = yerel_motor(|m, o, e| {
        let v3 = V3Alanlari { simge: Some("is".into()), ..Default::default() };
        let ekle = AjandaIslem::Ekle { kayit_id: "k_yerel02".into(), govde: govde("Rapor"), v3, girdi_yolu: GirdiYolu::Elle };
        assert!(m.yerel_yaz(o, e, ekle).unwrap());
    });
    let g = super::sorgu::kayit(&m.depo, "k_yerel02").unwrap().unwrap();
    assert_eq!(g.kayit.v3.simge.as_deref(), Some("is"));
    assert!(!g.ertelenen);
    yerel_yetenekler(&m);
}

/// Ret girdisinin v3 özeti (`sorgu::v3_ozeti`, A1): `ekle`'de konan v3 alanları, `guncelle`'de konanlar ve
/// kaldırılanlar (kablo adlarıyla, alan sırasıyla); v3 alanına dokunmayan işlemde yok.
#[test]
fn ret_girdisinin_v3_ozeti() {
    use super::sorgu::v3_ozeti;
    use crate::kopru::tipler::V3DegisiklikOzeti;
    let v3 = V3Alanlari { simge: Some("is".into()), bolge: Some("Ofis".into()), ..Default::default() };
    let ekle = AjandaIslem::Ekle { kayit_id: "k_a".into(), govde: govde("A"), v3: v3.clone(), girdi_yolu: GirdiYolu::Elle };
    assert_eq!(v3_ozeti(&ekle), Some(V3DegisiklikOzeti { konan: v3, kaldirilan: vec![] }));
    let bos = AjandaIslem::Ekle { kayit_id: "k_a".into(), govde: govde("A"), v3: V3Alanlari::default(), girdi_yolu: GirdiYolu::Elle };
    assert_eq!(v3_ozeti(&bos), None);
    let d = V3Degisikligi { simge: Alan::Deger("ev".into()), ekler: Alan::Kaldir, bolge: Alan::Kaldir, ..Default::default() };
    let g = AjandaIslem::Guncelle { kayit_id: "k_a".into(), temel_revizyon: 1, degisiklik: AjandaDegisiklik { v3: d, ..Default::default() } };
    let o = v3_ozeti(&g).expect("özet");
    assert_eq!((o.konan.simge.as_deref(), o.konan.bolge.as_deref(), o.kaldirilan), (Some("ev"), None, vec!["bolge".to_string(), "ekler".to_string()]));
    let duz = AjandaIslem::Guncelle { kayit_id: "k_a".into(), temel_revizyon: 1, degisiklik: AjandaDegisiklik { baslik: Some("B".into()), ..Default::default() } };
    assert_eq!(v3_ozeti(&duz), None);
    assert_eq!(v3_ozeti(&AjandaIslem::Sil { kayit_id: "k_a".into() }), None);
}
