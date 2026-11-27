//! Takvim sekmesinin sorguları (yerel, salt okuma; sözleşmeye dokunmaz): ay ızgarasının gün özetleri ve
//! şeritleri (`takvim_ayi`), seçili günün öğeleri (`takvim_gunu`). Yalnız `Depo` (görünen kopya) ve
//! `AnCevirici` okur: köprü onları motor kilidini almadan okuma bağlantısında çalıştırır.
//!
//! Kurallar (Tarihli sekmesinin bugünkü davranışı, `android/.../ekran/Liste.kt`):
//! - **Gün sınırı cihazın şimdiki dilimidir.** Saatli kayıt (`an`) kendi diliminden cihaz dilimine
//!   çevrilir (`AnCevirici`; uygulamada java.time `ZonedDateTime.of` + `withZoneSameInstant`: yaz saati
//!   boşluğunda ileri, çakışmada önceki ofset). Kaydın dilimi çevrilemezse duvar saati cihazın saati sayılır
//!   (Kotlin `dilimVeya`). Saatsiz gün ve dönem takvim günüdür, çevrilmez. Çekirdekte dilim veritabanı yok.
//! - **Gün içi sıra:** gün bölümü olmayan saatsizler (bölümsüz `gun`, `donem`), sonra bölümlüler bölüm
//!   sırasıyla (sabah .. gece), sonra saatliler cihaz saatine göre; önceki günden süren saatli öğe
//!   saatlilerin başındadır. Eşitlikte ilk gün, oluşturma anı, kimlik, örnek günü. Saatten bölüm türetilmez.
//! - **Çok günlü öğe** (dönem; süresi gece yarısını aşan saatli kayıt) kapsadığı her günde görünür ve ilk/son
//!   gününü taşır; ayda ayrıca şerittir. Süre tam gece yarısında bitiyorsa ertesi gün kapsanmaz.
//! - **Tekrar** (`an`/`gun` + `tekrar`, sözleşmenin `tekrarOrnekleri`'si) pencerede örneklerine açılır.
//!   Örneğin durumu `ornekler` satırıdır, satır yoksa serinin durumu (`tamam` seri bütün örnekleriyle kapalı).
//!   Saatli seride örnek, kaydın diliminde örnek gününün aynı saatidir; cihaz gününe çevrilir.
//! - **Görünürlük** (Tarihli sekmesiyle aynı): silinmiş hiç görünmez; taslak görünür (kayıt `taslak`,
//!   özette ayrıca sayılır); `tamam`/`iptal` (örnekte de) yalnız `kapalilar_dahil` iken.
//!
//! Hız: adaylar tek SQL sorgusudur (`Depo::gorunen_takvim_adaylari`: sıra anahtarı aralığı dizinden, pencere
//! öncesindeki satırlarda yalnız `json_extract`); yalnız adaylar ayrıştırılır. Saatli öğe başına iki
//! (süreliyse üç) `ZamanKabugu` çağrısı yapılır.

use std::cmp::{Ordering, Reverse};

use crate::depo::{Depo, GorunenKayit, TakvimAdayAraligi};
use crate::hata::CekirdekHatasi;
use crate::kopru::tipler::{KayitGorunumu, TakvimAyi, TakvimGunOzeti, TakvimOgesi, TakvimSeridi};
use crate::kural::AnCevirici;
use crate::model::sinirlar::ajanda::{DONEM_GUN, SURE_DK, YIL_MAX, YIL_MIN};
use crate::model::takvim::{aydaki_gun, dakika_no, gun_no, gun_no_tarih, saat_gecerli_mi, tarih_gun_no, tarih_parcala};
use crate::model::{AjandaKaydi, AjandaZamani, KayitDurumu, KayitTuru, OrnekDurumu, tekrar_ornekleri};

/// Kaydın kendi takvimindeki gün ile cihaz günü arasındaki en büyük fark (ofsetler −12..+14 saat: 26 saat).
const DILIM_PAYI_GUN: i64 = 2;
/// Süreli saatli öğenin başladığı günden sonra en çok kaplayabileceği gün (`SURE_DK` = 7 gün).
const SURE_PAYI_GUN: i64 = (SURE_DK + 1439) / 1440;

/// Penceredeki bir öğe (kayıt ya da tekrarın örneği) ve cihaz günlerindeki yeri.
struct Yer<'a> {
    g: &'a GorunenKayit,
    ornek_tarihi: Option<String>,
    durum: KayitDurumu,
    ilk: i64,
    son: i64,
    saat: Option<String>,
    bitis_saati: Option<String>,
}

/// Yıl sınırı denetlemeden gün numarası (çevrilen an sınır dışına düşebilir).
fn gun(tarih: &str) -> Option<i64> {
    tarih_parcala(tarih).map(|(y, a, g)| gun_no(y, a, g))
}

fn saat_metni(dk: i64) -> String {
    format!("{:02}:{:02}", dk / 60, dk % 60)
}

/// Saatli öğenin cihaz günlerindeki yeri: (ilk gün, başlangıç saati, son gün, bitiş saati).
fn saatli_yer(
    c: &dyn AnCevirici,
    cihaz: &str,
    tarih: &str,
    saat: &str,
    dilim: &str,
    sure_dk: Option<i32>,
) -> Option<(i64, String, i64, Option<String>)> {
    let sure_ms = sure_dk.map(|d| i64::from(d) * 60_000);
    let cevrilmis = c.ana_cevir(tarih, saat, dilim).ok().and_then(|ms| {
        let bas = c.yerele_cevir(ms, cihaz).ok()?;
        let bit = match sure_ms {
            Some(s) => Some(c.yerele_cevir(ms + s, cihaz).ok()?),
            None => None,
        };
        Some((gun(&bas.tarih)?, bas.saat, bit.map(|b| (gun(&b.tarih), b.saat))))
    });
    let (ilk, bas_saat, bitis) = match cevrilmis {
        Some((ilk, s, Some((Some(g), bs)))) => (ilk, s, Some((g, bs))),
        Some((_, _, Some((None, _)))) => return None,
        Some((ilk, s, None)) => (ilk, s, None),
        // Çevrilemedi: duvar saati cihazın saati (Kotlin `dilimVeya` ile aynı).
        None => {
            if !saat_gecerli_mi(saat) {
                return None;
            }
            let bas_dk = gun(tarih)? * 1440 + dakika_no(saat);
            let bitis = sure_dk.map(|d| {
                let b = bas_dk + i64::from(d);
                (b.div_euclid(1440), saat_metni(b.rem_euclid(1440)))
            });
            (bas_dk.div_euclid(1440), saat.to_string(), bitis)
        }
    };
    let (son, bitis_saati) = match bitis {
        // Tam gece yarısında biten öğe ertesi günü kaplamaz.
        Some((g, s)) => ((if s == "00:00" && g > ilk { g - 1 } else { g }).max(ilk), Some(s)),
        None => (ilk, None),
    };
    Some((ilk, bas_saat, son, bitis_saati))
}

/// Örneğin durumu: `ornekler` satırı (tarih sıralı), yoksa serinin durumu.
fn ornek_durumu(k: &AjandaKaydi, tarih: &str) -> KayitDurumu {
    match k.ornekler.binary_search_by(|o| o.tarih.as_str().cmp(tarih)) {
        Ok(i) => match k.ornekler[i].durum {
            OrnekDurumu::Tamam => KayitDurumu::Tamam,
            OrnekDurumu::Iptal => KayitDurumu::Iptal,
        },
        Err(_) => k.durum,
    }
}

/// Adayları `[bas, son]` cihaz günleriyle kesişen öğelere açar (süzgeç dahil; sırasız).
fn yerler<'a>(
    kayitlar: &'a [GorunenKayit],
    c: &dyn AnCevirici,
    cihaz: &str,
    bas: i64,
    son: i64,
    kapalilar_dahil: bool,
) -> Vec<Yer<'a>> {
    let mut l = Vec::new();
    for g in kayitlar {
        let k = &g.kayit;
        if k.silindi {
            continue;
        }
        let mut ekle = |ornek_tarihi: Option<String>, ilk: i64, s: i64, saat: Option<String>, bitis_saati: Option<String>| {
            if s < bas || ilk > son {
                return;
            }
            let durum = ornek_tarihi.as_deref().map_or(k.durum, |t| ornek_durumu(k, t));
            if !kapalilar_dahil && durum != KayitDurumu::Acik {
                return;
            }
            l.push(Yer { g, ornek_tarihi, durum, ilk, son: s, saat, bitis_saati });
        };
        match (&k.zaman, &k.tekrar) {
            (Some(AjandaZamani::Donem { baslangic, bitis, .. }), _) => {
                if let (Some(a), Some(b)) = (gun(baslangic), gun(bitis)) {
                    ekle(None, a, b, None, None);
                }
            }
            (Some(AjandaZamani::Gun { tarih, .. }), None) => {
                if let Some(d) = gun(tarih) {
                    ekle(None, d, d, None, None);
                }
            }
            (Some(AjandaZamani::Gun { tarih, .. }), Some(t)) => {
                for o in tekrar_ornekleri(tarih, t, Some(&gun_no_tarih(bas))) {
                    let Some(d) = gun(&o) else { break };
                    if d > son {
                        break;
                    }
                    ekle(Some(o), d, d, None, None);
                }
            }
            (Some(AjandaZamani::An { tarih, saat, sure_dk, saat_dilimi, .. }), None) => {
                if let Some((ilk, s, son_gun, b)) = saatli_yer(c, cihaz, tarih, saat, saat_dilimi, *sure_dk) {
                    ekle(None, ilk, son_gun, Some(s), b);
                }
            }
            (Some(AjandaZamani::An { tarih, saat, sure_dk, saat_dilimi, .. }), Some(t)) => {
                let sure_payi = sure_dk.map_or(0, |d| (i64::from(d) + 1439) / 1440);
                let en_az = gun_no_tarih(bas - DILIM_PAYI_GUN - sure_payi);
                for o in tekrar_ornekleri(tarih, t, Some(&en_az)) {
                    let Some(d) = gun(&o) else { break };
                    if d > son + DILIM_PAYI_GUN {
                        break;
                    }
                    if let Some((ilk, s, son_gun, b)) = saatli_yer(c, cihaz, &o, saat, saat_dilimi, *sure_dk) {
                        ekle(Some(o), ilk, son_gun, Some(s), b);
                    }
                }
            }
            (Some(AjandaZamani::Belirsiz { .. }) | None, _) => {}
        }
    }
    l
}

/// Gün içi sıra anahtarının karşılaştırması (`gun` o günün numarası; modül başındaki kural).
fn sirala(a: &Yer, b: &Yer, gun: i64) -> Ordering {
    // (grup, bölüm, saat): 0 bölümsüz saatsiz, 1 bölümlü saatsiz, 2 saatli.
    fn anahtar<'y>(y: &'y Yer, gun: i64) -> (u8, Option<crate::model::GunBolumu>, &'y str) {
        match &y.g.kayit.zaman {
            Some(AjandaZamani::An { .. }) => {
                // Önceki günden süren saatli öğe saatlilerin başında.
                (2, None, if y.ilk == gun { y.saat.as_deref().unwrap_or("") } else { "" })
            }
            Some(AjandaZamani::Gun { gun_bolumu: Some(b), .. }) => (1, Some(*b), ""),
            _ => (0, None, ""),
        }
    }
    anahtar(a, gun)
        .cmp(&anahtar(b, gun))
        .then(a.ilk.cmp(&b.ilk))
        .then(a.g.kayit.olusturma_ms.cmp(&b.g.kayit.olusturma_ms))
        .then(a.g.kayit.kayit_id.cmp(&b.g.kayit.kayit_id))
        .then(a.ornek_tarihi.cmp(&b.ornek_tarihi))
}

/// `[bas, son]` cihaz günleriyle kesişebilecek kayıtlar (görünen kopyadan; kesin süzme `yerler`'de).
fn pencere(d: &Depo, bas: i64, son: i64, kapalilar_dahil: bool) -> Result<Vec<GorunenKayit>, CekirdekHatasi> {
    let pay = DILIM_PAYI_GUN + SURE_PAYI_GUN;
    let aralik = TakvimAdayAraligi {
        alt: gun_no_tarih(bas - pay),
        ust: gun_no_tarih(son + DILIM_PAYI_GUN + 1),
        donem_alt: gun_no_tarih(bas - DONEM_GUN),
        donem_bitis_alt: gun_no_tarih(bas),
        kapalilar_dahil,
    };
    Ok(d.gorunen_takvim_adaylari(&aralik)?)
}

fn gecersiz(alan: &str, neden: &str) -> CekirdekHatasi {
    CekirdekHatasi::GecersizGirdi { alan: alan.into(), neden: neden.into() }
}

/// Ay ızgarası: `yil` `YIL_MIN..=YIL_MAX`, `ay` 1-12 (değilse `GecersizGirdi{alan:"yil"|"ay"}`).
pub(crate) fn takvim_ayi(
    d: &Depo,
    c: &dyn AnCevirici,
    cihaz: &str,
    yil: i32,
    ay: i32,
    kapalilar_dahil: bool,
) -> Result<TakvimAyi, CekirdekHatasi> {
    let (y, a) = (i64::from(yil), i64::from(ay));
    if !(YIL_MIN..=YIL_MAX).contains(&y) {
        return Err(gecersiz("yil", "yıl sınır dışı"));
    }
    if !(1..=12).contains(&a) {
        return Err(gecersiz("ay", "ay 1-12 değil"));
    }
    let bas = gun_no(y, a, 1);
    let son = bas + aydaki_gun(y, a) - 1;
    let adaylar = pencere(d, bas, son, kapalilar_dahil)?;
    let yerler = yerler(&adaylar, c, cihaz, bas, son, kapalilar_dahil);

    let mut gunler: Vec<TakvimGunOzeti> =
        (bas..=son).map(|n| TakvimGunOzeti { tarih: gun_no_tarih(n), ..Default::default() }).collect();
    for y in &yerler {
        let k = &y.g.kayit;
        for n in y.ilk.max(bas)..=y.son.min(son) {
            let o = &mut gunler[(n - bas) as usize];
            o.toplam += 1;
            if y.durum == KayitDurumu::Acik {
                o.acik += 1;
            } else {
                o.kapali += 1;
            }
            if k.taslak {
                o.taslak += 1;
            }
            match k.tur {
                KayitTuru::Gorev => o.gorev += 1,
                KayitTuru::Randevu => o.randevu += 1,
                KayitTuru::Not => o.notlar += 1,
            }
            if y.ilk != y.son {
                o.serit += 1;
            }
        }
    }
    let mut seritler: Vec<&Yer> = yerler.iter().filter(|y| y.ilk != y.son).collect();
    seritler.sort_by(|a, b| {
        (a.ilk, Reverse(a.son), a.g.kayit.olusturma_ms, &a.g.kayit.kayit_id, &a.ornek_tarihi).cmp(&(
            b.ilk,
            Reverse(b.son),
            b.g.kayit.olusturma_ms,
            &b.g.kayit.kayit_id,
            &b.ornek_tarihi,
        ))
    });
    let seritler = seritler
        .into_iter()
        .map(|y| TakvimSeridi {
            kayit_id: y.g.kayit.kayit_id.clone(),
            ornek_tarihi: y.ornek_tarihi.clone(),
            baslik: y.g.kayit.baslik.clone(),
            tur: y.g.kayit.tur,
            durum: y.durum,
            taslak: y.g.kayit.taslak,
            ilk_gun: gun_no_tarih(y.ilk),
            son_gun: gun_no_tarih(y.son),
        })
        .collect();
    Ok(TakvimAyi { yil, ay, gunler, seritler })
}

/// Seçili günün öğeleri, ürün sırasıyla. `tarih` gerçek gün olmalı (değilse `GecersizGirdi{alan:"tarih"}`).
pub(crate) fn takvim_gunu(
    d: &Depo,
    c: &dyn AnCevirici,
    cihaz: &str,
    tarih: &str,
    kapalilar_dahil: bool,
) -> Result<Vec<TakvimOgesi>, CekirdekHatasi> {
    let Some(n) = tarih_gun_no(tarih) else { return Err(gecersiz("tarih", "takvimde olmayan gün ya da yıl sınır dışı")) };
    let adaylar = pencere(d, n, n, kapalilar_dahil)?;
    let mut yerler = yerler(&adaylar, c, cihaz, n, n, kapalilar_dahil);
    yerler.sort_by(|a, b| sirala(a, b, n));
    Ok(yerler
        .into_iter()
        .map(|y| TakvimOgesi {
            gorunum: KayitGorunumu { kayit: y.g.kayit.clone(), bekleyen: y.g.bekleyen },
            ornek_tarihi: y.ornek_tarihi,
            durum: y.durum,
            ilk_gun: gun_no_tarih(y.ilk),
            son_gun: gun_no_tarih(y.son),
            saat: y.saat,
            bitis_saati: y.bitis_saati,
        })
        .collect())
}

#[cfg(test)]
#[path = "takvim_testleri.rs"]
mod testler;
