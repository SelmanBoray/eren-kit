//! Sözleşme vektörlerinin yerel kipin yazarına karşı koşusu (D1): servisin `islemCalistir` kuralları yerelde
//! de aynı sonucu vermeli (`YOL-HARITASI.md` 3.6, "aynı vektörleri iki tarafa koşturmak"). Köprü yüzeyinden
//! (`Cekirdek`) geçer: vektörün kaydı görünen kopyaya konur, işlem `duzenle`/`durum_degistir` ile yapılır,
//! sonuç kalıcı kayıttan okunur.
//!
//! Koşturulabilen bölümler: `ornek_durumu` (hepsi) ve `birlestirme`'nin insan elle yazarlı vektörleri
//! (yerelde yalnız insan yazar; araç ve arka plan yazarı yerelde yoktur). Öteki bölümler saf kural ya da
//! kanal vektörüdür; `tests/vektorler.rs` onları zaten koşturur.

mod ortak;

use ajanda_cekirdek::CekirdekHatasi;
use ajanda_cekirdek::depo::Depo;
use ajanda_cekirdek::kural::AnCevirici;
use ajanda_cekirdek::model::{
    self, AjandaKaydi, AjandaOrnegi, AjandaZamani, Alan, AlanDegisikligi, KayitDurumu, KayitGovdesi,
};
use ortak::*;
use serde_json::{Value, json};
use std::path::PathBuf;

fn kurallar() -> Value {
    let dizin = std::env::var_os("AJANDA_VEKTOR_DIZINI")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../phone/protocol/vektorler"));
    let yol = dizin.join("ajanda-kurallar.json");
    serde_json::from_str(&std::fs::read_to_string(&yol).unwrap_or_else(|e| panic!("{}: {e}", yol.display()))).unwrap()
}

fn ornekler_json(l: &[AjandaOrnegi]) -> Value {
    Value::Array(l.iter().map(AjandaOrnegi::json).collect())
}

/// `tests/vektorler.rs` `ornek_kaydi`: `ornekler_gunluk` kısaltmasını açar.
fn vektor_kaydi(v: &Value) -> AjandaKaydi {
    let mut v = v.clone();
    let h = v.as_object_mut().unwrap();
    if let Some(g) = h.remove("ornekler_gunluk") {
        let bas = model::takvim::tarih_gun_no(g["bas"].as_str().unwrap()).unwrap();
        let satirlar: Vec<Value> = (0..g["adet"].as_i64().unwrap())
            .map(|i| json!({"tarih": model::takvim::gun_no_tarih(bas + i), "durum": g["durum"]}))
            .collect();
        h.insert("ornekler".into(), Value::Array(satirlar));
    }
    AjandaKaydi::oku(&v, "").unwrap_or_else(|h| panic!("vektör kaydı: {} {}", h.yol, h.neden))
}

/// Yerel kipte, vektörün kaydı görünen kopyada olan hat.
fn yerel_hat(ad: &str, k: &AjandaKaydi) -> Hat {
    let h = Hat::yeni(ad);
    Depo::ac(&h.yol).unwrap().gorunen_yaz(k, false).unwrap();
    h
}

fn kalici(h: &Hat, kayit_id: &str) -> AjandaKaydi {
    h.c.kayit(kayit_id.into()).unwrap().expect("kayıt").kayit
}

fn gecmis_sayisi(h: &Hat, kayit_id: &str) -> i64 {
    Depo::ac(&h.yol).unwrap().yerel_gecmis_sayisi(kayit_id).unwrap()
}

/// Bir vektör; `Err` farkı anlatır.
fn ornek_vektoru(i: usize, o: &Value) -> Result<(), String> {
    let k = vektor_kaydi(&o["kayit"]);
    let h = yerel_hat(&format!("vektor-ornek-{i}"), &k);
    let dilim = match &k.zaman {
        Some(AjandaZamani::An { saat_dilimi, .. }) | Some(AjandaZamani::Gun { saat_dilimi, .. }) => saat_dilimi.clone(),
        _ => IST.to_string(),
    };
    let bugun = o["bugun"].as_str().unwrap();
    h.zaman.ayarla(cevirici().ana_cevir(bugun, "12:00", &dilim).map_err(|e| e.mesaj)?);
    let durum = KayitDurumu::coz(o["durum"].as_str().unwrap()).unwrap();
    let tarih = o["ornek_tarihi"].as_str().unwrap().to_string();
    let r = h.c.durum_degistir(k.kayit_id.clone(), durum, Some(tarih.clone()));
    let s = &o["sonuc"];
    let sonra = kalici(&h, &k.kayit_id);
    if !s["ok"].as_bool().unwrap() {
        if !matches!(&r, Err(CekirdekHatasi::GecersizGirdi { alan, .. }) if alan == "ornek_tarihi") {
            return Err(format!("ornek_gecersiz beklenirdi: {r:?}"));
        }
        return if sonra == k && gecmis_sayisi(&h, &k.kayit_id) == 0 { Ok(()) } else { Err("ret yazdı".into()) };
    }
    r.map_err(|h| format!("kabul beklenirdi: {h}"))?;
    if !s["degisti"].as_bool().unwrap() {
        return if sonra == k && gecmis_sayisi(&h, &k.kayit_id) == 0 { Ok(()) } else { Err("yan etkisiz işlem yazdı".into()) };
    }
    if sonra.revizyon <= k.revizyon || gecmis_sayisi(&h, &k.kayit_id) != 1 {
        return Err(format!("revizyon {} -> {} ya da geçmiş satırı yok", k.revizyon, sonra.revizyon));
    }
    if let Some(l) = s.get("ornekler")
        && &ornekler_json(&sonra.ornekler) != l
    {
        return Err(format!("ornekler {} != {l}", ornekler_json(&sonra.ornekler)));
    }
    if let Some(n) = s.get("ornek_sayisi") {
        let ozet = (sonra.ornekler.len() as i64, sonra.ornekler.first().map(|o| o.tarih.as_str()), sonra.ornekler.last().map(|o| o.tarih.as_str()));
        if ozet != (n.as_i64().unwrap(), s["ilk"].as_str(), s["son"].as_str()) {
            return Err(format!("örnek özeti {ozet:?}"));
        }
    }
    // Atılan satır varsa geçmiş iki tam listeyi taşır (servis `durumUygula`).
    h.c.gecmis_iste(k.kayit_id.clone(), None).unwrap();
    let satir = h.c.gecmis(k.kayit_id.clone()).unwrap().unwrap().satirlar.remove(0);
    let atildi = !s["atilan"].as_array().unwrap().is_empty();
    if satir.alanlar.contains(&"ornekler".to_string()) != atildi || satir.ornek_tarihi.as_deref() != Some(&tarih) {
        return Err(format!("geçmiş satırı: {:?} {:?} (atılan var: {atildi})", satir.alanlar, satir.ornek_tarihi));
    }
    Ok(())
}

#[test]
fn ornek_durumu_vektorleri_yerel_yazarda() {
    let v = kurallar();
    let l = v["ornek_durumu"].as_array().unwrap();
    assert!(!l.is_empty());
    let kalan: Vec<String> =
        l.iter().enumerate().filter_map(|(i, o)| ornek_vektoru(i, o).err().map(|f| format!("{}: {f}", o["ad"]))).collect();
    assert!(kalan.is_empty(), "{} / {} vektör kaldı:\n{}", kalan.len(), l.len(), kalan.join("\n"));
}

/// Değişikliğin gövde alanları kayda uygulanmış gövde (formun kaydedeceği).
fn hedef_govde(k: &AjandaKaydi, d: &AlanDegisikligi) -> KayitGovdesi {
    fn uclu<T: Clone>(eski: &Option<T>, a: &Alan<T>) -> Option<T> {
        match a {
            Alan::Yok => eski.clone(),
            Alan::Kaldir => None,
            Alan::Deger(v) => Some(v.clone()),
        }
    }
    KayitGovdesi {
        tur: d.tur.unwrap_or(k.tur),
        baslik: d.baslik.clone().unwrap_or_else(|| k.baslik.clone()),
        aciklama: uclu(&k.aciklama, &d.aciklama),
        zaman: uclu(&k.zaman, &d.zaman),
        hatirlatmalar: d.hatirlatmalar.clone().unwrap_or_else(|| k.hatirlatmalar.clone()),
        tekrar: uclu(&k.tekrar, &d.tekrar),
    }
}

fn birlestirme_vektoru(i: usize, o: &Value) -> Result<(), String> {
    let k = vektor_kaydi(&o["kayit"]);
    let d = AlanDegisikligi::oku(&o["degisiklik"], "").map_err(|h| format!("{} {}", h.yol, h.neden))?;
    let h = yerel_hat(&format!("vektor-birlestirme-{i}"), &k);
    h.c.duzenle(k.kayit_id.clone(), None, hedef_govde(&k, &d)).map_err(|h| format!("duzenle: {h}"))?;
    if let Some(durum) = d.durum {
        h.c.durum_degistir(k.kayit_id.clone(), durum, None).map_err(|h| format!("durum: {h}"))?;
    }
    let sonra = kalici(&h, &k.kayit_id);
    let bek = &o["beklenen"];
    let liste = |a: &str| bek[a].as_array().map(|l| l.iter().map(|x| x.as_str().unwrap().to_string()).collect::<Vec<_>>());
    let adlar: Vec<String> = sonra.elle_alanlar.iter().map(|a| a.ad().to_string()).collect();
    if Some(adlar.clone()) != liste("elle_alanlar") {
        return Err(format!("elle_alanlar {adlar:?} != {:?}", liste("elle_alanlar")));
    }
    let uygulandi = !liste("uygulanan").unwrap_or_default().is_empty();
    if uygulandi != (sonra.revizyon > k.revizyon) {
        return Err(format!("uygulanan {:?}, revizyon {} -> {}", liste("uygulanan"), k.revizyon, sonra.revizyon));
    }
    if let Some(x) = bek.get("ornekler")
        && &ornekler_json(&sonra.ornekler) != x
    {
        return Err(format!("ornekler {}", ornekler_json(&sonra.ornekler)));
    }
    if let Some(x) = bek.get("hatirlatmalar")
        && &model::zaman::hatirlatmalari_yaz(&sonra.hatirlatmalar) != x
    {
        return Err("hatirlatmalar".into());
    }
    let j = sonra.json();
    if let Some(a) = liste("kaldirilan").unwrap_or_default().iter().find(|a| j.get(a.as_str()).is_some()) {
        return Err(format!("kaldırılmalıydı: {a}"));
    }
    Ok(())
}

#[test]
fn birlestirme_vektorlerinin_insan_elle_olanlari_yerel_yazarda() {
    let v = kurallar();
    let l: Vec<&Value> = v["birlestirme"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|o| o["yazar"] == json!({"yol": "elle", "tur_kokeni": "insan"}))
        .collect();
    assert!(!l.is_empty());
    let kalan: Vec<String> =
        l.iter().enumerate().filter_map(|(i, o)| birlestirme_vektoru(i, o).err().map(|f| format!("{}: {f}", o["ad"]))).collect();
    assert!(kalan.is_empty(), "{} / {} vektör kaldı:\n{}", kalan.len(), l.len(), kalan.join("\n"));
}
