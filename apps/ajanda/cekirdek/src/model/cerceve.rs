//! `/ajanda` çerçeveleri (`ajanda.ts` "Yukarı", "Aşağı") ve çözücüler (`cozumle`, `ajandaYukariCoz`,
//! `ajandaAsagiCoz`). Uygulama aşağıyı çözer, yukarıyı kodlar; yukarı çözücü vektör eşliği ve kendi
//! çıktısını denetlemek içindir.
//!
//! Bilinen ayrışmalar (vektörlerde yok; ikisi de çerçeveyi reddeder ya da bağlantıyı kapatır):
//! - JSON'da eşsiz vekil kaçışı (`"\ud800"`): JS ayrıştırır, şema yalnız metin kuralı olan alanlarda
//!   reddeder; `serde_json` her yerde reddeder. Fark yalnız kuralsız alanlarda (`error.detail`,
//!   `pair_request.etiket`, yukarı zarfında `islem` gövdesi) görülür: Rust `gecersiz_mesaj` der.
//! - Taşan sayı (`1e400`): JS `Infinity` yapar (`v`'de `protokol_uyumsuz`), `serde_json`
//!   ayrıştırmaz (`gecersiz_mesaj`).
//! - 128'den derin iç içe yapı: `serde_json` reddeder (yalnız zarfın `islem` gövdesinde anlamlı).

use super::islem::{AjandaGecmisGirdisi, AjandaIslem, AjandaKanalHatasi, AjandaRetNedeni};
use super::json::{
    Nesne, SemaHatasi, Sonuc, Yazici, dizi_oku, dizi_yaz, hata, mantik, metin, metin_sabiti, sayi_sabiti,
};
use super::kayit::{
    AjandaAlani, AjandaKaydi, alan_listesi_oku, alan_listesi_yaz, revizyon_oku, son_revizyon_oku, zaman_ms_oku,
};
use super::metin::{base64_oku, desenli_oku, opak_id_oku, utf16_uzunluk};
use super::sinirlar::{AJANDA_SURUMU, AZAMI_CERCEVE_KANAL, ajanda::GECMIS_SAYFA, genel};
use serde_json::Value;

/// `pair_request` ve QR'daki eşleştirme kodu: 6-32, `^[A-Z0-9]+$`.
pub fn eslestirme_kodu_oku(v: &Value, yol: &str) -> Sonuc<String> {
    desenli_oku(v, yol, genel::ESLESTIRME_KODU_MIN, genel::ESLESTIRME_KODU_MAX, |c| {
        c.is_ascii_uppercase() || c.is_ascii_digit()
    })
}

pub fn acik_anahtar_oku(v: &Value, yol: &str) -> Sonuc<String> {
    base64_oku(v, yol, 1, genel::ACIK_ANAHTAR_MAX)
}

pub fn imza_oku(v: &Value, yol: &str) -> Sonuc<String> {
    base64_oku(v, yol, 1, genel::IMZA_MAX)
}

pub fn nonce_oku(v: &Value, yol: &str) -> Sonuc<String> {
    base64_oku(v, yol, genel::NONCE_MIN, genel::NONCE_MAX)
}

/// Telafi izi: sunucu kopyasında revizyonu `son_rev` olan kaydın kimliği ve `guncelleme_ms`'i.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct AjandaRevIzi {
    pub kayit_id: String,
    pub guncelleme_ms: i64,
}

impl AjandaRevIzi {
    pub fn oku(v: &Value, yol: &str) -> Sonuc<Self> {
        let mut n = Nesne::ac(v, yol)?;
        let iz = AjandaRevIzi {
            kayit_id: n.zorunlu("kayit_id", opak_id_oku)?,
            guncelleme_ms: n.zorunlu("guncelleme_ms", zaman_ms_oku)?,
        };
        n.bitir()?;
        Ok(iz)
    }

    pub fn json(&self) -> Value {
        Yazici::yeni().alan("kayit_id", self.kayit_id.as_str()).alan("guncelleme_ms", self.guncelleme_ms).bitir()
    }
}

/// Yukarı: ajanda uygulaması -> PC.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AjandaYukari {
    /// Kapsam alanı yoktur: kapsamı PC'deki eşleştirme penceresi belirler. `platform` hep `android`.
    PairRequest { kod: String, public_key: String, etiket: Option<String> },
    Hello {
        device_id: String,
        son_rev: i64,
        depo_id: Option<String>,
        son_rev_izi: Option<AjandaRevIzi>,
        client_nonce: String,
    },
    AuthResponse { signature: String },
    Islem { islem_id: String, islem: AjandaIslem },
    GecmisIste { istek_id: String, kayit_id: String, once_rev: Option<i64> },
}

/// Aşağı: PC -> ajanda uygulaması.
#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(
    clippy::large_enum_variant,
    reason = "çerçeve ileti başına bir kez çözülüp hemen tüketilir; Box her kurulum ve eşleşmeyi bozar, kazancı yok"
)]
pub enum AjandaAsagi {
    /// `ok` ise `device_id`, `server_public_key`, `kapsam` (hep `ajanda`) var, `code` yok; değilse tersi.
    PairResult { ok: bool, device_id: Option<String>, server_public_key: Option<String>, code: Option<AjandaKanalHatasi> },
    AuthChallenge { server_nonce: String, server_signature: String },
    Welcome { depo_id: String, bas_rev: i64, tam: bool, server_time_ms: i64 },
    Kayit { kayit: AjandaKaydi },
    Esitlendi { rev: i64 },
    IslemSonucu {
        islem_id: String,
        ok: bool,
        kayit_id: Option<String>,
        rev: Option<i64>,
        korunan_alanlar: Option<Vec<AjandaAlani>>,
        code: Option<AjandaRetNedeni>,
    },
    Gecmis {
        istek_id: String,
        kayit_id: String,
        girdiler: Vec<AjandaGecmisGirdisi>,
        devami: bool,
        code: Option<AjandaRetNedeni>,
    },
    Error { code: AjandaKanalHatasi, detail: Option<String> },
}

/// `CozumHatasi`: çözücünün üç sonucu.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CozumKodu {
    MesajCokBuyuk,
    GecersizMesaj,
    ProtokolUyumsuz,
}

impl CozumKodu {
    pub fn ad(self) -> &'static str {
        match self {
            CozumKodu::MesajCokBuyuk => "mesaj_cok_buyuk",
            CozumKodu::GecersizMesaj => "gecersiz_mesaj",
            CozumKodu::ProtokolUyumsuz => "protokol_uyumsuz",
        }
    }

    pub fn kanal_hatasi(self) -> AjandaKanalHatasi {
        match self {
            CozumKodu::MesajCokBuyuk => AjandaKanalHatasi::MesajCokBuyuk,
            CozumKodu::GecersizMesaj => AjandaKanalHatasi::GecersizMesaj,
            CozumKodu::ProtokolUyumsuz => AjandaKanalHatasi::ProtokolUyumsuz,
        }
    }
}

/// Çözüm hatası. `yollar` yalnız alan yollarıdır (gelen değer yok; günlüğe yazılabilir).
/// `islem_id` yalnız yukarı çözümde, zarfı geçerli ama gövdesi geçersiz `islem` için.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CozumHatasi {
    pub kod: CozumKodu,
    pub yollar: Vec<String>,
    pub islem_id: Option<String>,
}

fn sema_hatasi(h: SemaHatasi) -> CozumHatasi {
    let yol: String = h.yol.chars().take(genel::YOL_UZUNLUGU).collect();
    CozumHatasi { kod: CozumKodu::GecersizMesaj, yollar: vec![yol], islem_id: None }
}

/// `cozumle`: sırayla boyut (UTF-16 birimi), JSON, sürüm (`v` sayıysa ve 1 değilse
/// `protokol_uyumsuz`), şema. Hiçbir zaman paniklemez.
fn cozumle<T>(ham: &str, sema: impl FnOnce(&Value) -> Sonuc<T>) -> (Result<T, CozumHatasi>, Option<Value>) {
    if ham.len() > AZAMI_CERCEVE_KANAL && utf16_uzunluk(ham) > AZAMI_CERCEVE_KANAL {
        return (Err(CozumHatasi { kod: CozumKodu::MesajCokBuyuk, yollar: vec![], islem_id: None }), None);
    }
    let deger: Value = match serde_json::from_str(ham) {
        Ok(d) => d,
        Err(_) => return (Err(CozumHatasi { kod: CozumKodu::GecersizMesaj, yollar: vec![], islem_id: None }), None),
    };
    if let Some(Value::Number(n)) = deger.as_object().and_then(|o| o.get("v"))
        && n.as_f64() != Some(AJANDA_SURUMU as f64)
    {
        let h = CozumHatasi { kod: CozumKodu::ProtokolUyumsuz, yollar: vec!["v".into()], islem_id: None };
        return (Err(h), Some(deger));
    }
    let sonuc = sema(&deger).map_err(sema_hatasi);
    (sonuc, Some(deger))
}

/// `ajandaMesaj` zarfı: `v` ve `type` okunur, türü döner.
fn zarf<'a>(n: &mut Nesne<'a>) -> Sonuc<&'a str> {
    n.zorunlu("v", |v, y| sayi_sabiti(v, y, AJANDA_SURUMU))?;
    n.zorunlu("type", metin)
}

impl AjandaYukari {
    pub fn tur(&self) -> &'static str {
        match self {
            AjandaYukari::PairRequest { .. } => "pair_request",
            AjandaYukari::Hello { .. } => "hello",
            AjandaYukari::AuthResponse { .. } => "auth_response",
            AjandaYukari::Islem { .. } => "islem",
            AjandaYukari::GecmisIste { .. } => "gecmis_iste",
        }
    }

    pub fn oku(v: &Value) -> Sonuc<Self> {
        let mut n = Nesne::ac(v, "")?;
        let tur = zarf(&mut n)?;
        let m = match tur {
            "pair_request" => {
                let kod = n.zorunlu("kod", eslestirme_kodu_oku)?;
                let public_key = n.zorunlu("public_key", acik_anahtar_oku)?;
                n.zorunlu("platform", |v, y| metin_sabiti(v, y, "android"))?;
                let etiket = n.istege_bagli("etiket", |v, y| {
                    let s = metin(v, y)?;
                    if utf16_uzunluk(s) <= genel::CIHAZ_ETIKETI { Ok(s.to_string()) } else { hata(y, "çok uzun") }
                })?;
                AjandaYukari::PairRequest { kod, public_key, etiket }
            }
            "hello" => AjandaYukari::Hello {
                device_id: n.zorunlu("device_id", opak_id_oku)?,
                son_rev: n.zorunlu("son_rev", son_revizyon_oku)?,
                depo_id: n.istege_bagli("depo_id", opak_id_oku)?,
                son_rev_izi: n.istege_bagli("son_rev_izi", AjandaRevIzi::oku)?,
                client_nonce: n.zorunlu("client_nonce", nonce_oku)?,
            },
            "auth_response" => AjandaYukari::AuthResponse { signature: n.zorunlu("signature", imza_oku)? },
            "islem" => AjandaYukari::Islem {
                islem_id: n.zorunlu("islem_id", opak_id_oku)?,
                islem: n.zorunlu("islem", AjandaIslem::oku)?,
            },
            "gecmis_iste" => AjandaYukari::GecmisIste {
                istek_id: n.zorunlu("istek_id", opak_id_oku)?,
                kayit_id: n.zorunlu("kayit_id", opak_id_oku)?,
                once_rev: n.istege_bagli("once_rev", revizyon_oku)?,
            },
            _ => return hata("type", "bilinmeyen tür"),
        };
        n.bitir()?;
        Ok(m)
    }

    pub fn json(&self) -> Value {
        let y = Yazici::yeni().alan("v", AJANDA_SURUMU).alan("type", self.tur());
        match self {
            AjandaYukari::PairRequest { kod, public_key, etiket } => y
                .alan("kod", kod.as_str())
                .alan("public_key", public_key.as_str())
                .alan("platform", "android")
                .varsa("etiket", etiket.clone()),
            AjandaYukari::Hello { device_id, son_rev, depo_id, son_rev_izi, client_nonce } => y
                .alan("device_id", device_id.as_str())
                .alan("son_rev", *son_rev)
                .varsa("depo_id", depo_id.clone())
                .varsa("son_rev_izi", son_rev_izi.as_ref().map(AjandaRevIzi::json))
                .alan("client_nonce", client_nonce.as_str()),
            AjandaYukari::AuthResponse { signature } => y.alan("signature", signature.as_str()),
            AjandaYukari::Islem { islem_id, islem } => y.alan("islem_id", islem_id.as_str()).alan("islem", islem.json()),
            AjandaYukari::GecmisIste { istek_id, kayit_id, once_rev } => y
                .alan("istek_id", istek_id.as_str())
                .alan("kayit_id", kayit_id.as_str())
                .varsa("once_rev", *once_rev),
        }
        .bitir()
    }

    /// Kablo metni. Uygulamanın yolladığı her çerçeve bundan geçer.
    pub fn kodla(&self) -> String {
        self.json().to_string()
    }
}

impl AjandaAsagi {
    pub fn tur(&self) -> &'static str {
        match self {
            AjandaAsagi::PairResult { .. } => "pair_result",
            AjandaAsagi::AuthChallenge { .. } => "auth_challenge",
            AjandaAsagi::Welcome { .. } => "welcome",
            AjandaAsagi::Kayit { .. } => "kayit",
            AjandaAsagi::Esitlendi { .. } => "esitlendi",
            AjandaAsagi::IslemSonucu { .. } => "islem_sonucu",
            AjandaAsagi::Gecmis { .. } => "gecmis",
            AjandaAsagi::Error { .. } => "error",
        }
    }

    pub fn oku(v: &Value) -> Sonuc<Self> {
        let mut n = Nesne::ac(v, "")?;
        let tur = zarf(&mut n)?;
        let m = match tur {
            "pair_result" => {
                let ok = n.zorunlu("ok", mantik)?;
                let device_id = n.istege_bagli("device_id", opak_id_oku)?;
                let server_public_key = n.istege_bagli("server_public_key", acik_anahtar_oku)?;
                let kapsam = n.istege_bagli("kapsam", |v, y| metin_sabiti(v, y, "ajanda"))?;
                let code = n.istege_bagli("code", AjandaKanalHatasi::oku)?;
                let tutarli = if ok {
                    device_id.is_some() && server_public_key.is_some() && kapsam.is_some() && code.is_none()
                } else {
                    code.is_some() && device_id.is_none() && server_public_key.is_none() && kapsam.is_none()
                };
                n.bitir()?;
                if !tutarli {
                    return hata("", "ok ile alanlar uyuşmuyor");
                }
                return Ok(AjandaAsagi::PairResult { ok, device_id, server_public_key, code });
            }
            "auth_challenge" => AjandaAsagi::AuthChallenge {
                server_nonce: n.zorunlu("server_nonce", nonce_oku)?,
                server_signature: n.zorunlu("server_signature", imza_oku)?,
            },
            "welcome" => AjandaAsagi::Welcome {
                depo_id: n.zorunlu("depo_id", opak_id_oku)?,
                bas_rev: n.zorunlu("bas_rev", son_revizyon_oku)?,
                tam: n.zorunlu("tam", mantik)?,
                server_time_ms: n.zorunlu("server_time_ms", zaman_ms_oku)?,
            },
            "kayit" => AjandaAsagi::Kayit { kayit: n.zorunlu("kayit", AjandaKaydi::oku)? },
            "esitlendi" => AjandaAsagi::Esitlendi { rev: n.zorunlu("rev", son_revizyon_oku)? },
            "islem_sonucu" => {
                let m = AjandaAsagi::IslemSonucu {
                    islem_id: n.zorunlu("islem_id", opak_id_oku)?,
                    ok: n.zorunlu("ok", mantik)?,
                    kayit_id: n.istege_bagli("kayit_id", opak_id_oku)?,
                    rev: n.istege_bagli("rev", revizyon_oku)?,
                    korunan_alanlar: n.istege_bagli("korunan_alanlar", alan_listesi_oku)?,
                    code: n.istege_bagli("code", AjandaRetNedeni::oku)?,
                };
                n.bitir()?;
                let AjandaAsagi::IslemSonucu { ok, rev, code, .. } = &m else { unreachable!() };
                let tutarli = if *ok { code.is_none() } else { code.is_some() && rev.is_none() };
                if !tutarli {
                    return hata("", "ok, rev ve code tutarsız");
                }
                return Ok(m);
            }
            "gecmis" => {
                let istek_id = n.zorunlu("istek_id", opak_id_oku)?;
                let kayit_id = n.zorunlu("kayit_id", opak_id_oku)?;
                let girdiler = n.zorunlu("girdiler", |v, y| {
                    let l = dizi_oku(v, y, GECMIS_SAYFA, AjandaGecmisGirdisi::oku)?;
                    if l.windows(2).all(|w| w[0].rev > w[1].rev) { Ok(l) } else { hata(y, "rev kesin azalan olmalı") }
                })?;
                let devami = n.zorunlu("devami", mantik)?;
                let code = n.istege_bagli("code", AjandaRetNedeni::oku)?;
                n.bitir()?;
                if code.is_some() && (!girdiler.is_empty() || devami) {
                    return hata("", "code ile girdi olmaz");
                }
                return Ok(AjandaAsagi::Gecmis { istek_id, kayit_id, girdiler, devami, code });
            }
            "error" => AjandaAsagi::Error {
                code: n.zorunlu("code", AjandaKanalHatasi::oku)?,
                detail: n.istege_bagli("detail", |v, y| {
                    let s = metin(v, y)?;
                    if utf16_uzunluk(s) <= genel::HATA_DETAYI { Ok(s.to_string()) } else { hata(y, "çok uzun") }
                })?,
            },
            _ => return hata("type", "bilinmeyen tür"),
        };
        n.bitir()?;
        Ok(m)
    }

    pub fn json(&self) -> Value {
        let y = Yazici::yeni().alan("v", AJANDA_SURUMU).alan("type", self.tur());
        match self {
            AjandaAsagi::PairResult { ok, device_id, server_public_key, code } => y
                .alan("ok", *ok)
                .varsa("device_id", device_id.clone())
                .varsa("server_public_key", server_public_key.clone())
                .varsa("kapsam", ok.then_some("ajanda"))
                .varsa("code", code.map(AjandaKanalHatasi::json)),
            AjandaAsagi::AuthChallenge { server_nonce, server_signature } => {
                y.alan("server_nonce", server_nonce.as_str()).alan("server_signature", server_signature.as_str())
            }
            AjandaAsagi::Welcome { depo_id, bas_rev, tam, server_time_ms } => y
                .alan("depo_id", depo_id.as_str())
                .alan("bas_rev", *bas_rev)
                .alan("tam", *tam)
                .alan("server_time_ms", *server_time_ms),
            AjandaAsagi::Kayit { kayit } => y.alan("kayit", kayit.json()),
            AjandaAsagi::Esitlendi { rev } => y.alan("rev", *rev),
            AjandaAsagi::IslemSonucu { islem_id, ok, kayit_id, rev, korunan_alanlar, code } => y
                .alan("islem_id", islem_id.as_str())
                .alan("ok", *ok)
                .varsa("kayit_id", kayit_id.clone())
                .varsa("rev", *rev)
                .varsa("korunan_alanlar", korunan_alanlar.as_deref().map(alan_listesi_yaz))
                .varsa("code", code.map(AjandaRetNedeni::json)),
            AjandaAsagi::Gecmis { istek_id, kayit_id, girdiler, devami, code } => y
                .alan("istek_id", istek_id.as_str())
                .alan("kayit_id", kayit_id.as_str())
                .alan("girdiler", dizi_yaz(girdiler, AjandaGecmisGirdisi::json))
                .alan("devami", *devami)
                .varsa("code", code.map(AjandaRetNedeni::json)),
            AjandaAsagi::Error { code, detail } => y.alan("code", code.json()).varsa("detail", detail.clone()),
        }
        .bitir()
    }

    pub fn kodla(&self) -> String {
        self.json().to_string()
    }
}

/// `ajandaAsagiCoz`: uygulamanın gelen her çerçevesi buradan geçer.
pub fn ajanda_asagi_coz(ham: &str) -> Result<AjandaAsagi, CozumHatasi> {
    cozumle(ham, AjandaAsagi::oku).0
}

/// `ajandaYukariCoz`: `gecersiz_mesaj`'da zarf (`v`, `type:"islem"`, geçerli `islem_id`, başka alan
/// yok; `islem` herhangi bir değer ya da yok) geçerliyse `islem_id` de döner.
pub fn ajanda_yukari_coz(ham: &str) -> Result<AjandaYukari, CozumHatasi> {
    let (sonuc, deger) = cozumle(ham, AjandaYukari::oku);
    match (sonuc, deger) {
        (Err(mut h), Some(deger)) if h.kod == CozumKodu::GecersizMesaj => {
            h.islem_id = islem_zarfi(&deger);
            Err(h)
        }
        (sonuc, _) => sonuc,
    }
}

/// `AjandaIslemZarfi`: `{v, type:"islem", islem_id, islem?: unknown}`, katı.
fn islem_zarfi(deger: &Value) -> Option<String> {
    let mut n = Nesne::ac(deger, "").ok()?;
    n.zorunlu("v", |v, y| sayi_sabiti(v, y, AJANDA_SURUMU)).ok()?;
    n.zorunlu("type", |v, y| metin_sabiti(v, y, "islem")).ok()?;
    let islem_id = n.zorunlu("islem_id", opak_id_oku).ok()?;
    let _ = n.ham("islem");
    n.bitir().ok()?;
    Some(islem_id)
}
