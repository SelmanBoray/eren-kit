//! Sürüm 3'ün kayıt alanları (`simge`, `bolge`, `bolge_konumu`, `varis`, `baglantilar`, `ekler`), yetenek
//! adları ve saf yardımcıları (`ajanda-alan.ts`, birebir): bölge eşleşme anahtarı, URL, kanonik base64,
//! yetenek kesişimi, v3 alan kuralı. Hepsi isteğe bağlı, üst düzey alandır; kuralları yalnız yeni alanlara
//! bağlıdır (genişleme kuralı 2). Kayda, işleme ve çerçevelere sürüme göre `kayit.rs`, `islem.rs` ve
//! `cerceve.rs` ekler. Vektör: `ajanda-v3.json`, `ajanda-mesaj-v3.json`.
//!
//! Model gösterimi: `baglantilar` ve `ekler` kablo şemasında en az bir öğelidir (yokluk alanın kendisinin
//! yokluğudur); modelde boş liste "alan yok" demektir, okuyucu boş diziyi reddeder, yazıcı boş listeyi yazmaz.

use super::json::{Alan, Nesne, Sonuc, Yazici, dizi_oku, dizi_yaz, hata, mantik, metin, sabit_liste, tam_sayi};
use super::kayit::zaman_ms_oku;
use super::metin::{desenli_oku, opak_id_oku, satir_oku, utf16_uzunluk};
use super::sinirlar::ajanda::{
    BAGLANTI_BASLIK, BAGLANTI_URL, BOLGE, BOLGE_YARICAP_MAX, BOLGE_YARICAP_MIN, EK_ADET, EK_BAYT, EK_KENAR, EK_MIME,
    EK_PARCA, KAYIT_BAGLANTI_ADET, SIMGE, YETENEK_ADET, YETENEK_ADI,
};
use super::surum::Surum;
use super::zaman::saat_oku;
use serde_json::Value;

// Simge

/// Önerilen simge anahtarları (`AJANDA_SIMGELERI`; öneri, doğrulama değil; ASCII sırasıyla).
pub const AJANDA_SIMGELERI: [&str; 21] = [
    "araba", "banka", "dis", "dogum_gunu", "doktor", "ev", "fatura", "ilac", "is", "kahve", "kargo", "kitap", "market",
    "okul", "sac", "seyahat", "spor", "telefon", "temizlik", "toplanti", "yemek",
];

/// `^[a-z][a-z0-9_]{en..=boy-1}$` (yalnız ASCII): simge ve yetenek adı deseni.
fn kucuk_ad_mi(s: &str, en: usize, boy: usize) -> bool {
    let b = s.as_bytes();
    (en..=boy).contains(&b.len())
        && b[0].is_ascii_lowercase()
        && b[1..].iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'_')
}

/// `AjandaSimge`: en çok `SIMGE`, `^[a-z][a-z0-9_]{0,31}$`. Açık küme: bilinmeyen anahtar korunur.
pub fn simge_oku(v: &Value, yol: &str) -> Sonuc<String> {
    let s = metin(v, yol)?;
    if kucuk_ad_mi(s, 1, SIMGE) { Ok(s.to_string()) } else { hata(yol, "simge deseni değil") }
}

// Bölge

/// `AjandaBolge`: tek satır, 1..`BOLGE`.
pub fn bolge_oku(v: &Value, yol: &str) -> Sonuc<String> {
    satir_oku(v, yol, 1, BOLGE)
}

/// Bölgenin konumu (`AjandaBolgeKonumu`): tam sayı mikroderece (WGS84 × 10⁶) ve yarıçap. Yalnız `bolge`
/// varken. Yalnız yedektir: araç çıktısına, model metnine ve günlüklere girmez.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Record)]
pub struct AjandaBolgeKonumu {
    pub enlem_e6: i32,
    pub boylam_e6: i32,
    pub yaricap_m: i32,
}

impl AjandaBolgeKonumu {
    pub fn oku(v: &Value, yol: &str) -> Sonuc<Self> {
        let mut n = Nesne::ac(v, yol)?;
        let k = AjandaBolgeKonumu {
            enlem_e6: n.zorunlu("enlem_e6", |v, y| tam_sayi(v, y, -90_000_000, 90_000_000))? as i32,
            boylam_e6: n.zorunlu("boylam_e6", |v, y| tam_sayi(v, y, -180_000_000, 180_000_000))? as i32,
            yaricap_m: n.zorunlu("yaricap_m", |v, y| tam_sayi(v, y, BOLGE_YARICAP_MIN, BOLGE_YARICAP_MAX))? as i32,
        };
        n.bitir()?;
        Ok(k)
    }

    pub fn json(&self) -> Value {
        Yazici::yeni()
            .alan("enlem_e6", self.enlem_e6)
            .alan("boylam_e6", self.boylam_e6)
            .alan("yaricap_m", self.yaricap_m)
            .bitir()
    }
}

/// `TURKCE_BIRLESIK`: Türkçe harflerin ayrışık yazılışı (taban, birleşen işaret) ve birleşik karşılığı.
/// Kapalı tablodur (tam NFC değil), TS ile birebir.
const TURKCE_BIRLESIK: [(char, char, char); 17] = [
    ('C', '\u{0327}', '\u{00c7}'),
    ('c', '\u{0327}', '\u{00e7}'),
    ('S', '\u{0327}', '\u{015e}'),
    ('s', '\u{0327}', '\u{015f}'),
    ('G', '\u{0306}', '\u{011e}'),
    ('g', '\u{0306}', '\u{011f}'),
    ('I', '\u{0307}', '\u{0130}'),
    ('O', '\u{0308}', '\u{00d6}'),
    ('o', '\u{0308}', '\u{00f6}'),
    ('U', '\u{0308}', '\u{00dc}'),
    ('u', '\u{0308}', '\u{00fc}'),
    ('A', '\u{0302}', '\u{00c2}'),
    ('a', '\u{0302}', '\u{00e2}'),
    ('I', '\u{0302}', '\u{00ce}'),
    ('i', '\u{0302}', '\u{00ee}'),
    ('U', '\u{0302}', '\u{00db}'),
    ('u', '\u{0302}', '\u{00fb}'),
];

/// `ajandaBolgeAnahtari`: bölge adının eşleşme anahtarı. Sırayla:
/// 1. Türkçe ayrışık yazılış birleşik yazılışa (`TURKCE_BIRLESIK`, soldan sağa, örtüşmesiz).
/// 2. Her `White_Space` dizisi (`char::is_whitespace`) tek U+0020; baştaki ve sondaki U+0020 atılır.
/// 3. Kod noktası başına bağlamsız küçük harf: `İ` → `i`, `I` → `ı`, ötekiler `char::to_lowercase`.
pub fn ajanda_bolge_anahtari(ad: &str) -> String {
    let mut birlesik = String::with_capacity(ad.len());
    let mut it = ad.chars().peekable();
    while let Some(c) = it.next() {
        let sonraki = it.peek().copied();
        match TURKCE_BIRLESIK.iter().find(|(t, i, _)| *t == c && Some(*i) == sonraki) {
            Some(&(_, _, b)) => {
                birlesik.push(b);
                it.next();
            }
            None => birlesik.push(c),
        }
    }
    let mut sade = String::with_capacity(birlesik.len());
    let mut bosluk = false;
    for c in birlesik.chars() {
        if c.is_whitespace() {
            if !bosluk {
                sade.push(' ');
            }
            bosluk = true;
        } else {
            sade.push(c);
            bosluk = false;
        }
    }
    let mut cikti = String::with_capacity(sade.len());
    for c in sade.trim_matches(' ').chars() {
        match c {
            '\u{0130}' => cikti.push('i'),
            'I' => cikti.push('\u{0131}'),
            c => cikti.extend(c.to_lowercase()),
        }
    }
    cikti
}

/// `ajandaBolgeYeriDegisirMi`: eski ad vardı ve yeni ad yok ya da anahtarı başka. Yalnız büyük/küçük harf
/// ya da boşluk farkı aynı yerdir.
pub fn ajanda_bolge_yeri_degisir_mi(eski: Option<&str>, yeni: Option<&str>) -> bool {
    match (eski, yeni) {
        (None, _) => false,
        (Some(_), None) => true,
        (Some(e), Some(y)) => ajanda_bolge_anahtari(e) != ajanda_bolge_anahtari(y),
    }
}

// Varış

/// Varış penceresi (`AjandaVarisPenceresi`): yerel duvar saati, `bas` < `bit` (gece yarısını aşmaz).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct AjandaVarisPenceresi {
    pub bas: String,
    pub bit: String,
}

impl AjandaVarisPenceresi {
    pub fn oku(v: &Value, yol: &str) -> Sonuc<Self> {
        let mut n = Nesne::ac(v, yol)?;
        let p = AjandaVarisPenceresi { bas: n.zorunlu("bas", saat_oku)?, bit: n.zorunlu("bit", saat_oku)? };
        n.bitir()?;
        if p.bas >= p.bit {
            return hata(&n_yolu(yol, "bit"), "bas bit'ten önce olmalı");
        }
        Ok(p)
    }

    pub fn json(&self) -> Value {
        Yazici::yeni().alan("bas", self.bas.as_str()).alan("bit", self.bit.as_str()).bitir()
    }
}

fn n_yolu(yol: &str, ad: &str) -> String {
    super::json::alt_yol(yol, ad)
}

/// Bölgeye varışta hatırlatma (`AjandaVaris`); yalnız `bolge` varken. `{}` "ilk girişte bir kez".
/// `cikista` kabloda yalnız `true` yazılır (yokluğu yanlıştır); modelde `false` = alan yok.
#[derive(Debug, Clone, Default, PartialEq, Eq, uniffi::Record)]
pub struct AjandaVaris {
    pub pencere: Option<AjandaVarisPenceresi>,
    pub cikista: bool,
}

impl AjandaVaris {
    pub fn oku(v: &Value, yol: &str) -> Sonuc<Self> {
        let mut n = Nesne::ac(v, yol)?;
        let pencere = n.istege_bagli("pencere", AjandaVarisPenceresi::oku)?;
        let cikista = n.istege_bagli("cikista", |v, y| if mantik(v, y)? { Ok(()) } else { hata(y, "beklenen sabit değil") })?;
        n.bitir()?;
        Ok(AjandaVaris { pencere, cikista: cikista.is_some() })
    }

    pub fn json(&self) -> Value {
        Yazici::yeni()
            .varsa("pencere", self.pencere.as_ref().map(AjandaVarisPenceresi::json))
            .varsa("cikista", self.cikista.then_some(true))
            .bitir()
    }
}

// Bağlantılar

/// RFC 3986'nın izin vermediği, tarayıcıların farklı yorumladığı yazdırılabilir ASCII karakterler.
const URL_YASAK: &[u8] = b"\"<>\\^`{|}";

fn etiket_mi(e: &str) -> bool {
    (1..=63).contains(&e.len()) && e.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}

/// `^[1-9][0-9]{0,4}$` ve değeri en çok 65535.
fn port_mu(p: &str) -> bool {
    let b = p.as_bytes();
    (1..=5).contains(&b.len())
        && b[0] != b'0'
        && b.iter().all(u8::is_ascii_digit)
        && p.parse::<u32>().is_ok_and(|n| n <= 65_535)
}

/// `ajandaUrlAlanAdi`: URL geçerliyse alan adı (küçük harf ASCII; IPv6 köşeli ayraçlı), değilse `None`.
/// Adımlar TS ile birebir:
/// 1. Uzunluk 1..`BAGLANTI_URL`; her karakter yazdırılabilir ASCII (0x21..0x7E), `"<>\^`{|}` yok.
/// 2. Küçük harf `https://` ya da `http://` ile başlar.
/// 3. Yetki: önekten sonra ilk `/`, `?` ya da `#`'e (yoksa sona) kadar; içinde `@` yok.
/// 4. `[` ile başlıyorsa IPv6 (`[` + 2..45 tane `0-9A-Fa-f:.` + `]`, içinde `:`), sonrası boş ya da `:port`;
///    değilse ilk `:`'a kadar ana bilgisayar adı (en çok 253, `.` ile ayrılmış 1..63'lük `A-Za-z0-9_-`
///    etiketleri), `:` varsa sonrası port.
/// 5. Port: baştaki sıfırsız 1..5 rakam, değeri 1..65535.
pub fn ajanda_url_alan_adi(url: &str) -> Option<String> {
    if url.is_empty() || utf16_uzunluk(url) > BAGLANTI_URL {
        return None;
    }
    if !url.bytes().all(|c| (0x21..=0x7e).contains(&c) && !URL_YASAK.contains(&c)) {
        return None;
    }
    let geri = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://"))?;
    let yetki = &geri[..geri.find(['/', '?', '#']).unwrap_or(geri.len())];
    if yetki.contains('@') {
        return None;
    }
    let (ana, port) = if yetki.starts_with('[') {
        let kapanis = yetki.find(']')?;
        let (ana, kalan) = yetki.split_at(kapanis + 1);
        let port = if kalan.is_empty() { None } else { Some(kalan.strip_prefix(':')?) };
        let ic = &ana[1..ana.len() - 1];
        let gecerli = (2..=45).contains(&ic.len()) && ic.bytes().all(|c| c.is_ascii_hexdigit() || c == b':' || c == b'.');
        if !gecerli || !ic.contains(':') {
            return None;
        }
        (ana, port)
    } else {
        let (ana, port) = match yetki.split_once(':') {
            Some((a, p)) => (a, Some(p)),
            None => (yetki, None),
        };
        if ana.is_empty() || ana.len() > 253 || !ana.split('.').all(etiket_mi) {
            return None;
        }
        (ana, port)
    };
    if port.is_some_and(|p| !port_mu(p)) {
        return None;
    }
    Some(ana.to_ascii_lowercase())
}

/// `ajandaUrlGecerliMi`.
pub fn ajanda_url_gecerli_mi(url: &str) -> bool {
    ajanda_url_alan_adi(url).is_some()
}

/// Bağlantı (`AjandaBaglanti`): eylemsiz veri; yalnız kullanıcı dokununca sistem tarayıcısında açılır.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct AjandaBaglanti {
    pub url: String,
    pub baslik: Option<String>,
}

impl AjandaBaglanti {
    pub fn oku(v: &Value, yol: &str) -> Sonuc<Self> {
        let mut n = Nesne::ac(v, yol)?;
        let b = AjandaBaglanti {
            url: n.zorunlu("url", |v, y| {
                let s = metin(v, y)?;
                if ajanda_url_gecerli_mi(s) { Ok(s.to_string()) } else { hata(y, "url geçersiz") }
            })?,
            baslik: n.istege_bagli("baslik", |v, y| satir_oku(v, y, 1, BAGLANTI_BASLIK))?,
        };
        n.bitir()?;
        Ok(b)
    }

    pub fn json(&self) -> Value {
        Yazici::yeni().alan("url", self.url.as_str()).varsa("baslik", self.baslik.clone()).bitir()
    }
}

/// `AjandaBaglantilar`: 1..`KAYIT_BAGLANTI_ADET` öğe, `url`'ler tekil.
pub fn baglantilar_oku(v: &Value, yol: &str) -> Sonuc<Vec<AjandaBaglanti>> {
    let l = dizi_oku(v, yol, KAYIT_BAGLANTI_ADET, AjandaBaglanti::oku)?;
    if l.is_empty() {
        return hata(yol, "en az bir öğe");
    }
    if l.iter().enumerate().any(|(i, b)| l[..i].iter().any(|o| o.url == b.url)) {
        return hata(yol, "url tekil olmalı");
    }
    Ok(l)
}

pub fn baglantilar_yaz(l: &[AjandaBaglanti]) -> Value {
    dizi_yaz(l, AjandaBaglanti::json)
}

// Ekler

/// `AjandaEkOzeti`: saklanan baytların sha256'sı, küçük harf onaltılık.
pub fn ek_ozeti_oku(v: &Value, yol: &str) -> Sonuc<String> {
    let s = metin(v, yol)?;
    if s.len() == 64 && s.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)) {
        Ok(s.to_string())
    } else {
        hata(yol, "özet deseni değil")
    }
}

/// `AjandaEkBayti`: 1..`EK_BAYT`.
pub fn ek_bayti_oku(v: &Value, yol: &str) -> Sonuc<i64> {
    tam_sayi(v, yol, 1, EK_BAYT)
}

/// `AjandaEkMime`: en çok `EK_MIME`, `^[a-z]+\/[a-z0-9.+-]+$`. Açık küme.
fn ek_mime_oku(v: &Value, yol: &str) -> Sonuc<String> {
    let s = metin(v, yol)?;
    let gecerli = s.len() <= EK_MIME
        && s.split_once('/').is_some_and(|(t, a)| {
            !t.is_empty()
                && t.bytes().all(|c| c.is_ascii_lowercase())
                && !a.is_empty()
                && a.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, b'.' | b'+' | b'-'))
        });
    if gecerli { Ok(s.to_string()) } else { hata(yol, "mime deseni değil") }
}

/// Ek üstverisi (`AjandaEki`). `bayt` ve `ozet` küçültülmüş dosyanındır, değişmez. `genislik` ile
/// `yukseklik` birlikte. `kapak` kabloda yalnız `true` yazılır; modelde `false` = alan yok.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct AjandaEki {
    pub ek_id: String,
    pub mime: String,
    pub bayt: i64,
    pub genislik: Option<i32>,
    pub yukseklik: Option<i32>,
    pub ozet: String,
    pub kapak: bool,
    pub olusturma_ms: i64,
}

impl AjandaEki {
    pub fn oku(v: &Value, yol: &str) -> Sonuc<Self> {
        let kenar = |v: &Value, y: &str| tam_sayi(v, y, 1, EK_KENAR).map(|n| n as i32);
        let mut n = Nesne::ac(v, yol)?;
        let e = AjandaEki {
            ek_id: n.zorunlu("ek_id", opak_id_oku)?,
            mime: n.zorunlu("mime", ek_mime_oku)?,
            bayt: n.zorunlu("bayt", ek_bayti_oku)?,
            genislik: n.istege_bagli("genislik", kenar)?,
            yukseklik: n.istege_bagli("yukseklik", kenar)?,
            ozet: n.zorunlu("ozet", ek_ozeti_oku)?,
            kapak: n.istege_bagli("kapak", |v, y| if mantik(v, y)? { Ok(()) } else { hata(y, "beklenen sabit değil") })?.is_some(),
            olusturma_ms: n.zorunlu("olusturma_ms", zaman_ms_oku)?,
        };
        n.bitir()?;
        if e.genislik.is_some() != e.yukseklik.is_some() {
            return hata(&n_yolu(yol, "yukseklik"), "genislik ve yukseklik birlikte");
        }
        Ok(e)
    }

    pub fn json(&self) -> Value {
        Yazici::yeni()
            .alan("ek_id", self.ek_id.as_str())
            .alan("mime", self.mime.as_str())
            .alan("bayt", self.bayt)
            .varsa("genislik", self.genislik)
            .varsa("yukseklik", self.yukseklik)
            .alan("ozet", self.ozet.as_str())
            .varsa("kapak", self.kapak.then_some(true))
            .alan("olusturma_ms", self.olusturma_ms)
            .bitir()
    }
}

/// `AjandaEkler`: 1..`EK_ADET` öğe, `ek_id`'ler tekil, en çok bir `kapak`.
pub fn ekler_oku(v: &Value, yol: &str) -> Sonuc<Vec<AjandaEki>> {
    let l = dizi_oku(v, yol, EK_ADET, AjandaEki::oku)?;
    if l.is_empty() {
        return hata(yol, "en az bir öğe");
    }
    if l.iter().enumerate().any(|(i, e)| l[..i].iter().any(|o| o.ek_id == e.ek_id)) {
        return hata(yol, "ek_id tekil olmalı");
    }
    if l.iter().filter(|e| e.kapak).count() > 1 {
        return hata(yol, "en çok bir kapak");
    }
    Ok(l)
}

pub fn ekler_yaz(l: &[AjandaEki]) -> Value {
    dizi_yaz(l, AjandaEki::json)
}

sabit_liste! {
    /// `AJANDA_EK_RET_KODLARI`: `ek_ret` kodları, kapalı küme (v3). Bağlantı kapanmaz; `IcHata` geçicidir.
    AjandaEkRetKodu {
        EkBilinmiyor = "ek_bilinmiyor",
        OzetUyusmuyor = "ozet_uyusmuyor",
        EkCokBuyuk = "ek_cok_buyuk",
        KotaAsildi = "kota_asildi",
        EkYok = "ek_yok",
        IcHata = "ic_hata",
    }
}

/// `ajandaBase64Boyu`: `n` baytın dolgulu standart base64 uzunluğu.
pub fn ajanda_base64_boyu(n: i64) -> i64 {
    (n + 2) / 3 * 4
}

fn base64_harfi_mi(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'+' || c == b'/'
}

/// Standart abecedeki sırası (`A`=0 ... `/`=63).
fn base64_sirasi(c: u8) -> u32 {
    match c {
        b'A'..=b'Z' => u32::from(c - b'A'),
        b'a'..=b'z' => u32::from(c - b'a') + 26,
        b'0'..=b'9' => u32::from(c - b'0') + 52,
        b'+' => 62,
        _ => 63,
    }
}

/// `kanonikBase64Mi`: uzunluk 4'ün katı ve en az 4; sondaki en çok iki `=` dışında her karakter standart
/// abecede; dolgudan önceki kullanılmayan bitler sıfır (`==` öncesi karakterin sırası 16'nın, `=` öncesininki
/// 4'ün katı). Aynı baytların tek yazılışı.
pub fn kanonik_base64_mi(m: &str) -> bool {
    let b = m.as_bytes();
    if b.len() < 4 || !b.len().is_multiple_of(4) {
        return false;
    }
    let dolgu = if m.ends_with("==") { 2 } else if m.ends_with('=') { 1 } else { 0 };
    let son = b.len() - dolgu;
    if !b[..son].iter().all(|&c| base64_harfi_mi(c)) {
        return false;
    }
    dolgu == 0 || base64_sirasi(b[son - 1]).is_multiple_of(if dolgu == 2 { 16 } else { 4 })
}

/// `ajandaBase64Bayti`: kanonik base64 metninin çözülmüş bayt sayısı (dolgu düşülür).
pub fn ajanda_base64_bayti(m: &str) -> i64 {
    let dolgu = if m.ends_with("==") { 2 } else if m.ends_with('=') { 1 } else { 0 };
    (m.len() / 4 * 3) as i64 - dolgu
}

/// `AjandaEkVerisi`: 4..`ajanda_base64_boyu(EK_PARCA)` karakter, kanonik base64, en çok `EK_PARCA` bayt.
pub fn ek_verisi_oku(v: &Value, yol: &str) -> Sonuc<String> {
    let s = metin(v, yol)?;
    let boy = utf16_uzunluk(s) as i64;
    if !(4..=ajanda_base64_boyu(EK_PARCA)).contains(&boy) {
        return hata(yol, "uzunluk sınır dışı");
    }
    if !kanonik_base64_mi(s) {
        return hata(yol, "kanonik base64 değil");
    }
    if ajanda_base64_bayti(s) > EK_PARCA {
        return hata(yol, "parça EK_PARCA'yı aşıyor");
    }
    Ok(s.to_string())
}

/// Ek çerçevelerinin `ofset`'i (`alinan`, `gonderilen`): 0..`EK_BAYT`.
pub fn ek_ofseti_oku(v: &Value, yol: &str) -> Sonuc<i64> {
    tam_sayi(v, yol, 0, EK_BAYT)
}

// Kural

/// `v3AlanKurallari`: `bolge_konumu` ve `varis` yalnız `bolge` varken. Yalnız yeni alanlara bağlıdır.
pub fn v3_alan_kurallari(bolge: bool, bolge_konumu: bool, varis: bool) -> Result<(), (&'static str, &'static str)> {
    if bolge {
        return Ok(());
    }
    if bolge_konumu {
        return Err(("bolge_konumu", "bolge_konumu bolge ister"));
    }
    if varis {
        return Err(("varis", "varis bolge ister"));
    }
    Ok(())
}

// Yetenekler

/// Bilinen yetenek adları (`AJANDA_YETENEKLERI`, ASCII sırasıyla). Doğrulama değildir: liste açıktır.
pub const AJANDA_YETENEKLERI: [&str; 3] = ["ek_yedegi", "eslesme_birak", "ice_aktar"];

/// `AjandaYetenekler`: en çok `YETENEK_ADET` ad (`^[a-z][a-z0-9_]{1,31}$`), kesin artan ASCII sırası.
pub fn yetenekler_oku(v: &Value, yol: &str) -> Sonuc<Vec<String>> {
    let l = dizi_oku(v, yol, YETENEK_ADET, |v, y| {
        desenli_oku(v, y, 2, YETENEK_ADI, |c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
            .and_then(|s| if kucuk_ad_mi(&s, 2, YETENEK_ADI) { Ok(s) } else { hata(y, "desene uymuyor") })
    })?;
    if l.windows(2).all(|w| w[0] < w[1]) { Ok(l) } else { hata(yol, "yetenekler artan sırada ve tekil") }
}

pub fn yetenekler_yaz(l: &[String]) -> Value {
    Value::Array(l.iter().map(|s| Value::String(s.clone())).collect())
}

/// `ajandaYetenekKesisimi`: istenenlerle (`None`: hiç istenmedi) sunulanların kesişimi, kanonik sırada
/// (tekil, UTF-16 birim sırası; adlar ASCII'dir). Bilinmeyen ad kesişime giremez.
pub fn ajanda_yetenek_kesisimi(istenen: Option<&[String]>, sunulan: &[String]) -> Vec<String> {
    let Some(istenen) = istenen else { return Vec::new() };
    let mut l: Vec<String> = istenen.iter().filter(|a| sunulan.contains(a)).cloned().collect();
    l.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    l.dedup();
    l
}

// Gruplar

/// Kaydın ve `ekle`'nin v3 alanları (`V3_GOVDE_ALANLARI`). v2'de hepsi yoktur. Kotlin'de `AjandaKaydi.v3`
/// (her alanın varsayılanı var: eski Kotlin kurucuları değişmeden derlenir).
#[derive(Debug, Clone, Default, PartialEq, Eq, uniffi::Record)]
pub struct V3Alanlari {
    #[uniffi(default)]
    pub simge: Option<String>,
    #[uniffi(default)]
    pub bolge: Option<String>,
    #[uniffi(default)]
    pub bolge_konumu: Option<AjandaBolgeKonumu>,
    #[uniffi(default)]
    pub varis: Option<AjandaVaris>,
    /// Boş: alan yok.
    #[uniffi(default)]
    pub baglantilar: Vec<AjandaBaglanti>,
    /// Boş: alan yok.
    #[uniffi(default)]
    pub ekler: Vec<AjandaEki>,
}

impl V3Alanlari {
    pub fn bos_mu(&self) -> bool {
        *self == V3Alanlari::default()
    }

    /// Açık nesneden okur (`bitir` çağıranındır). v2'de hiçbirini okumaz: varsa `bitir` reddeder.
    pub fn alanlari_oku(n: &mut Nesne<'_>, s: Surum) -> Sonuc<Self> {
        if !s.v3_mu() {
            return Ok(V3Alanlari::default());
        }
        Ok(V3Alanlari {
            simge: n.istege_bagli("simge", simge_oku)?,
            bolge: n.istege_bagli("bolge", bolge_oku)?,
            bolge_konumu: n.istege_bagli("bolge_konumu", AjandaBolgeKonumu::oku)?,
            varis: n.istege_bagli("varis", AjandaVaris::oku)?,
            baglantilar: n.istege_bagli("baglantilar", baglantilar_oku)?.unwrap_or_default(),
            ekler: n.istege_bagli("ekler", ekler_oku)?.unwrap_or_default(),
        })
    }

    /// v2'de hiçbirini yazmaz (o sürümde yoklar).
    pub fn alanlari_yaz(&self, y: Yazici, s: Surum) -> Yazici {
        if !s.v3_mu() {
            return y;
        }
        y.varsa("simge", self.simge.clone())
            .varsa("bolge", self.bolge.clone())
            .varsa("bolge_konumu", self.bolge_konumu.as_ref().map(AjandaBolgeKonumu::json))
            .varsa("varis", self.varis.as_ref().map(AjandaVaris::json))
            .varsa("baglantilar", (!self.baglantilar.is_empty()).then(|| baglantilar_yaz(&self.baglantilar)))
            .varsa("ekler", (!self.ekler.is_empty()).then(|| ekler_yaz(&self.ekler)))
    }

    /// `v3AlanKurallari`.
    pub fn kurallar(&self) -> Result<(), (&'static str, &'static str)> {
        v3_alan_kurallari(self.bolge.is_some(), self.bolge_konumu.is_some(), self.varis.is_some())
    }
}

/// Değişikliğin ve geçmiş parçasının v3 alanları (`V3_DEGISIKLIK_ALANLARI`): `Kaldir` (`null`) kaldırır.
/// `baglantilar`/`ekler` `Deger`'i boş olamaz (okuyucu reddeder).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct V3Degisikligi {
    pub simge: Alan<String>,
    pub bolge: Alan<String>,
    pub bolge_konumu: Alan<AjandaBolgeKonumu>,
    pub varis: Alan<AjandaVaris>,
    pub baglantilar: Alan<Vec<AjandaBaglanti>>,
    pub ekler: Alan<Vec<AjandaEki>>,
}

impl V3Degisikligi {
    pub fn bos_mu(&self) -> bool {
        *self == V3Degisikligi::default()
    }

    pub fn alanlari_oku(n: &mut Nesne<'_>, s: Surum) -> Sonuc<Self> {
        if !s.v3_mu() {
            return Ok(V3Degisikligi::default());
        }
        Ok(V3Degisikligi {
            simge: n.null_olabilir("simge", simge_oku)?,
            bolge: n.null_olabilir("bolge", bolge_oku)?,
            bolge_konumu: n.null_olabilir("bolge_konumu", AjandaBolgeKonumu::oku)?,
            varis: n.null_olabilir("varis", AjandaVaris::oku)?,
            baglantilar: n.null_olabilir("baglantilar", baglantilar_oku)?,
            ekler: n.null_olabilir("ekler", ekler_oku)?,
        })
    }

    pub fn alanlari_yaz(&self, y: Yazici, s: Surum) -> Yazici {
        if !s.v3_mu() {
            return y;
        }
        y.uclu("simge", &self.simge, |s| Value::String(s.clone()))
            .uclu("bolge", &self.bolge, |s| Value::String(s.clone()))
            .uclu("bolge_konumu", &self.bolge_konumu, AjandaBolgeKonumu::json)
            .uclu("varis", &self.varis, AjandaVaris::json)
            .uclu("baglantilar", &self.baglantilar, |l| baglantilar_yaz(l))
            .uclu("ekler", &self.ekler, |l| ekler_yaz(l))
    }
}

#[cfg(test)]
mod testler {
    use super::*;
    use serde_json::json;

    #[test]
    fn simge_ve_yetenek_desenleri() {
        for s in AJANDA_SIMGELERI {
            assert!(simge_oku(&json!(s), "").is_ok(), "{s}");
        }
        assert!(AJANDA_SIMGELERI.windows(2).all(|w| w[0] < w[1]));
        assert!(simge_oku(&json!("a"), "").is_ok(), "tek harf simge olur");
        assert!(simge_oku(&json!("a".repeat(32)), "").is_ok());
        assert!(simge_oku(&json!("a".repeat(33)), "").is_err());
        assert!(simge_oku(&json!("ş"), "").is_err());
        assert!(yetenekler_oku(&json!(["a"]), "").is_err(), "yetenek adı en az iki karakter");
        assert!(yetenekler_oku(&json!(["ab", "ab"]), "").is_err());
        assert!(yetenekler_oku(&json!([]), "").is_ok());
        assert!(AJANDA_YETENEKLERI.windows(2).all(|w| w[0] < w[1]));
    }

    #[test]
    fn varis_cikista_yalniz_true() {
        assert_eq!(AjandaVaris::oku(&json!({}), "").unwrap(), AjandaVaris::default());
        assert!(AjandaVaris::oku(&json!({"cikista": true}), "").unwrap().cikista);
        assert!(AjandaVaris::oku(&json!({"cikista": false}), "").is_err());
        assert_eq!(AjandaVaris { pencere: None, cikista: false }.json(), json!({}));
        assert!(AjandaVaris::oku(&json!({"pencere": {"bas": "09:00", "bit": "09:00"}}), "").is_err());
        assert!(AjandaVaris::oku(&json!({"pencere": {"bas": "09:00", "bit": "09:01"}}), "").is_ok());
    }

    #[test]
    fn base64_kanonik_kenarlari() {
        assert!(kanonik_base64_mi("QQ=="));
        assert!(!kanonik_base64_mi("QR=="), "kullanılmayan bitler sıfır değil");
        assert!(kanonik_base64_mi("QUI="));
        assert!(!kanonik_base64_mi("QUJ="));
        assert!(!kanonik_base64_mi("Q==="));
        assert!(!kanonik_base64_mi("QQ"));
        assert!(!kanonik_base64_mi("-_-_"));
        assert_eq!(ajanda_base64_bayti("QUJD"), 3);
        assert_eq!(ajanda_base64_bayti("QQ=="), 1);
        assert_eq!(ajanda_base64_boyu(EK_PARCA), 349_528);
        assert_eq!(ajanda_base64_boyu(EK_PARCA + 1), 349_528, "uzunluk tek başına yetmez");
    }

    #[test]
    fn kesisim_tekil_ve_sirali() {
        let l = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(ajanda_yetenek_kesisimi(Some(&l(&["b", "a", "b"])), &l(&["a", "b"])), l(&["a", "b"]));
        assert!(ajanda_yetenek_kesisimi(None, &l(&["a"])).is_empty());
    }

    #[test]
    fn grup_v2de_ne_okunur_ne_yazilir() {
        let v = json!({"bolge": "Ev"});
        let mut n = Nesne::ac(&v, "").unwrap();
        assert!(V3Alanlari::alanlari_oku(&mut n, Surum::V2).unwrap().bos_mu());
        assert!(n.bitir().is_err(), "v2'de v3 alanı bilinmeyen alandır");
        let g = V3Alanlari { bolge: Some("Ev".into()), ..Default::default() };
        assert_eq!(g.alanlari_yaz(Yazici::yeni(), Surum::V2).bitir(), json!({}));
        assert_eq!(g.alanlari_yaz(Yazici::yeni(), Surum::V3).bitir(), json!({"bolge": "Ev"}));
    }
}
