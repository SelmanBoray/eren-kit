//! Servis ile uygulamanın aynı sonucu vermesi gereken saf kurallar (`ajanda.ts` "Saf yardımcılar",
//! `ajanda-kural.ts`, `ajanda-zaman.ts` temizlik). Depo, köprü ve saat bilmezler: zaman çağırandan
//! (`simdi_ms`, `bugun`) ve `AnCevirici`'den gelir. Her dosyanın sahibi `MIMARI.md`'de yazılıdır;
//! imzalar ikinci dalgada değişmez, yalnız gövdeler dolar.
//!
//! Bütün kurallar yazıldı. `Yazilmadi` panik yükü yine de durur: yeni bir kural yarım bırakılırsa
//! `std::panic::panic_any(Yazilmadi("parça"))` atar; vektör düzeneği bunu "bekliyor" sayar
//! (sessizce atlamaz), köprü `CekirdekHatasi::Yazilmadi`'ya çevirir.

pub mod birlesim;
pub mod dayanak;
pub mod esitleme;
pub mod hatirlatma;
pub mod kuyruk;
pub mod metin;
pub mod ornek;
pub mod tekil;
pub mod telafi;

use crate::model::YerelAn;
use std::collections::BTreeMap;

/// Yazılmamış kuralın panik yükü (parça adı). Vektör düzeneği `catch_unwind` ile tanır.
#[derive(Debug, Clone, Copy)]
pub struct Yazilmadi(pub &'static str);

/// Dilim veritabanının bilmediği ya da çevrilemeyen yerel an.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ZamanHatasi {
    pub mesaj: String,
}

/// Duvar saati <-> an çevirisi (`AnCevirici`). Uygulamada java.time (`ZamanKabugu`, köprü üzerinden):
/// `ZonedDateTime.of` kuralı, yaz saati boşluğunda boşluk kadar ileri, çakışmada önceki ofset.
/// Vektörler ve Rust testleri `SabitOfsetCevirici` kullanır.
pub trait AnCevirici {
    /// Yerel `tarih` + `saat` (`HH:MM`) + IANA dilimi -> epoch milisaniyesi.
    fn ana_cevir(&self, tarih: &str, saat: &str, saat_dilimi: &str) -> Result<i64, ZamanHatasi>;
    /// Epoch milisaniyesi -> o dilimdeki yerel an (dakikaya kesilmiş saat).
    fn yerele_cevir(&self, an_ms: i64, saat_dilimi: &str) -> Result<YerelAn, ZamanHatasi>;
}

/// Sabit ofsetli dilimler (dakika, UTC'nin doğusu artı): vektörlerin `ofset_dk` tablosu ve testler.
#[derive(Debug, Clone, Default)]
pub struct SabitOfsetCevirici {
    ofsetler: BTreeMap<String, i64>,
}

impl SabitOfsetCevirici {
    pub fn yeni<S: Into<String>>(ofsetler: impl IntoIterator<Item = (S, i64)>) -> Self {
        SabitOfsetCevirici { ofsetler: ofsetler.into_iter().map(|(d, o)| (d.into(), o)).collect() }
    }

    fn ofset(&self, dilim: &str) -> Result<i64, ZamanHatasi> {
        self.ofsetler.get(dilim).copied().ok_or_else(|| ZamanHatasi { mesaj: format!("bilinmeyen dilim: {dilim}") })
    }
}

impl AnCevirici for SabitOfsetCevirici {
    fn ana_cevir(&self, tarih: &str, saat: &str, saat_dilimi: &str) -> Result<i64, ZamanHatasi> {
        let ofset = self.ofset(saat_dilimi)?;
        let gun = crate::model::takvim::tarih_gun_no(tarih).ok_or_else(|| ZamanHatasi { mesaj: "geçersiz tarih".into() })?;
        if !crate::model::takvim::saat_gecerli_mi(saat) {
            return Err(ZamanHatasi { mesaj: "geçersiz saat".into() });
        }
        Ok((gun * 1440 + crate::model::takvim::dakika_no(saat) - ofset) * 60_000)
    }

    fn yerele_cevir(&self, an_ms: i64, saat_dilimi: &str) -> Result<YerelAn, ZamanHatasi> {
        let dakika = (an_ms.div_euclid(60_000)) + self.ofset(saat_dilimi)?;
        let gun = dakika.div_euclid(1440);
        let gun_ici = dakika.rem_euclid(1440);
        Ok(YerelAn {
            tarih: crate::model::takvim::gun_no_tarih(gun),
            saat: format!("{:02}:{:02}", gun_ici / 60, gun_ici % 60),
            saat_dilimi: saat_dilimi.to_string(),
        })
    }
}

#[cfg(test)]
mod testler {
    use super::*;

    #[test]
    fn sabit_ofset_gidip_gelir() {
        let c = SabitOfsetCevirici::yeni([("Etc/GMT-3", 180), ("UTC", 0)]);
        // 2026-11-25 14:30 UTC+3 = 11:30 UTC (vektörlerin simdi_ms'i).
        assert_eq!(c.ana_cevir("2026-11-25", "14:30", "Etc/GMT-3").unwrap(), 1_795_606_200_000);
        let y = c.yerele_cevir(1_795_606_200_000, "UTC").unwrap();
        assert_eq!((y.tarih.as_str(), y.saat.as_str()), ("2026-11-25", "11:30"));
        assert!(c.ana_cevir("2026-11-25", "14:30", "Europe/Istanbul").is_err());
    }
}
