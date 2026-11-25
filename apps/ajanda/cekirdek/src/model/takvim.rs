//! Takvim (`ajanda-zaman.ts` "Takvim"): tarih, saat ve dilim biçimleri, proleptik Gregoryen gün
//! numarası. Saat dilimi veritabanı kullanılmaz: dilim adının varlığını servis denetler, duvar
//! saatinden ana çeviri `kural::AnCevirici`'dir (uygulamada java.time).

use super::sinirlar::ajanda::{YIL_MAX, YIL_MIN};

/// `^(\d{4})-(\d{2})-(\d{2})$` (ASCII rakam).
pub fn tarih_parcala(metin: &str) -> Option<(i64, i64, i64)> {
    let b = metin.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    let sayi = |r: std::ops::Range<usize>| -> Option<i64> {
        b[r].iter().try_fold(0i64, |t, &c| c.is_ascii_digit().then(|| t * 10 + i64::from(c - b'0')))
    };
    Some((sayi(0..4)?, sayi(5..7)?, sayi(8..10)?))
}

pub fn artik_yil_mi(yil: i64) -> bool {
    (yil % 4 == 0 && yil % 100 != 0) || yil % 400 == 0
}

pub fn aydaki_gun(yil: i64, ay: i64) -> i64 {
    match ay {
        2 => {
            if artik_yil_mi(yil) { 29 } else { 28 }
        }
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// `gercekTarihMi`: `YYYY-MM-DD` gerçek bir gün ve `YIL_MIN..=YIL_MAX` içinde.
pub fn gercek_tarih_mi(metin: &str) -> bool {
    match tarih_parcala(metin) {
        Some((yil, ay, gun)) => {
            (YIL_MIN..=YIL_MAX).contains(&yil) && (1..=12).contains(&ay) && gun >= 1 && gun <= aydaki_gun(yil, ay)
        }
        None => false,
    }
}

/// Gün numarası (1970-01-01 = 0) yıl, ay, günden. Geçerlilik denetlemez.
pub fn gun_no(yil: i64, ay: i64, gun: i64) -> i64 {
    let y = yil - i64::from(ay <= 2);
    let devir = y.div_euclid(400);
    let devir_yili = y - devir * 400;
    let yil_gunu = (153 * ((ay + 9) % 12) + 2).div_euclid(5) + gun - 1;
    let devir_gunu = devir_yili * 365 + devir_yili.div_euclid(4) - devir_yili.div_euclid(100) + yil_gunu;
    devir * 146_097 + devir_gunu - 719_468
}

/// `tarihGunNo`: geçerli tarih ister, değilse `None` (TS `RangeError`).
pub fn tarih_gun_no(tarih: &str) -> Option<i64> {
    if !gercek_tarih_mi(tarih) {
        return None;
    }
    let (y, a, g) = tarih_parcala(tarih)?;
    Some(gun_no(y, a, g))
}

/// `gunNoTarih`: gün numarasından `YYYY-MM-DD`.
pub fn gun_no_tarih(gun_no: i64) -> String {
    let z = gun_no + 719_468;
    let devir = z.div_euclid(146_097);
    let devir_gunu = z - devir * 146_097;
    let devir_yili =
        (devir_gunu - devir_gunu.div_euclid(1_460) + devir_gunu.div_euclid(36_524) - devir_gunu.div_euclid(146_096))
            .div_euclid(365);
    let yil_gunu = devir_gunu - (365 * devir_yili + devir_yili.div_euclid(4) - devir_yili.div_euclid(100));
    let mp = (5 * yil_gunu + 2).div_euclid(153);
    let gun = yil_gunu - (153 * mp + 2).div_euclid(5) + 1;
    let ay = if mp < 10 { mp + 3 } else { mp - 9 };
    let yil = devir_yili + devir * 400 + i64::from(ay <= 2);
    format!("{yil:04}-{ay:02}-{gun:02}")
}

/// `haftaGunuNo`: 0 pazartesi ... 6 pazar.
pub fn hafta_gunu_no_gun(gun_no: i64) -> i64 {
    (gun_no + 3).rem_euclid(7)
}

/// `^([01]\d|2[0-3]):([0-5]\d)$`.
pub fn saat_gecerli_mi(metin: &str) -> bool {
    let b = metin.as_bytes();
    if b.len() != 5 || b[2] != b':' || !b.iter().enumerate().all(|(i, c)| i == 2 || c.is_ascii_digit()) {
        return false;
    }
    let ss = (b[0] - b'0') * 10 + (b[1] - b'0');
    ss <= 23 && b[3] <= b'5'
}

/// Saatin gün içindeki dakikası (`saat_gecerli_mi` doğru olmalı).
pub fn dakika_no(saat: &str) -> i64 {
    let b = saat.as_bytes();
    let s = i64::from((b[0] - b'0') * 10 + (b[1] - b'0'));
    let d = i64::from((b[3] - b'0') * 10 + (b[4] - b'0'));
    s * 60 + d
}

/// `SaatDilimi`: 1-64 karakter, `^(?:UTC|[A-Z][A-Za-z_]*(?:\/[A-Za-z0-9_+-]+){1,2})$`. Yalnız biçim.
pub fn saat_dilimi_gecerli_mi(metin: &str) -> bool {
    if metin.is_empty() || metin.len() > super::sinirlar::ajanda::SAAT_DILIMI {
        return false;
    }
    if metin == "UTC" {
        return true;
    }
    let parcalar: Vec<&str> = metin.split('/').collect();
    if !(2..=3).contains(&parcalar.len()) {
        return false;
    }
    let ilk = parcalar[0].as_bytes();
    if ilk.is_empty() || !ilk[0].is_ascii_uppercase() || !ilk[1..].iter().all(|c| c.is_ascii_alphabetic() || *c == b'_') {
        return false;
    }
    parcalar[1..]
        .iter()
        .all(|p| !p.is_empty() && p.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'+' | b'-')))
}

#[cfg(test)]
mod testler {
    use super::*;

    #[test]
    fn gun_no_gidip_gelir() {
        for t in ["1900-01-01", "1970-01-01", "2000-02-29", "2026-11-25", "2199-12-31"] {
            assert_eq!(gun_no_tarih(tarih_gun_no(t).unwrap()), t);
        }
        assert_eq!(tarih_gun_no("1970-01-01"), Some(0));
        assert_eq!(hafta_gunu_no_gun(tarih_gun_no("2026-11-25").unwrap()), 2, "çarşamba");
    }

    #[test]
    fn bicimler() {
        assert!(!gercek_tarih_mi("2027-02-29"));
        assert!(gercek_tarih_mi("2028-02-29"));
        assert!(!gercek_tarih_mi("2200-01-01"));
        assert!(saat_gecerli_mi("23:59") && !saat_gecerli_mi("24:00") && !saat_gecerli_mi("12:60"));
        assert!(saat_dilimi_gecerli_mi("America/Argentina/Buenos_Aires"));
        assert!(saat_dilimi_gecerli_mi("Etc/GMT+3"));
        assert!(!saat_dilimi_gecerli_mi("europe/Istanbul"));
        assert!(!saat_dilimi_gecerli_mi("Europe"));
        assert!(!saat_dilimi_gecerli_mi("A/b/c/d"));
    }
}
