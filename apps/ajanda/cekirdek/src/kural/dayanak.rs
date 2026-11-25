//! SAHİBİ: R1. Modelin dayanağı (`ajanda-kural.ts` `dayanakGecerliMi`). Uygulama kullanmaz (araç
//! yolu servistedir) ama sözleşme iki vektör dosyasının da birebir geçmesini ister.
//! Vektör: `ajanda-kurallar.json` `dayanak`.

use crate::model::YerelAn;
use crate::model::sinirlar::ajanda::DAYANAK_SAPMA_DK;
use crate::model::takvim::{dakika_no, saat_gecerli_mi};

/// `dayanak.saat_dilimi` verilmişse mesaj anınınkiyle aynı, `tarih` mesaj anının yerel günüyle aynı ve
/// saat farkı en çok `DAYANAK_SAPMA_DK` dakika. Duvar saatiyle, dilim veritabanısız; gün eşitliği şart.
/// `HH:MM` biçiminde olmayan saat reddedilir (başvuruda `Number` NaN verir ve karşılaştırma düşer).
pub fn dayanak_gecerli_mi(tarih: &str, saat: &str, saat_dilimi: Option<&str>, mesaj_ani: &YerelAn) -> bool {
    if saat_dilimi.is_some_and(|d| d != mesaj_ani.saat_dilimi) {
        return false;
    }
    if tarih != mesaj_ani.tarih {
        return false;
    }
    if !saat_gecerli_mi(saat) || !saat_gecerli_mi(&mesaj_ani.saat) {
        return false;
    }
    (dakika_no(saat) - dakika_no(&mesaj_ani.saat)).abs() <= DAYANAK_SAPMA_DK
}

#[cfg(test)]
mod testler {
    use super::*;

    fn an(tarih: &str, saat: &str) -> YerelAn {
        YerelAn { tarih: tarih.into(), saat: saat.into(), saat_dilimi: "Europe/Istanbul".into() }
    }

    #[test]
    fn dilim_verilmezse_denetlenmez() {
        assert!(dayanak_gecerli_mi("2026-11-25", "14:30", None, &an("2026-11-25", "14:30")));
        assert!(dayanak_gecerli_mi("2026-11-25", "14:30", Some("Europe/Istanbul"), &an("2026-11-25", "14:30")));
        assert!(!dayanak_gecerli_mi("2026-11-25", "14:30", Some("UTC"), &an("2026-11-25", "14:30")));
    }

    #[test]
    fn sinirlar() {
        let m = an("2026-11-25", "00:05");
        assert!(dayanak_gecerli_mi("2026-11-25", "00:00", None, &m));
        assert!(dayanak_gecerli_mi("2026-11-25", "00:15", None, &m));
        assert!(!dayanak_gecerli_mi("2026-11-25", "00:16", None, &m));
        // Gün farklıysa saat ne kadar yakın olursa olsun ret.
        assert!(!dayanak_gecerli_mi("2026-11-24", "23:59", None, &m));
    }

    #[test]
    fn bicimsiz_saat_reddedilir() {
        let m = an("2026-11-25", "10:00");
        assert!(!dayanak_gecerli_mi("2026-11-25", "10:0", None, &m));
        assert!(!dayanak_gecerli_mi("2026-11-25", "1000", None, &m));
        assert!(!dayanak_gecerli_mi("2026-11-25", "10:00", None, &an("2026-11-25", "xx:yy")));
    }
}
