//! JSON okuma ve yazma yardımcıları. Okuyucu zod'un anlamını taşır:
//! - `Nesne`: `z.strictObject`; bilinmeyen alan hata, eksik zorunlu alan hata.
//! - `istege_bagli`: `.optional()`; alan yoksa `None`, `null` ise iç doğrulamaya gider (reddedilir).
//! - `null_olabilir`: `.nullable().optional()`; yok / `null` / değer üç ayrı hal (`Alan`).
//! - `tam_sayi`: `z.number().int()`; JSON sayısı JS çift duyarlıklı sayısı gibi okunur (`1.0` = 1,
//!   `-0` = 0), yalnız güvenli tam sayılar (|n| <= 2^53-1) kabul edilir.
//!
//! İlk hatada durur; `SemaHatasi.yol` alan yoludur, gelen değeri içermez (günlüğe yazılabilir).

use serde_json::{Map, Value};

/// Şema hatası: hangi alan ve neden. `neden` sabit metindir (gelen veri içermez).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SemaHatasi {
    pub yol: String,
    pub neden: &'static str,
}

pub type Sonuc<T> = Result<T, SemaHatasi>;

pub fn hata<T>(yol: &str, neden: &'static str) -> Sonuc<T> {
    Err(SemaHatasi { yol: yol.to_string(), neden })
}

pub fn alt_yol(yol: &str, ad: &str) -> String {
    if yol.is_empty() { ad.to_string() } else { format!("{yol}.{ad}") }
}

/// `.nullable().optional()` alanın üç hali: verilmedi, `null` (kaldır), değer.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum Alan<T> {
    #[default]
    Yok,
    Kaldir,
    Deger(T),
}

impl<T> Alan<T> {
    pub fn yok_mu(&self) -> bool {
        matches!(self, Alan::Yok)
    }
    pub fn as_ref(&self) -> Alan<&T> {
        match self {
            Alan::Yok => Alan::Yok,
            Alan::Kaldir => Alan::Kaldir,
            Alan::Deger(d) => Alan::Deger(d),
        }
    }
}

/// Katı nesne okuyucu (`z.strictObject`). Okunan her alan adı kaydedilir; `bitir` kalanı reddeder.
pub struct Nesne<'a> {
    harita: &'a Map<String, Value>,
    yol: String,
    bilinen: Vec<&'static str>,
}

impl<'a> Nesne<'a> {
    pub fn ac(deger: &'a Value, yol: &str) -> Sonuc<Self> {
        match deger {
            Value::Object(harita) => Ok(Nesne { harita, yol: yol.to_string(), bilinen: Vec::new() }),
            _ => hata(yol, "nesne değil"),
        }
    }

    pub fn yol(&self) -> &str {
        &self.yol
    }

    pub fn alan_yolu(&self, ad: &str) -> String {
        alt_yol(&self.yol, ad)
    }

    /// Alanı doğrulamadan verir (ve bilinen sayar). Ayırıcı alanlara bakmak için.
    pub fn ham(&mut self, ad: &'static str) -> Option<&'a Value> {
        if !self.bilinen.contains(&ad) {
            self.bilinen.push(ad);
        }
        self.harita.get(ad)
    }

    pub fn zorunlu<T>(&mut self, ad: &'static str, f: impl FnOnce(&'a Value, &str) -> Sonuc<T>) -> Sonuc<T> {
        let yol = self.alan_yolu(ad);
        match self.ham(ad) {
            Some(v) => f(v, &yol),
            None => hata(&yol, "zorunlu alan yok"),
        }
    }

    pub fn istege_bagli<T>(
        &mut self,
        ad: &'static str,
        f: impl FnOnce(&'a Value, &str) -> Sonuc<T>,
    ) -> Sonuc<Option<T>> {
        let yol = self.alan_yolu(ad);
        match self.ham(ad) {
            Some(v) => f(v, &yol).map(Some),
            None => Ok(None),
        }
    }

    pub fn null_olabilir<T>(
        &mut self,
        ad: &'static str,
        f: impl FnOnce(&'a Value, &str) -> Sonuc<T>,
    ) -> Sonuc<Alan<T>> {
        let yol = self.alan_yolu(ad);
        match self.ham(ad) {
            None => Ok(Alan::Yok),
            Some(Value::Null) => Ok(Alan::Kaldir),
            Some(v) => f(v, &yol).map(Alan::Deger),
        }
    }

    /// Okunmamış (şemada olmayan) alan varsa reddeder.
    pub fn bitir(self) -> Sonuc<()> {
        for anahtar in self.harita.keys() {
            if !self.bilinen.contains(&anahtar.as_str()) {
                return hata(&alt_yol(&self.yol, anahtar), "bilinmeyen alan");
            }
        }
        Ok(())
    }
}

/// JS `Number.MAX_SAFE_INTEGER`.
pub const GUVENLI_TAM_SAYI: i64 = 9_007_199_254_740_991;

pub fn metin<'a>(v: &'a Value, yol: &str) -> Sonuc<&'a str> {
    match v {
        Value::String(s) => Ok(s.as_str()),
        _ => hata(yol, "metin değil"),
    }
}

pub fn mantik(v: &Value, yol: &str) -> Sonuc<bool> {
    match v {
        Value::Bool(b) => Ok(*b),
        _ => hata(yol, "mantıksal değil"),
    }
}

/// `z.number().int().min(en).max(boy)`, JS sayı anlamıyla.
pub fn tam_sayi(v: &Value, yol: &str, en: i64, boy: i64) -> Sonuc<i64> {
    let Value::Number(n) = v else { return hata(yol, "sayı değil") };
    let deger = if let Some(i) = n.as_i64() {
        if i.unsigned_abs() > GUVENLI_TAM_SAYI as u64 {
            return hata(yol, "güvenli tam sayı değil");
        }
        i
    } else if n.is_u64() {
        return hata(yol, "güvenli tam sayı değil");
    } else {
        let f = n.as_f64().unwrap_or(f64::NAN);
        if !f.is_finite() || f.fract() != 0.0 || f.abs() > GUVENLI_TAM_SAYI as f64 {
            return hata(yol, "tam sayı değil");
        }
        f as i64
    };
    if deger < en || deger > boy {
        return hata(yol, "sınır dışı");
    }
    Ok(deger)
}

/// `z.literal(beklenen)` (sayı): JS'te `1.0 === 1`.
pub fn sayi_sabiti(v: &Value, yol: &str, beklenen: i64) -> Sonuc<()> {
    match v {
        Value::Number(n) if n.as_f64() == Some(beklenen as f64) => Ok(()),
        _ => hata(yol, "beklenen sabit değil"),
    }
}

/// `z.literal(beklenen)` (metin).
pub fn metin_sabiti(v: &Value, yol: &str, beklenen: &str) -> Sonuc<()> {
    match v {
        Value::String(s) if s == beklenen => Ok(()),
        _ => hata(yol, "beklenen sabit değil"),
    }
}

/// `z.array(...).max(boy)`.
pub fn dizi<'a>(v: &'a Value, yol: &str, boy: usize) -> Sonuc<&'a Vec<Value>> {
    match v {
        Value::Array(a) if a.len() <= boy => Ok(a),
        Value::Array(_) => hata(yol, "dizi çok uzun"),
        _ => hata(yol, "dizi değil"),
    }
}

/// Dizinin her öğesini okur (`yol.0`, `yol.1`, ...).
pub fn dizi_oku<'a, T>(
    v: &'a Value,
    yol: &str,
    boy: usize,
    mut f: impl FnMut(&'a Value, &str) -> Sonuc<T>,
) -> Sonuc<Vec<T>> {
    let ogeler = dizi(v, yol, boy)?;
    let mut cikti = Vec::with_capacity(ogeler.len());
    for (i, oge) in ogeler.iter().enumerate() {
        cikti.push(f(oge, &alt_yol(yol, &i.to_string()))?);
    }
    Ok(cikti)
}

// Yazma

/// Nesne kurucu: `None` alanlar yazılmaz (`undefined` gibi), `Alan::Kaldir` `null` yazılır.
#[derive(Default)]
pub struct Yazici(Map<String, Value>);

impl Yazici {
    pub fn yeni() -> Self {
        Yazici(Map::new())
    }
    pub fn alan(mut self, ad: &str, deger: impl Into<Value>) -> Self {
        self.0.insert(ad.to_string(), deger.into());
        self
    }
    pub fn varsa<T: Into<Value>>(mut self, ad: &str, deger: Option<T>) -> Self {
        if let Some(d) = deger {
            self.0.insert(ad.to_string(), d.into());
        }
        self
    }
    pub fn uclu<T>(mut self, ad: &str, deger: &Alan<T>, f: impl FnOnce(&T) -> Value) -> Self {
        match deger {
            Alan::Yok => {}
            Alan::Kaldir => {
                self.0.insert(ad.to_string(), Value::Null);
            }
            Alan::Deger(d) => {
                self.0.insert(ad.to_string(), f(d));
            }
        }
        self
    }
    pub fn bitir(self) -> Value {
        Value::Object(self.0)
    }
}

pub fn dizi_yaz<T>(ogeler: &[T], f: impl Fn(&T) -> Value) -> Value {
    Value::Array(ogeler.iter().map(f).collect())
}

/// Değer sabitlerinin (kapalı listeler) ortak kalıbı: Rust sayımı <-> kablodaki metin.
/// `HEPSI` sözleşmedeki sırayla (alan izi gibi kanonik sıralar buna dayanır).
macro_rules! sabit_liste {
    ($(#[$m:meta])* $ad:ident { $($(#[$dm:meta])* $degisken:ident = $metin:literal),+ $(,)? }) => {
        $(#[$m])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, uniffi::Enum)]
        pub enum $ad { $($(#[$dm])* $degisken),+ }

        impl $ad {
            pub const HEPSI: &'static [$ad] = &[$($ad::$degisken),+];

            pub fn ad(self) -> &'static str {
                match self { $($ad::$degisken => $metin),+ }
            }

            pub fn coz(metin: &str) -> Option<Self> {
                match metin { $($metin => Some($ad::$degisken),)+ _ => None }
            }

            pub fn oku(v: &serde_json::Value, yol: &str) -> $crate::model::json::Sonuc<Self> {
                match v {
                    serde_json::Value::String(s) => Self::coz(s)
                        .map_or_else(|| $crate::model::json::hata(yol, "kapalı listede yok"), Ok),
                    _ => $crate::model::json::hata(yol, "metin değil"),
                }
            }

            pub fn json(self) -> serde_json::Value {
                serde_json::Value::String(self.ad().to_string())
            }
        }
    };
}
pub(crate) use sabit_liste;
