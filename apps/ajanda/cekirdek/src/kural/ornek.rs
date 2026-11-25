//! SAHİBİ: R1. Tekrar eden kaydın tek örneğinin durumu (`ajanda-kural.ts` `ajandaOrnekDurumuUygula`):
//! `durum` işleminin `ornek_tarihi`'li hali; motorun iyimser uygulaması bunu kullanır.
//! Vektör: `ajanda-kurallar.json` `ornek_durumu`.

use crate::model::sinirlar::ajanda::ORNEK_ADET;
use crate::model::{AjandaKaydi, AjandaOrnegi, KayitDurumu, OrnekDurumu, ornek_gunu_mu};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OrnekDurumuSonucu {
    /// `ornekler`: yeni tam liste (tarih sırasıyla). `atilan`: `ORNEK_ADET` için atılan eski satırlar.
    Tamam { ornekler: Vec<AjandaOrnegi>, degisti: bool, atilan: Vec<AjandaOrnegi> },
    /// `ornek_gecersiz`.
    Gecersiz,
}

fn degismedi(kayit: &AjandaKaydi) -> OrnekDurumuSonucu {
    OrnekDurumuSonucu::Tamam { ornekler: kayit.ornekler.clone(), degisti: false, atilan: vec![] }
}

/// Tekrarsız kayıtta ya da serinin günü olmayan tarihte `Gecersiz`. `Acik` satırı kaldırır;
/// `Tamam`/`Iptal` ekler ya da değiştirir. `ORNEK_ADET` aşılırsa `bugun`'den (kaydın dilimindeki yerel
/// gün) önceki en eski satırlar atılır (az önce değişen hariç); yine aşılıyorsa `Gecersiz`.
pub fn ajanda_ornek_durumu_uygula(
    kayit: &AjandaKaydi,
    ornek_tarihi: &str,
    durum: KayitDurumu,
    bugun: &str,
) -> OrnekDurumuSonucu {
    // Çapa yalnız `an` ve `gun` zamanında var; `donem`/`belirsiz` tekrar taşıyamaz.
    let (Some(tekrar), Some(capa)) = (kayit.tekrar.as_ref(), kayit.zaman.as_ref().and_then(|z| z.tarih())) else {
        return OrnekDurumuSonucu::Gecersiz;
    };
    if !ornek_gunu_mu(capa, tekrar, ornek_tarihi) {
        return OrnekDurumuSonucu::Gecersiz;
    }
    let simdiki = kayit.ornekler.iter().position(|o| o.tarih == ornek_tarihi);
    let yeni_durum = match durum {
        KayitDurumu::Acik => {
            // Açık örnek satır taşımaz: varsa (yalnız ilk eşleşen) kaldırılır, sıra korunur.
            let Some(i) = simdiki else { return degismedi(kayit) };
            let mut ornekler = kayit.ornekler.clone();
            ornekler.remove(i);
            return OrnekDurumuSonucu::Tamam { ornekler, degisti: true, atilan: vec![] };
        }
        KayitDurumu::Tamam => OrnekDurumu::Tamam,
        KayitDurumu::Iptal => OrnekDurumu::Iptal,
    };
    if simdiki.is_some_and(|i| kayit.ornekler[i].durum == yeni_durum) {
        return degismedi(kayit);
    }
    let mut ornekler: Vec<AjandaOrnegi> = kayit.ornekler.iter().filter(|o| o.tarih != ornek_tarihi).cloned().collect();
    ornekler.push(AjandaOrnegi { tarih: ornek_tarihi.to_string(), durum: yeni_durum });
    // Kararlı sıralama (JS `sort` da kararlı); tarihler ASCII, bayt sırası = UTF-16 sırası.
    ornekler.sort_by(|a, b| a.tarih.cmp(&b.tarih));

    // Az önce değişen satır atılmaz; ondan başka, bugünden önceki en eski satırlar atılır.
    let mut atilacak = vec![false; ornekler.len()];
    let mut atilan_sayisi = 0;
    for (i, o) in ornekler.iter().enumerate() {
        if ornekler.len() - atilan_sayisi <= ORNEK_ADET || o.tarih.as_str() >= bugun {
            break;
        }
        if o.tarih != ornek_tarihi {
            atilacak[i] = true;
            atilan_sayisi += 1;
        }
    }
    if ornekler.len() - atilan_sayisi > ORNEK_ADET {
        return OrnekDurumuSonucu::Gecersiz;
    }
    let (atilan, kalan): (Vec<_>, Vec<_>) = ornekler.into_iter().zip(atilacak).partition(|(_, a)| *a);
    OrnekDurumuSonucu::Tamam {
        ornekler: kalan.into_iter().map(|(o, _)| o).collect(),
        degisti: true,
        atilan: atilan.into_iter().map(|(o, _)| o).collect(),
    }
}

#[cfg(test)]
mod testler {
    use super::*;
    use crate::model::takvim::{gun_no_tarih, tarih_gun_no};
    use serde_json::{Value, json};

    fn kayit(zaman: Value, tekrar: Option<Value>, ornekler: Value) -> AjandaKaydi {
        let mut v = json!({
            "kayit_id": "k_test", "revizyon": 1, "tur": "gorev", "baslik": "Deneme",
            "ornekler": ornekler, "durum": "acik", "taslak": false, "silindi": false, "elle_alanlar": [],
            "kaynak": {"yol": "elle", "tur_kokeni": "insan", "device_id": "cihaz_Test0001"},
            "olusturma_ms": 1_795_000_000_000_i64, "guncelleme_ms": 1_795_000_000_000_i64,
            "zaman": zaman, "hatirlatmalar": []
        });
        if let Some(t) = tekrar {
            v["tekrar"] = t;
        }
        AjandaKaydi::oku(&v, "").expect("geçerli kayıt")
    }

    fn gunluk(ornekler: Value) -> AjandaKaydi {
        kayit(
            json!({"kesinlik": "gun", "tarih": "2026-11-02", "saat_dilimi": "Europe/Istanbul"}),
            Some(json!({"siklik": "gunluk", "aralik": 1})),
            ornekler,
        )
    }

    fn tarihler(l: &[AjandaOrnegi]) -> Vec<&str> {
        l.iter().map(|o| o.tarih.as_str()).collect()
    }

    #[test]
    fn gun_zamanli_seri_gecerli() {
        let k = gunluk(json!([]));
        let r = ajanda_ornek_durumu_uygula(&k, "2026-11-05", KayitDurumu::Iptal, "2026-11-25");
        let OrnekDurumuSonucu::Tamam { ornekler, degisti: true, atilan } = r else { panic!("{r:?}") };
        assert_eq!(ornekler, vec![AjandaOrnegi { tarih: "2026-11-05".into(), durum: OrnekDurumu::Iptal }]);
        assert!(atilan.is_empty());
    }

    #[test]
    fn tekrarli_ama_tarihsiz_zaman_gecersiz() {
        let k = kayit(json!({"kesinlik": "belirsiz", "ifade": "bir ara"}), None, json!([]));
        assert_eq!(ajanda_ornek_durumu_uygula(&k, "2026-11-05", KayitDurumu::Tamam, "2026-11-25"), OrnekDurumuSonucu::Gecersiz);
        let mut k = gunluk(json!([]));
        k.zaman = None;
        assert_eq!(ajanda_ornek_durumu_uygula(&k, "2026-11-05", KayitDurumu::Tamam, "2026-11-25"), OrnekDurumuSonucu::Gecersiz);
        // Geçersiz tarih metni de örnek günü değildir.
        let k = gunluk(json!([]));
        assert_eq!(ajanda_ornek_durumu_uygula(&k, "2026-11-31", KayitDurumu::Tamam, "2026-11-25"), OrnekDurumuSonucu::Gecersiz);
    }

    #[test]
    fn acik_sirayi_korur() {
        let k = gunluk(json!([
            {"tarih": "2026-11-03", "durum": "tamam"},
            {"tarih": "2026-11-04", "durum": "iptal"},
            {"tarih": "2026-11-05", "durum": "tamam"}
        ]));
        let r = ajanda_ornek_durumu_uygula(&k, "2026-11-04", KayitDurumu::Acik, "2026-11-25");
        let OrnekDurumuSonucu::Tamam { ornekler, degisti: true, atilan } = r else { panic!("{r:?}") };
        assert_eq!(tarihler(&ornekler), ["2026-11-03", "2026-11-05"]);
        assert!(atilan.is_empty());
    }

    #[test]
    fn tamamdan_iptale_degisir() {
        let k = gunluk(json!([{"tarih": "2026-11-03", "durum": "tamam"}, {"tarih": "2026-11-05", "durum": "tamam"}]));
        let r = ajanda_ornek_durumu_uygula(&k, "2026-11-03", KayitDurumu::Iptal, "2026-11-25");
        let OrnekDurumuSonucu::Tamam { ornekler, degisti: true, .. } = r else { panic!("{r:?}") };
        assert_eq!(ornekler[0], AjandaOrnegi { tarih: "2026-11-03".into(), durum: OrnekDurumu::Iptal });
        assert_eq!(ornekler.len(), 2);
    }

    /// `ORNEK_ADET` dolu: bugünden önceki birden çok satır gerekirse, değişen satır atlanarak atılır;
    /// tam sınırda (ekleme yerine değişiklik) hiçbir satır atılmaz.
    #[test]
    fn dolu_listede_atma() {
        let bas = tarih_gun_no("2026-11-02").unwrap();
        let satirlar: Vec<Value> =
            (0..ORNEK_ADET as i64).map(|i| json!({"tarih": gun_no_tarih(bas + i), "durum": "tamam"})).collect();
        let k = gunluk(Value::Array(satirlar));
        let son = gun_no_tarih(bas + ORNEK_ADET as i64 - 1);
        let yeni = gun_no_tarih(bas + ORNEK_ADET as i64);

        // Var olan satırı değiştirmek sayıyı artırmaz: atma yok.
        let r = ajanda_ornek_durumu_uygula(&k, &son, KayitDurumu::Iptal, &yeni);
        let OrnekDurumuSonucu::Tamam { ornekler, atilan, .. } = r else { panic!("{r:?}") };
        assert_eq!(ornekler.len(), ORNEK_ADET);
        assert!(atilan.is_empty());

        // Yeni satır: en eski atılır.
        let r = ajanda_ornek_durumu_uygula(&k, &yeni, KayitDurumu::Tamam, &yeni);
        let OrnekDurumuSonucu::Tamam { ornekler, atilan, .. } = r else { panic!("{r:?}") };
        assert_eq!(tarihler(&atilan), ["2026-11-02"]);
        assert_eq!(ornekler.len(), ORNEK_ADET);
        assert_eq!(ornekler.last().unwrap().tarih, yeni);

        // Bugün ilk satırın kendisi: ondan önce satır yok, yer açılamaz.
        let r = ajanda_ornek_durumu_uygula(&k, &yeni, KayitDurumu::Tamam, "2026-11-02");
        assert_eq!(r, OrnekDurumuSonucu::Gecersiz);
    }
}
