//! Tekrar kuralı (`ajanda-zaman.ts` "Tekrar", RFC 5545 altkümesi) ve örnek günleri
//! (`tekrarOrnekleri`, `ornekGunuMu`, `ornekGunleriMi`). Kayıt şeması (`ornekler` serinin günü mü)
//! bunlara dayandığı için veri modelinin parçasıdır.

use super::json::{Nesne, Sonuc, Yazici, dizi_oku, dizi_yaz, hata, sabit_liste, tam_sayi};
use super::sinirlar::ajanda::{TEKRAR_ADET, TEKRAR_ARALIK, YIL_MAX};
use super::takvim::{aydaki_gun, gercek_tarih_mi, gun_no, gun_no_tarih, hafta_gunu_no_gun, tarih_gun_no, tarih_parcala};
use super::zaman::tarih_oku;
use serde_json::Value;

sabit_liste! {
    /// `HAFTA_GUNLERI`: pazartesi başlar.
    HaftaGunu { Pzt = "pzt", Sal = "sal", Car = "car", Per = "per", Cum = "cum", Cmt = "cmt", Paz = "paz" }
}

sabit_liste! {
    TekrarSikligi { Gunluk = "gunluk", Haftalik = "haftalik", Aylik = "aylik", Yillik = "yillik" }
}

/// `Tekrar`. Çapa kaydın `zaman.tarih`'idir. `gunler` yalnız haftalıkta (hafta sırasıyla, tekil);
/// `bitis_tarihi` ile `adet` birlikte olmaz; ikisi de yoksa sonsuz.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Tekrar {
    pub siklik: TekrarSikligi,
    pub aralik: i32,
    pub gunler: Option<Vec<HaftaGunu>>,
    pub bitis_tarihi: Option<String>,
    pub adet: Option<i32>,
}

impl Tekrar {
    pub fn oku(v: &Value, yol: &str) -> Sonuc<Self> {
        let mut n = Nesne::ac(v, yol)?;
        let siklik = n.zorunlu("siklik", TekrarSikligi::oku)?;
        let aralik = n.zorunlu("aralik", |v, y| tam_sayi(v, y, 1, TEKRAR_ARALIK))? as i32;
        let gunler = n.istege_bagli("gunler", |v, y| {
            let l = dizi_oku(v, y, 7, HaftaGunu::oku)?;
            if l.is_empty() { hata(y, "en az bir gün") } else { Ok(l) }
        })?;
        let bitis_tarihi = n.istege_bagli("bitis_tarihi", tarih_oku)?;
        let adet = n.istege_bagli("adet", |v, y| tam_sayi(v, y, 1, TEKRAR_ADET))?.map(|a| a as i32);
        let yol_gunler = n.alan_yolu("gunler");
        let yol_adet = n.alan_yolu("adet");
        n.bitir()?;
        if let Some(g) = &gunler {
            if siklik != TekrarSikligi::Haftalik {
                return hata(&yol_gunler, "gunler yalnız haftalık tekrarda");
            }
            if !g.windows(2).all(|w| w[0] < w[1]) {
                return hata(&yol_gunler, "gunler hafta sırasıyla ve tekil");
            }
        }
        if bitis_tarihi.is_some() && adet.is_some() {
            return hata(&yol_adet, "bitis_tarihi ile adet birlikte olmaz");
        }
        Ok(Tekrar { siklik, aralik, gunler, bitis_tarihi, adet })
    }

    pub fn json(&self) -> Value {
        Yazici::yeni()
            .alan("siklik", self.siklik.json())
            .alan("aralik", self.aralik)
            .varsa("gunler", self.gunler.as_ref().map(|g| dizi_yaz(g, |d| d.json())))
            .varsa("bitis_tarihi", self.bitis_tarihi.clone())
            .varsa("adet", self.adet)
            .bitir()
    }
}

/// Sonsuz aday (yıl sınırı aşıldı): `son_no`'dan büyük olduğu için yürüyüşü bitirir.
const SONSUZ: i64 = i64::MAX;

enum Kip {
    Adimli { adim: i64 },
    HaftaGunlu { hafta0: i64, sira: Vec<i64>, adim: i64 },
    Aylik { ay0: i64, capa_gun: i64 },
    Yillik { capa_yil: i64, capa_ay: i64, capa_gun: i64 },
}

/// `tekrarOrnekleri(capa, t, enAz)`: örnek günleri artan sırayla (sonsuz olabilir; `take` ile sınırla).
/// `capa` (ve verilmişse `en_az`, `bitis_tarihi`) geçerli tarih olmalı; değilse yineleyici boştur.
pub struct TekrarOrnekleri {
    kip: Kip,
    aralik: i64,
    adet: Option<i64>,
    capa_no: i64,
    son_no: i64,
    en_az_no: i64,
    k: i64,
    adaylar: Vec<i64>,
    sira: usize,
    sayac: i64,
    bitti: bool,
}

pub fn tekrar_ornekleri(capa: &str, t: &Tekrar, en_az: Option<&str>) -> TekrarOrnekleri {
    let bos = || TekrarOrnekleri {
        kip: Kip::Adimli { adim: 1 },
        aralik: 1,
        adet: None,
        capa_no: 0,
        son_no: 0,
        en_az_no: 0,
        k: 0,
        adaylar: Vec::new(),
        sira: 0,
        sayac: 0,
        bitti: true,
    };
    let (Some(capa_no), Some((capa_yil, capa_ay, capa_gun))) = (tarih_gun_no(capa), tarih_parcala(capa)) else {
        return bos();
    };
    let bitis_no = match &t.bitis_tarihi {
        None => SONSUZ,
        Some(b) => match tarih_gun_no(b) {
            Some(n) => n,
            None => return bos(),
        },
    };
    let son_no = bitis_no.min(gun_no(YIL_MAX, 12, 31));
    let en_az_no = match en_az {
        None => capa_no,
        Some(e) => match tarih_gun_no(e) {
            Some(n) => capa_no.max(n),
            None => return bos(),
        },
    };
    // Adet sayılacaksa çapadan yürünür (en çok TEKRAR_ADET örnek); yoksa en_az'a atlanır.
    let bas_no = if t.adet.is_none() { en_az_no } else { capa_no };
    let (bas_yil, bas_ay, _) = tarih_parcala(&gun_no_tarih(bas_no)).unwrap_or((capa_yil, capa_ay, capa_gun));
    let aralik = i64::from(t.aralik.max(1));
    let (kip, k0) = match (t.siklik, &t.gunler) {
        (TekrarSikligi::Gunluk, _) | (TekrarSikligi::Haftalik, None) => {
            let adim = if t.siklik == TekrarSikligi::Gunluk { aralik } else { 7 * aralik };
            (Kip::Adimli { adim }, 0.max((bas_no - capa_no).div_euclid(adim)))
        }
        (TekrarSikligi::Haftalik, Some(gunler)) => {
            let hafta0 = capa_no - hafta_gunu_no_gun(capa_no);
            let sira = gunler.iter().map(|g| *g as i64).collect();
            let adim = 7 * aralik;
            (Kip::HaftaGunlu { hafta0, sira, adim }, 0.max((bas_no - hafta0).div_euclid(adim)))
        }
        (TekrarSikligi::Aylik, _) => {
            let ay0 = capa_yil * 12 + (capa_ay - 1);
            (Kip::Aylik { ay0, capa_gun }, 0.max((bas_yil * 12 + (bas_ay - 1) - ay0).div_euclid(aralik)))
        }
        (TekrarSikligi::Yillik, _) => {
            (Kip::Yillik { capa_yil, capa_ay, capa_gun }, 0.max((bas_yil - capa_yil).div_euclid(aralik)))
        }
    };
    TekrarOrnekleri {
        kip,
        aralik,
        adet: t.adet.map(i64::from),
        capa_no,
        son_no,
        en_az_no,
        k: k0,
        adaylar: Vec::new(),
        sira: 0,
        sayac: 0,
        bitti: false,
    }
}

impl TekrarOrnekleri {
    /// Dönem `k`'nın aday günleri (artan).
    fn adaylar(&self, k: i64) -> Vec<i64> {
        match &self.kip {
            Kip::Adimli { adim } => vec![self.capa_no + k * adim],
            Kip::HaftaGunlu { hafta0, sira, adim } => sira.iter().map(|s| hafta0 + k * adim + s).collect(),
            Kip::Aylik { ay0, capa_gun } => {
                let ay = ay0 + k * self.aralik;
                let yil = ay.div_euclid(12);
                let ay_no = ay.rem_euclid(12) + 1;
                if yil > YIL_MAX {
                    return vec![SONSUZ];
                }
                if *capa_gun <= aydaki_gun(yil, ay_no) { vec![gun_no(yil, ay_no, *capa_gun)] } else { vec![] }
            }
            Kip::Yillik { capa_yil, capa_ay, capa_gun } => {
                let yil = capa_yil + k * self.aralik;
                if yil > YIL_MAX {
                    return vec![SONSUZ];
                }
                if *capa_gun <= aydaki_gun(yil, *capa_ay) { vec![gun_no(yil, *capa_ay, *capa_gun)] } else { vec![] }
            }
        }
    }
}

impl Iterator for TekrarOrnekleri {
    type Item = String;

    fn next(&mut self) -> Option<String> {
        loop {
            if self.bitti {
                return None;
            }
            if self.sira >= self.adaylar.len() {
                self.adaylar = self.adaylar(self.k);
                self.k += 1;
                self.sira = 0;
                continue;
            }
            let gun = self.adaylar[self.sira];
            self.sira += 1;
            if gun > self.son_no {
                self.bitti = true;
                return None;
            }
            if gun < self.capa_no {
                continue;
            }
            self.sayac += 1;
            if self.adet.is_some_and(|a| self.sayac > a) {
                self.bitti = true;
                return None;
            }
            if gun >= self.en_az_no {
                return Some(gun_no_tarih(gun));
            }
        }
    }
}

/// `ornekGunuMu`: `tarih` serinin bir örnek günü mü.
pub fn ornek_gunu_mu(capa: &str, t: &Tekrar, tarih: &str) -> bool {
    if !gercek_tarih_mi(tarih) || tarih < capa {
        return false;
    }
    tekrar_ornekleri(capa, t, Some(tarih)).next().is_some_and(|g| g == tarih)
}

/// `ornekGunleriMi`: artan sıralı `tarihler`in hepsi örnek günü mü (adetli seride tek yürüyüşle).
pub fn ornek_gunleri_mi(capa: &str, t: &Tekrar, tarihler: &[&str]) -> bool {
    if tarihler.is_empty() {
        return true;
    }
    if t.adet.is_none() {
        return tarihler.iter().all(|d| ornek_gunu_mu(capa, t, d));
    }
    let mut i = 0;
    for gun in tekrar_ornekleri(capa, t, None) {
        if tarihler[i] < gun.as_str() {
            return false;
        }
        if tarihler[i] == gun {
            i += 1;
        }
        if i == tarihler.len() {
            return true;
        }
    }
    false
}
