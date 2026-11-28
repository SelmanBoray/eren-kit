//! SAHİBİ: R2 (birleştirme, tekilleştirme, kuyruk, eşitleme kuralları). Alan düzeyinde birleştirme
//! (`ajanda.ts` `ajandaDegisikligiUygula`, `ornekleriBuda`). Motorun iyimser uygulaması, kuyruğun taze
//! kopya üstüne yeniden uygulanması ve yerel kipin yazarı (`motor/yerel.rs`, `islem_uygula` üzerinden)
//! bunu kullanır: v3 bölge/konum kuralı da burada olduğu için üçü aynı sonucu verir.
//! Vektörler: `ajanda-kurallar.json` `birlestirme`, `ajanda-v3.json` `bolge_konumu`.
//!
//! Uygulama biçimi: her alan için "istenen" (verilmedi / kaldır / değer) ve "şimdiki" değer JSON
//! olarak alınır ve başvurudaki gibi kanonik JSON ile karşılaştırılır; uygulama ise tipli alana
//! doğrudan yapılır (JSON'dan geri okuma yok). Böylece "aynı mı" kararı TypeScript ile birebir
//! aynı tanımı kullanır, yeni hal ise şemadan geçmemiş olsa da tipli kalır.

use crate::model::alan::{baglantilar_yaz, ekler_yaz};
use crate::model::kanonik::kanonik_json;
use crate::model::tekrar::ornek_gunu_mu;
use crate::model::zaman::hatirlatmalari_yaz;
use crate::model::{
    Alan, AjandaAlani, AjandaBolgeKonumu, AjandaKaydi, AjandaOrnegi, AjandaVaris, AjandaZamani, AlanDegisikligi, Tekrar,
    YazarKimligi, ajanda_bolge_yeri_degisir_mi, kullanici_emri_mi,
};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AjandaBirlesimi {
    /// Yeni hal; `revizyon`, `guncelleme_ms` çağıranındır. Şemadan geçirilmemiştir (`gecerli_mi`).
    pub kayit: AjandaKaydi,
    /// Kanonik sırada.
    pub uygulanan: Vec<AjandaAlani>,
    pub korunan: Vec<AjandaAlani>,
    /// Tekrar kalktığı, çapa ya da kural değiştiği için atılan örnek satırları.
    pub budanan_ornekler: Vec<AjandaOrnegi>,
}

/// Değişiklikte alanın istenen hali.
enum Istenen {
    Kaldir,
    Deger(Value),
}

fn alan_istenen<T>(a: &Alan<T>, f: impl FnOnce(&T) -> Value) -> Option<Istenen> {
    match a {
        Alan::Yok => None,
        Alan::Kaldir => Some(Istenen::Kaldir),
        Alan::Deger(d) => Some(Istenen::Deger(f(d))),
    }
}

/// `degisiklik[alan]`: `None` verilmedi.
fn istenen(d: &AlanDegisikligi, alan: AjandaAlani) -> Option<Istenen> {
    match alan {
        AjandaAlani::Tur => d.tur.map(|t| Istenen::Deger(t.json())),
        AjandaAlani::Baslik => d.baslik.as_ref().map(|b| Istenen::Deger(Value::String(b.clone()))),
        AjandaAlani::Aciklama => alan_istenen(&d.aciklama, |a| Value::String(a.clone())),
        AjandaAlani::Zaman => alan_istenen(&d.zaman, AjandaZamani::json),
        AjandaAlani::Hatirlatmalar => d.hatirlatmalar.as_deref().map(|h| Istenen::Deger(hatirlatmalari_yaz(h))),
        AjandaAlani::Tekrar => alan_istenen(&d.tekrar, Tekrar::json),
        AjandaAlani::Durum => d.durum.map(|s| Istenen::Deger(s.json())),
        AjandaAlani::Simge => alan_istenen(&d.v3.simge, |s| Value::String(s.clone())),
        AjandaAlani::Bolge => alan_istenen(&d.v3.bolge, |s| Value::String(s.clone())),
        AjandaAlani::BolgeKonumu => alan_istenen(&d.v3.bolge_konumu, AjandaBolgeKonumu::json),
        AjandaAlani::Varis => alan_istenen(&d.v3.varis, AjandaVaris::json),
        AjandaAlani::Baglantilar => alan_istenen(&d.v3.baglantilar, |l| baglantilar_yaz(l)),
        AjandaAlani::Ekler => alan_istenen(&d.v3.ekler, |l| ekler_yaz(l)),
    }
}

/// `kayit[alan]`: `None` alan kayıtta yok (`undefined`).
fn simdiki(k: &AjandaKaydi, alan: AjandaAlani) -> Option<Value> {
    match alan {
        AjandaAlani::Tur => Some(k.tur.json()),
        AjandaAlani::Baslik => Some(Value::String(k.baslik.clone())),
        AjandaAlani::Aciklama => k.aciklama.clone().map(Value::String),
        AjandaAlani::Zaman => k.zaman.as_ref().map(AjandaZamani::json),
        AjandaAlani::Hatirlatmalar => Some(hatirlatmalari_yaz(&k.hatirlatmalar)),
        AjandaAlani::Tekrar => k.tekrar.as_ref().map(Tekrar::json),
        AjandaAlani::Durum => Some(k.durum.json()),
        AjandaAlani::Simge => k.v3.simge.clone().map(Value::String),
        AjandaAlani::Bolge => k.v3.bolge.clone().map(Value::String),
        AjandaAlani::BolgeKonumu => k.v3.bolge_konumu.as_ref().map(AjandaBolgeKonumu::json),
        AjandaAlani::Varis => k.v3.varis.as_ref().map(AjandaVaris::json),
        AjandaAlani::Baglantilar => (!k.v3.baglantilar.is_empty()).then(|| baglantilar_yaz(&k.v3.baglantilar)),
        AjandaAlani::Ekler => (!k.v3.ekler.is_empty()).then(|| ekler_yaz(&k.v3.ekler)),
    }
}

/// `Alan<T>`'yı seçeneğe uygular (`Yok` dokunmaz).
fn uclu_uygula<T: Clone>(hedef: &mut Option<T>, a: &Alan<T>) {
    match a {
        Alan::Yok => {}
        Alan::Kaldir => *hedef = None,
        Alan::Deger(d) => *hedef = Some(d.clone()),
    }
}

/// Liste alanına uygular: modelde boş liste "alan yok"tur (`Kaldir`).
fn liste_uygula<T: Clone>(hedef: &mut Vec<T>, a: &Alan<Vec<T>>) {
    match a {
        Alan::Yok => {}
        Alan::Kaldir => hedef.clear(),
        Alan::Deger(d) => *hedef = d.clone(),
    }
}

/// Değişikliğin `alan`'ını kayda yazar (alanın verildiği çağıranca bilinir).
fn alani_yaz(k: &mut AjandaKaydi, d: &AlanDegisikligi, alan: AjandaAlani) {
    match alan {
        AjandaAlani::Tur => {
            if let Some(t) = d.tur {
                k.tur = t;
            }
        }
        AjandaAlani::Baslik => {
            if let Some(b) = &d.baslik {
                k.baslik = b.clone();
            }
        }
        AjandaAlani::Aciklama => uclu_uygula(&mut k.aciklama, &d.aciklama),
        AjandaAlani::Zaman => uclu_uygula(&mut k.zaman, &d.zaman),
        AjandaAlani::Hatirlatmalar => {
            if let Some(h) = &d.hatirlatmalar {
                k.hatirlatmalar = h.clone();
            }
        }
        AjandaAlani::Tekrar => uclu_uygula(&mut k.tekrar, &d.tekrar),
        AjandaAlani::Durum => {
            if let Some(s) = d.durum {
                k.durum = s;
            }
        }
        AjandaAlani::Simge => uclu_uygula(&mut k.v3.simge, &d.v3.simge),
        AjandaAlani::Bolge => uclu_uygula(&mut k.v3.bolge, &d.v3.bolge),
        AjandaAlani::BolgeKonumu => uclu_uygula(&mut k.v3.bolge_konumu, &d.v3.bolge_konumu),
        AjandaAlani::Varis => uclu_uygula(&mut k.v3.varis, &d.v3.varis),
        AjandaAlani::Baglantilar => liste_uygula(&mut k.v3.baglantilar, &d.v3.baglantilar),
        AjandaAlani::Ekler => liste_uygula(&mut k.v3.ekler, &d.v3.ekler),
    }
}

/// `bolge` değişikliği konumu düşürür mü (`ajandaBolgeYeriDegisirMi(kayit.bolge, deger)`).
fn bolge_yeri_degisir(kayit: &AjandaKaydi, bolge: &Alan<String>) -> bool {
    let yeni = match bolge {
        Alan::Deger(b) => Some(b.as_str()),
        _ => None,
    };
    ajanda_bolge_yeri_degisir_mi(kayit.v3.bolge.as_deref(), yeni)
}

/// `ornekleriBuda`: seriye artık ait olmayan örnek satırları. Tekrar yoksa hepsi; zamanın günü yoksa
/// (tekrar zaten tutarsız) dokunmaz; değilse serinin günü olmayanlar (çapadan önceki dahil:
/// `ornek_gunu_mu` çapadan önceyi reddeder). Dönüş: (kalan, budanan), ikisi de girdi sırasıyla.
fn ornekleri_buda(k: &AjandaKaydi) -> (Vec<AjandaOrnegi>, Vec<AjandaOrnegi>) {
    let Some(tekrar) = &k.tekrar else { return (vec![], k.ornekler.clone()) };
    let Some(capa) = k.zaman.as_ref().and_then(AjandaZamani::tarih) else { return (k.ornekler.clone(), vec![]) };
    k.ornekler.iter().cloned().partition(|o| ornek_gunu_mu(capa, tekrar, &o.tarih))
}

/// Değeri aynı olan alan atlanır (kanonik JSON eşitliği; `Kaldir` yokken aynıdır). Emir olmayan
/// değişiklikte (`kullanici_emri_mi` yanlış) `elle_alanlar`'daki alan değişmez, `korunan`'a girer.
/// Emirde her alan uygulanır ve `elle_alanlar`'a eklenir. `tekrar` ya da `zaman` uygulanınca seriye
/// ait olmayan örnek satırları budanır. Hatırlatma listesine dokunulmaz.
///
/// Bölge ve konum (v3): `bolge` başka bir yere (`ajanda_bolge_yeri_degisir_mi`) değişir ya da kaldırılırsa
/// ve aynı değişiklikte `bolge_konumu` verilmediyse konum da kalkar (`uygulanan`'a girer). Yalnız yazılışı
/// değişen ad aynı yerdir, konum kalır. Emir olmayan otomasyonda `bolge_konumu` korunuyorsa (`elle_alanlar`)
/// ve kayıtta konum varsa, konumu düşürecek `bolge` değişikliği de korunur. `varis` kendiliğinden kalkmaz:
/// `bolge` kaldırılıp `varis` bırakılırsa sonuç `gecerli_mi`'den geçmez (`tutarsiz_kayit`).
pub fn ajanda_degisikligi_uygula(
    kayit: &AjandaKaydi,
    degisiklik: &AlanDegisikligi,
    yazar: YazarKimligi,
) -> AjandaBirlesimi {
    let otomasyon = !kullanici_emri_mi(yazar.yol, yazar.tur_kokeni);
    let mut yeni = kayit.clone();
    let mut uygulanan = Vec::new();
    let mut korunan = Vec::new();
    let konum_korunur =
        otomasyon && kayit.v3.bolge_konumu.is_some() && kayit.elle_alanlar.contains(&AjandaAlani::BolgeKonumu);
    for &alan in AjandaAlani::HEPSI {
        let Some(deger) = istenen(degisiklik, alan) else { continue };
        let simdi = simdiki(kayit, alan);
        let ayni = match (&deger, &simdi) {
            (Istenen::Kaldir, s) => s.is_none(),
            (Istenen::Deger(d), Some(s)) => kanonik_json(d) == kanonik_json(s),
            (Istenen::Deger(_), None) => false,
        };
        if ayni {
            continue;
        }
        let konumu_dusurur = alan == AjandaAlani::Bolge && bolge_yeri_degisir(kayit, &degisiklik.v3.bolge);
        if otomasyon && (kayit.elle_alanlar.contains(&alan) || (konumu_dusurur && konum_korunur)) {
            korunan.push(alan);
            continue;
        }
        alani_yaz(&mut yeni, degisiklik, alan);
        uygulanan.push(alan);
    }
    if uygulanan.contains(&AjandaAlani::Bolge)
        && degisiklik.v3.bolge_konumu.yok_mu()
        && yeni.v3.bolge_konumu.is_some()
        && ajanda_bolge_yeri_degisir_mi(kayit.v3.bolge.as_deref(), yeni.v3.bolge.as_deref())
    {
        yeni.v3.bolge_konumu = None;
        uygulanan.push(AjandaAlani::BolgeKonumu);
        uygulanan.sort();
    }
    if !otomasyon {
        yeni.elle_alanlar = AjandaAlani::HEPSI
            .iter()
            .copied()
            .filter(|a| kayit.elle_alanlar.contains(a) || uygulanan.contains(a))
            .collect();
    }
    let mut budanan_ornekler = Vec::new();
    if (uygulanan.contains(&AjandaAlani::Tekrar) || uygulanan.contains(&AjandaAlani::Zaman)) && !yeni.ornekler.is_empty() {
        let (kalan, budanan) = ornekleri_buda(&yeni);
        yeni.ornekler = kalan;
        budanan_ornekler = budanan;
    }
    AjandaBirlesimi { kayit: yeni, uygulanan, korunan, budanan_ornekler }
}

#[cfg(test)]
mod testler {
    use super::*;
    use crate::model::{
        AjandaKaynagi, Hatirlatma, KayitDurumu, KayitTuru, KaynakYolu, OrnekDurumu, TekrarSikligi, TurKokeni,
    };

    const IST: &str = "Europe/Istanbul";

    fn yazar(yol: KaynakYolu, tur_kokeni: TurKokeni) -> YazarKimligi {
        YazarKimligi { yol, tur_kokeni }
    }

    fn an(tarih: &str, saat: &str) -> AjandaZamani {
        AjandaZamani::An {
            tarih: tarih.into(),
            saat: saat.into(),
            sure_dk: None,
            saat_dilimi: IST.into(),
            ifade: Some("yarın 3'te".into()),
        }
    }

    fn kayit() -> AjandaKaydi {
        AjandaKaydi {
            kayit_id: "k_dis01".into(),
            revizyon: 3,
            tur: KayitTuru::Randevu,
            baslik: "Dişçi".into(),
            aciklama: None,
            zaman: Some(an("2026-11-26", "15:00")),
            hatirlatmalar: vec![Hatirlatma::Once { dk: 60 }],
            tekrar: None,
            ornekler: vec![],
            durum: KayitDurumu::Acik,
            taslak: false,
            silindi: false,
            elle_alanlar: vec![],
            kaynak: AjandaKaynagi {
                yol: KaynakYolu::SohbetAraci,
                tur_kokeni: TurKokeni::Insan,
                sohbet_id: Some("ana".into()),
                oturum_id: None,
                kaynak_msg_id: None,
                device_id: None,
                alinti: None,
                tekil_anahtar: None,
            },
            olusturma_ms: 1,
            guncelleme_ms: 1,
            v3: Default::default(),
        }
    }

    fn haftalik() -> Tekrar {
        Tekrar::oku(&serde_json::json!({"siklik": "haftalik", "aralik": 1}), "").expect("tekrar")
    }

    #[test]
    fn emir_uygular_ve_elle_alanlara_ekler() {
        let k = AjandaKaydi { elle_alanlar: vec![AjandaAlani::Tekrar], ..kayit() };
        let d = AlanDegisikligi { baslik: Some("Diş hekimi".into()), aciklama: Alan::Deger("dolgu".into()), ..Default::default() };
        // Uygulamadan elle, sesli not ve insan turundaki araç çağrısı emirdir.
        for y in [
            yazar(KaynakYolu::Elle, TurKokeni::Insan),
            yazar(KaynakYolu::SesliNot, TurKokeni::Insan),
            yazar(KaynakYolu::SohbetAraci, TurKokeni::Insan),
            yazar(KaynakYolu::PcAraci, TurKokeni::Insan),
        ] {
            let r = ajanda_degisikligi_uygula(&k, &d, y);
            assert_eq!(r.uygulanan, vec![AjandaAlani::Baslik, AjandaAlani::Aciklama], "{y:?}");
            assert!(r.korunan.is_empty());
            assert_eq!(r.kayit.elle_alanlar, vec![AjandaAlani::Baslik, AjandaAlani::Aciklama, AjandaAlani::Tekrar]);
            assert_eq!(r.kayit.baslik, "Diş hekimi");
            assert_eq!(r.kayit.aciklama.as_deref(), Some("dolgu"));
        }
    }

    #[test]
    fn otomasyon_elle_alani_degistiremez_digerlerini_uygular() {
        let k = AjandaKaydi { elle_alanlar: vec![AjandaAlani::Baslik, AjandaAlani::Hatirlatmalar], ..kayit() };
        let d = AlanDegisikligi {
            baslik: Some("Başka".into()),
            aciklama: Alan::Deger("not".into()),
            hatirlatmalar: Some(vec![]),
            ..Default::default()
        };
        // Sentetik turdaki araç çağrısı ve (insan mesajından da olsa) arka plan çıkarımı emir değildir.
        for y in [
            yazar(KaynakYolu::SohbetAraci, TurKokeni::Sentetik),
            yazar(KaynakYolu::PcAraci, TurKokeni::Sentetik),
            yazar(KaynakYolu::ArkaPlan, TurKokeni::Insan),
            yazar(KaynakYolu::ArkaPlan, TurKokeni::Sentetik),
        ] {
            let r = ajanda_degisikligi_uygula(&k, &d, y);
            assert_eq!(r.uygulanan, vec![AjandaAlani::Aciklama], "{y:?}");
            assert_eq!(r.korunan, vec![AjandaAlani::Baslik, AjandaAlani::Hatirlatmalar]);
            assert_eq!(r.kayit.baslik, "Dişçi");
            assert_eq!(r.kayit.hatirlatmalar, vec![Hatirlatma::Once { dk: 60 }]);
            // Otomasyon elle alanlarına bir şey eklemez.
            assert_eq!(r.kayit.elle_alanlar, k.elle_alanlar);
        }
    }

    #[test]
    fn ayni_deger_atlanir_korunmaz_da() {
        let k = AjandaKaydi { elle_alanlar: vec![AjandaAlani::Baslik], ..kayit() };
        // Aynı başlık, yokken kaldırılan açıklama, aynı zaman: hiçbiri uygulanmaz ya da korunmaz.
        let d = AlanDegisikligi {
            baslik: Some("Dişçi".into()),
            aciklama: Alan::Kaldir,
            zaman: Alan::Deger(an("2026-11-26", "15:00")),
            durum: Some(KayitDurumu::Acik),
            ..Default::default()
        };
        for y in [yazar(KaynakYolu::ArkaPlan, TurKokeni::Insan), yazar(KaynakYolu::Elle, TurKokeni::Insan)] {
            let r = ajanda_degisikligi_uygula(&k, &d, y);
            assert!(r.uygulanan.is_empty() && r.korunan.is_empty());
            assert_eq!(r.kayit, k);
        }
    }

    #[test]
    fn kaldir_alani_siler_ve_durum_uygulanir() {
        let k = AjandaKaydi { aciklama: Some("x".into()), ..kayit() };
        let d = AlanDegisikligi { aciklama: Alan::Kaldir, durum: Some(KayitDurumu::Tamam), ..Default::default() };
        let r = ajanda_degisikligi_uygula(&k, &d, yazar(KaynakYolu::Elle, TurKokeni::Insan));
        assert_eq!(r.uygulanan, vec![AjandaAlani::Aciklama, AjandaAlani::Durum]);
        assert_eq!(r.kayit.aciklama, None);
        assert_eq!(r.kayit.durum, KayitDurumu::Tamam);
        assert!(r.kayit.json().get("aciklama").is_none());
    }

    #[test]
    fn tekrar_kalkinca_ornekler_budanir_zaman_kesinligi_hatirlatmaya_dokunmaz() {
        let ornek = |t: &str| AjandaOrnegi { tarih: t.into(), durum: OrnekDurumu::Tamam };
        let k = AjandaKaydi {
            tekrar: Some(haftalik()),
            ornekler: vec![ornek("2026-11-26"), ornek("2026-12-03"), ornek("2026-12-10")],
            ..kayit()
        };
        assert_eq!(haftalik().siklik, TekrarSikligi::Haftalik);
        // Çapa bir hafta ileri: ilk örnek artık çapadan önce, budanır.
        let d = AlanDegisikligi { zaman: Alan::Deger(an("2026-12-03", "15:00")), ..Default::default() };
        let r = ajanda_degisikligi_uygula(&k, &d, yazar(KaynakYolu::Elle, TurKokeni::Insan));
        assert_eq!(r.kayit.ornekler, vec![ornek("2026-12-03"), ornek("2026-12-10")]);
        assert_eq!(r.budanan_ornekler, vec![ornek("2026-11-26")]);
        assert!(r.kayit.gecerli_mi().is_ok());
        // Gün kesinliğine geçiş: hatırlatma listesi aynen kalır (`once` saat gelince kurulur).
        let gun = AjandaZamani::Gun { tarih: "2026-11-26".into(), gun_bolumu: None, saat_dilimi: IST.into(), ifade: None };
        let r = ajanda_degisikligi_uygula(&k, &AlanDegisikligi { zaman: Alan::Deger(gun), ..Default::default() }, yazar(KaynakYolu::Elle, TurKokeni::Insan));
        assert_eq!(r.kayit.hatirlatmalar, k.hatirlatmalar);
        assert!(r.budanan_ornekler.is_empty());
        // Tekrar kaldırılınca bütün örnek satırları budanır.
        let r = ajanda_degisikligi_uygula(&k, &AlanDegisikligi { tekrar: Alan::Kaldir, ..Default::default() }, yazar(KaynakYolu::Elle, TurKokeni::Insan));
        assert!(r.kayit.ornekler.is_empty());
        assert_eq!(r.budanan_ornekler.len(), 3);
        assert!(r.kayit.gecerli_mi().is_ok());
    }

    #[test]
    fn korunan_tekrar_ornekleri_budatmaz() {
        // Otomasyon elle alanındaki tekrarı kaldıramaz: tekrar uygulanmadığı için örnekler kalır.
        let ornek = AjandaOrnegi { tarih: "2026-12-03".into(), durum: OrnekDurumu::Iptal };
        let k = AjandaKaydi { tekrar: Some(haftalik()), ornekler: vec![ornek.clone()], elle_alanlar: vec![AjandaAlani::Tekrar], ..kayit() };
        let r = ajanda_degisikligi_uygula(&k, &AlanDegisikligi { tekrar: Alan::Kaldir, ..Default::default() }, yazar(KaynakYolu::SohbetAraci, TurKokeni::Sentetik));
        assert_eq!(r.korunan, vec![AjandaAlani::Tekrar]);
        assert_eq!(r.kayit.ornekler, vec![ornek]);
        assert!(r.budanan_ornekler.is_empty());
    }
}
