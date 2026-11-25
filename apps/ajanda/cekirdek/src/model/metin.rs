//! Ajanda metin kuralları (`ajanda-zaman.ts` "Metin"): görünmez kod noktası tablosu, emoji
//! birleştiricilerinin bağlamı, tek satırlık ve çok satırlı metin şemaları. Uzunluklar UTF-16
//! birimidir (JS `length`), kırpma JS `String.prototype.trim` kümesiyledir.
//!
//! Rust `str` eşsiz vekil taşıyamaz; JSON'daki eşsiz vekil kaçışı `serde_json` çözümünde zaten
//! reddedilir (bkz. `model::cerceve` "Bilinen ayrışmalar").

use super::json::{Sonuc, hata, metin};
use serde_json::Value;

/// `AJANDA_GORUNMEZ_ARALIKLARI`, birebir (iki uç dahil, artan).
pub const AJANDA_GORUNMEZ_ARALIKLARI: &[(u32, u32)] = &[
    (0x0000, 0x0008),
    (0x000b, 0x000c),
    (0x000e, 0x001f),
    (0x007f, 0x009f),
    (0x00ad, 0x00ad),
    (0x034f, 0x034f),
    (0x061c, 0x061c),
    (0x115f, 0x1160),
    (0x17b4, 0x17b5),
    (0x180b, 0x180f),
    (0x200b, 0x200f),
    (0x2028, 0x202e),
    (0x2060, 0x206f),
    (0x3164, 0x3164),
    (0xfe00, 0xfe0f),
    (0xfeff, 0xfeff),
    (0xffa0, 0xffa0),
    (0xfff0, 0xfffb),
    (0x13430, 0x1343f),
    (0x1bca0, 0x1bca3),
    (0x1d173, 0x1d17a),
    (0xe0000, 0xe0fff),
];

/// `AJANDA_EMOJI_BIRLESTIRICILERI`: ZWJ, VS15, VS16.
pub const AJANDA_EMOJI_BIRLESTIRICILERI: [u32; 3] = [0x200d, 0xfe0e, 0xfe0f];

pub fn ajanda_gorunmez_mi(kod_noktasi: u32) -> bool {
    for &(bas, son) in AJANDA_GORUNMEZ_ARALIKLARI {
        if kod_noktasi < bas {
            return false;
        }
        if kod_noktasi <= son {
            return true;
        }
    }
    false
}

/// Sunum seçicisinin ve birleştiricinin dayanabileceği karakter: tabloda değil, boşluk değil.
pub fn emoji_tabani_mi(k: Option<u32>) -> bool {
    match k {
        None => false,
        Some(k) => k != 0x20 && k != 0x09 && k != 0x0a && k != 0x0d && !ajanda_gorunmez_mi(k),
    }
}

/// `ajandaGorunmezVarMi`: kabul edilmeyen görünmez kod noktası var mı (emoji bağlamı istisnasıyla).
pub fn ajanda_gorunmez_var_mi(metin: &str) -> bool {
    let kn: Vec<u32> = metin.chars().map(|c| c as u32).collect();
    for i in 0..kn.len() {
        let k = kn[i];
        if !ajanda_gorunmez_mi(k) {
            continue;
        }
        let once = if i == 0 { None } else { Some(kn[i - 1]) };
        if (k == 0xfe0e || k == 0xfe0f) && emoji_tabani_mi(once) {
            continue;
        }
        if k == 0x200d && (emoji_tabani_mi(once) || once == Some(0xfe0f)) && emoji_tabani_mi(kn.get(i + 1).copied()) {
            continue;
        }
        return true;
    }
    false
}

/// JS `length`: UTF-16 birim sayısı.
pub fn utf16_uzunluk(s: &str) -> usize {
    s.chars().map(char::len_utf16).sum()
}

/// JS `trim()`'in attığı karakterler: ECMAScript WhiteSpace (Zs dahil) ve LineTerminator.
/// Rust `char::is_whitespace`'ten farkı: U+FEFF dahil, U+0085 hariç.
pub fn js_bosluk_mu(c: char) -> bool {
    matches!(
        c,
        '\u{0009}' | '\u{000a}' | '\u{000b}' | '\u{000c}' | '\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}'
            | '\u{2000}'..='\u{200a}'
            | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}'
    )
}

/// JS `trim()`.
pub fn js_kirp(s: &str) -> &str {
    s.trim_matches(js_bosluk_mu)
}

/// `ajandaSatiri(en, boy)`: tek satır; satır sonu ve sekme yok, kabul edilmeyen görünmez yok,
/// kenar boşluğu yok, uzunluk UTF-16 biriminde `en..=boy`.
pub fn ajanda_satiri_gecerli(s: &str, en: usize, boy: usize) -> Result<(), &'static str> {
    let uzunluk = utf16_uzunluk(s);
    if uzunluk < en {
        return Err("çok kısa");
    }
    if uzunluk > boy {
        return Err("çok uzun (UTF-16 birimi)");
    }
    if s.contains(['\t', '\n', '\r']) {
        return Err("satır sonu ya da sekme");
    }
    if ajanda_gorunmez_var_mi(s) {
        return Err("görünmez ya da yok sayılan karakter");
    }
    if js_kirp(s) != s {
        return Err("baştaki ya da sondaki boşluk");
    }
    Ok(())
}

/// `ajandaMetni(boy)`: çok satırlı; boş olamaz, yalnız boşluk olamaz.
pub fn ajanda_metni_gecerli(s: &str, boy: usize) -> Result<(), &'static str> {
    let uzunluk = utf16_uzunluk(s);
    if uzunluk < 1 {
        return Err("boş");
    }
    if uzunluk > boy {
        return Err("çok uzun (UTF-16 birimi)");
    }
    if ajanda_gorunmez_var_mi(s) {
        return Err("görünmez ya da yok sayılan karakter");
    }
    if js_kirp(s).is_empty() {
        return Err("yalnız boşluk");
    }
    Ok(())
}

pub fn satir_oku(v: &Value, yol: &str, en: usize, boy: usize) -> Sonuc<String> {
    let s = metin(v, yol)?;
    ajanda_satiri_gecerli(s, en, boy).map_or_else(|neden| hata(yol, neden), |()| Ok(s.to_string()))
}

pub fn cok_satir_oku(v: &Value, yol: &str, boy: usize) -> Sonuc<String> {
    let s = metin(v, yol)?;
    ajanda_metni_gecerli(s, boy).map_or_else(|neden| hata(yol, neden), |()| Ok(s.to_string()))
}

/// `z.string().min(en).max(boy)` (UTF-16) ve ASCII deseni: her karakter `izinli`'den geçmeli.
pub fn desenli_oku(
    v: &Value,
    yol: &str,
    en: usize,
    boy: usize,
    izinli: impl Fn(char) -> bool,
) -> Sonuc<String> {
    let s = metin(v, yol)?;
    let uzunluk = utf16_uzunluk(s);
    if uzunluk < en || uzunluk > boy {
        return hata(yol, "uzunluk sınır dışı");
    }
    if !s.chars().all(izinli) {
        return hata(yol, "desene uymuyor");
    }
    Ok(s.to_string())
}

/// `OpakId`: 1-64, `^[A-Za-z0-9_-]+$`.
pub fn opak_id_oku(v: &Value, yol: &str) -> Sonuc<String> {
    desenli_oku(v, yol, 1, super::sinirlar::genel::OPAK_ID, |c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

pub fn opak_id_mi(s: &str) -> bool {
    opak_id_oku(&Value::String(s.to_string()), "").is_ok()
}

/// Standart base64 deseni `^[A-Za-z0-9+/]+={0,2}$` ve uzunluk.
pub fn base64_oku(v: &Value, yol: &str, en: usize, boy: usize) -> Sonuc<String> {
    let s = metin(v, yol)?;
    let uzunluk = s.len();
    if uzunluk < en || uzunluk > boy || !s.is_ascii() {
        return hata(yol, "uzunluk sınır dışı");
    }
    let govde = s.trim_end_matches('=');
    let dolgu = s.len() - govde.len();
    if govde.is_empty() || dolgu > 2 || !govde.chars().all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '/') {
        return hata(yol, "base64 değil");
    }
    Ok(s.to_string())
}

#[cfg(test)]
mod testler {
    use super::*;

    #[test]
    fn js_kirpma_kumesi() {
        assert_eq!(js_kirp("\u{feff} a \u{3000}"), "a");
        assert_eq!(js_kirp("\u{85}a"), "\u{85}a", "NEL JS'te boşluk değildir");
    }

    #[test]
    fn utf16_birim() {
        assert_eq!(utf16_uzunluk("aş☕️"), 4);
        assert_eq!(utf16_uzunluk("👍"), 2);
    }
}
