//! `/ajanda` çerçeveleri (`ajanda.ts` "Çerçeveler: sürüme göre kurulur") ve çözücüler (`surumluCozumle`,
//! `ajandaYukariCoz`, `ajandaAsagiCoz`, `ajandaAsagiSurume`). Her sürüm kendi içinde katıdır: okuyucu ve
//! yazıcı sürümü değişken olarak alır (`oku(v, surum)`, `json_surum`). Uygulama aşağıyı çözer, yukarıyı
//! kodlar; yukarı çözücü vektör eşliği ve kendi çıktısını denetlemek içindir, aşağı uyarlama servisin
//! kuralıdır (uygulamada vektör eşliği için).
//!
//! Geçiş: sürümsüz `json`/`kodla`/`ajanda_asagi_coz`/`ajanda_yukari_coz` bugünkü kanalın sürümüyle
//! (`surum::KANAL_SURUMU`, v2) çalışır; `motor/kanal.rs` bunlarla değişmeden derlenir ve aynı davranır.
//!
//! Bilinen ayrışmalar (vektörlerde yok; ikisi de çerçeveyi reddeder ya da bağlantıyı kapatır):
//! - JSON'da eşsiz vekil kaçışı (`"\ud800"`): JS ayrıştırır, şema yalnız metin kuralı olan alanlarda
//!   reddeder; `serde_json` her yerde reddeder. Fark yalnız kuralsız alanlarda (`error.detail`,
//!   `pair_request.etiket`, yukarı zarfında `islem` gövdesi) görülür: Rust `gecersiz_mesaj` der.
//! - Taşan sayı (`1e400`): JS `Infinity` yapar (`v`'de `protokol_uyumsuz`), `serde_json`
//!   ayrıştırmaz (`gecersiz_mesaj`).
//! - 128'den derin iç içe yapı: `serde_json` reddeder (yalnız zarfın `islem` gövdesinde anlamlı).

use super::alan::{AjandaEkRetKodu, ajanda_base64_bayti, ek_bayti_oku, ek_ofseti_oku, ek_ozeti_oku, ek_verisi_oku, yetenekler_oku, yetenekler_yaz};
use super::islem::{AjandaGecmisGirdisi, AjandaIslem, AjandaKanalHatasi, AjandaRetNedeni};
use super::json::{
    Nesne, SemaHatasi, Sonuc, Yazici, dizi_oku, hata, mantik, metin, metin_sabiti, sayi_sabiti,
};
use super::kayit::{
    AjandaAlani, AjandaKaydi, alan_listesi_oku_surum, alan_listesi_yaz_surum, revizyon_oku, son_revizyon_oku,
    zaman_ms_oku,
};
use super::metin::{base64_oku, desenli_oku, opak_id_oku, utf16_uzunluk};
use super::sinirlar::{AZAMI_CERCEVE_KANAL, ajanda::{EK_BAYT, GECMIS_SAYFA}, genel};
use super::surum::{KANAL_SURUMU, Surum};
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
#[allow(
    clippy::large_enum_variant,
    reason = "çerçeve ileti başına bir kez kurulup hemen kodlanır; Box her kurulum ve eşleşmeyi bozar, kazancı yok"
)]
pub enum AjandaYukari {
    /// Kapsam alanı yoktur: kapsamı PC'deki eşleştirme penceresi belirler. `platform` hep `android`.
    PairRequest { kod: String, public_key: String, etiket: Option<String> },
    /// `yetenekler` alanı olmayan `hello` (her sürümde).
    Hello {
        device_id: String,
        son_rev: i64,
        depo_id: Option<String>,
        son_rev_izi: Option<AjandaRevIzi>,
        client_nonce: String,
    },
    /// v3 `hello`, `yetenekler` ile (istemcinin istedikleri; boş liste de geçerlidir). `Hello`'dan ayrı
    /// değişkendir çünkü `motor/kanal.rs` `Hello`'yu alan alan kurar; kanal aşaması ikisini birleştirebilir.
    /// v2'ye yazılırken `yetenekler` yazılmaz.
    HelloYetenekli {
        device_id: String,
        son_rev: i64,
        depo_id: Option<String>,
        son_rev_izi: Option<AjandaRevIzi>,
        client_nonce: String,
        yetenekler: Vec<String>,
    },
    AuthResponse { signature: String },
    Islem { islem_id: String, islem: AjandaIslem },
    GecmisIste { istek_id: String, kayit_id: String, once_rev: Option<i64> },
    /// v3, ek yedeği: yükleme isteği (dur-bekle).
    EkYukle { istek_id: String, kayit_id: String, ek_id: String, ozet: String, bayt: i64 },
    /// v3, ek yedeği: yüklenen parça (iki yönde aynı şekil). `ofset` + çözülmüş bayt <= `EK_BAYT`.
    EkParca { ek_id: String, ofset: i64, veri: String },
    /// v3, ek yedeği: indirme isteği.
    EkIste { istek_id: String, ek_id: String, ozet: String, ofset: i64 },
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
    /// `yetenekler` (v3, zorunlu): istenenlerle sunulanların kesişimi. v2'de `None`.
    Welcome { depo_id: String, bas_rev: i64, tam: bool, server_time_ms: i64, yetenekler: Option<Vec<String>> },
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
    /// v3, ek yedeği: yüklemede `alinan`, indirmede `gonderilen` (tam biri). `tamam`: dosya bütün ve doğrulanmış.
    EkDurum { ek_id: String, alinan: Option<i64>, gonderilen: Option<i64>, tamam: bool },
    /// v3, ek yedeği: indirilen parça.
    EkParca { ek_id: String, ofset: i64, veri: String },
    /// v3, ek yedeği: ret (bağlantı kapanmaz).
    EkRet { ek_id: String, code: AjandaEkRetKodu },
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

fn protokol_uyumsuz(yol: &str) -> CozumHatasi {
    CozumHatasi { kod: CozumKodu::ProtokolUyumsuz, yollar: vec![yol.into()], islem_id: None }
}

/// Bağlantının kabul ettiği sürümler: sabitlenmişse yalnız o, değilse (ilk yukarı çerçeve) kümenin hepsi.
fn kabul_kumesi(baglanti: Option<Surum>) -> Vec<Surum> {
    baglanti.map_or_else(|| Surum::HEPSI.to_vec(), |s| vec![s])
}

/// `surumluCozumle`: sırayla boyut (UTF-16 birimi), JSON, sürüm, şema. Sayı olan `v` kümede değilse
/// şemadan önce `protokol_uyumsuz`; kümedeyse çerçeve yalnız o sürümün şemasıyla denetlenir. Sayı olmayan
/// ya da eksik `v` kümenin en büyüğünün şemasında `gecersiz_mesaj` olur. Hiçbir zaman paniklemez.
fn cozumle<T>(
    ham: &str,
    kabul: &[Surum],
    sema: impl FnOnce(&Value, Surum) -> Sonuc<T>,
) -> (Result<(Surum, T), CozumHatasi>, Option<Value>) {
    if ham.len() > AZAMI_CERCEVE_KANAL && utf16_uzunluk(ham) > AZAMI_CERCEVE_KANAL {
        return (Err(CozumHatasi { kod: CozumKodu::MesajCokBuyuk, yollar: vec![], islem_id: None }), None);
    }
    let deger: Value = match serde_json::from_str(ham) {
        Ok(d) => d,
        Err(_) => return (Err(CozumHatasi { kod: CozumKodu::GecersizMesaj, yollar: vec![], islem_id: None }), None),
    };
    let s = match deger.as_object().and_then(|o| o.get("v")) {
        Some(Value::Number(n)) => match Surum::sayidan(n).filter(|s| kabul.contains(s)) {
            Some(s) => s,
            None => return (Err(protokol_uyumsuz("v")), Some(deger)),
        },
        _ => *kabul.iter().max().expect("kabul kümesi boş değil"),
    };
    let sonuc = sema(&deger, s).map(|m| (s, m)).map_err(sema_hatasi);
    (sonuc, Some(deger))
}

/// `ajandaMesaj` zarfı: `v` (sürümün kendisi) ve `type` okunur, türü döner.
fn zarf<'a>(n: &mut Nesne<'a>, s: Surum) -> Sonuc<&'a str> {
    n.zorunlu("v", |v, y| sayi_sabiti(v, y, s.no()))?;
    n.zorunlu("type", metin)
}

/// Yalnız v3'ten itibaren var olan çerçeve türü v2'de bilinmeyen türdür.
fn v3_turu(s: Surum) -> Sonuc<()> {
    if s.v3_mu() { Ok(()) } else { hata("type", "bilinmeyen tür") }
}

/// `ek_parca`'nın gövdesi (iki yönde aynı): `ofset` + çözülmüş bayt <= `EK_BAYT`.
fn ek_parca_oku(n: &mut Nesne<'_>) -> Sonuc<(String, i64, String)> {
    let ek_id = n.zorunlu("ek_id", opak_id_oku)?;
    let ofset = n.zorunlu("ofset", ek_ofseti_oku)?;
    let veri = n.zorunlu("veri", ek_verisi_oku)?;
    Ok((ek_id, ofset, veri))
}

fn ek_parca_kurali(ofset: i64, veri: &str) -> Sonuc<()> {
    if ofset + ajanda_base64_bayti(veri) <= EK_BAYT { Ok(()) } else { hata("ofset", "parça ek sınırını aşıyor") }
}

fn hello_yaz(
    y: Yazici,
    device_id: &str,
    son_rev: i64,
    depo_id: &Option<String>,
    son_rev_izi: &Option<AjandaRevIzi>,
    client_nonce: &str,
) -> Yazici {
    y.alan("device_id", device_id)
        .alan("son_rev", son_rev)
        .varsa("depo_id", depo_id.clone())
        .varsa("son_rev_izi", son_rev_izi.as_ref().map(AjandaRevIzi::json))
        .alan("client_nonce", client_nonce)
}

impl AjandaYukari {
    pub fn tur(&self) -> &'static str {
        match self {
            AjandaYukari::PairRequest { .. } => "pair_request",
            AjandaYukari::Hello { .. } | AjandaYukari::HelloYetenekli { .. } => "hello",
            AjandaYukari::AuthResponse { .. } => "auth_response",
            AjandaYukari::Islem { .. } => "islem",
            AjandaYukari::GecmisIste { .. } => "gecmis_iste",
            AjandaYukari::EkYukle { .. } => "ek_yukle",
            AjandaYukari::EkParca { .. } => "ek_parca",
            AjandaYukari::EkIste { .. } => "ek_iste",
        }
    }

    /// Sürümün şemasıyla (`AJANDA_CERCEVE_SEMALARI[s].Yukari`).
    pub fn oku(v: &Value, s: Surum) -> Sonuc<Self> {
        let mut n = Nesne::ac(v, "")?;
        let tur = zarf(&mut n, s)?;
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
            "hello" => {
                let device_id = n.zorunlu("device_id", opak_id_oku)?;
                let son_rev = n.zorunlu("son_rev", son_revizyon_oku)?;
                let depo_id = n.istege_bagli("depo_id", opak_id_oku)?;
                let son_rev_izi = n.istege_bagli("son_rev_izi", AjandaRevIzi::oku)?;
                let client_nonce = n.zorunlu("client_nonce", nonce_oku)?;
                let yetenekler = if s.v3_mu() { n.istege_bagli("yetenekler", yetenekler_oku)? } else { None };
                match yetenekler {
                    None => AjandaYukari::Hello { device_id, son_rev, depo_id, son_rev_izi, client_nonce },
                    Some(yetenekler) => {
                        AjandaYukari::HelloYetenekli { device_id, son_rev, depo_id, son_rev_izi, client_nonce, yetenekler }
                    }
                }
            }
            "auth_response" => AjandaYukari::AuthResponse { signature: n.zorunlu("signature", imza_oku)? },
            "islem" => AjandaYukari::Islem {
                islem_id: n.zorunlu("islem_id", opak_id_oku)?,
                islem: n.zorunlu("islem", |v, y| AjandaIslem::oku_surum(v, y, s))?,
            },
            "gecmis_iste" => AjandaYukari::GecmisIste {
                istek_id: n.zorunlu("istek_id", opak_id_oku)?,
                kayit_id: n.zorunlu("kayit_id", opak_id_oku)?,
                once_rev: n.istege_bagli("once_rev", revizyon_oku)?,
            },
            "ek_yukle" => {
                v3_turu(s)?;
                AjandaYukari::EkYukle {
                    istek_id: n.zorunlu("istek_id", opak_id_oku)?,
                    kayit_id: n.zorunlu("kayit_id", opak_id_oku)?,
                    ek_id: n.zorunlu("ek_id", opak_id_oku)?,
                    ozet: n.zorunlu("ozet", ek_ozeti_oku)?,
                    bayt: n.zorunlu("bayt", ek_bayti_oku)?,
                }
            }
            "ek_parca" => {
                v3_turu(s)?;
                let (ek_id, ofset, veri) = ek_parca_oku(&mut n)?;
                n.bitir()?;
                ek_parca_kurali(ofset, &veri)?;
                return Ok(AjandaYukari::EkParca { ek_id, ofset, veri });
            }
            "ek_iste" => {
                v3_turu(s)?;
                AjandaYukari::EkIste {
                    istek_id: n.zorunlu("istek_id", opak_id_oku)?,
                    ek_id: n.zorunlu("ek_id", opak_id_oku)?,
                    ozet: n.zorunlu("ozet", ek_ozeti_oku)?,
                    ofset: n.zorunlu("ofset", ek_ofseti_oku)?,
                }
            }
            _ => return hata("type", "bilinmeyen tür"),
        };
        n.bitir()?;
        Ok(m)
    }

    /// Bugünkü kanalın sürümüyle (`KANAL_SURUMU`).
    pub fn json(&self) -> Value {
        self.json_surum(KANAL_SURUMU)
    }

    /// Sürümün biçimi (`v` dahil). O sürümde olmayan alanlar yazılmaz (v2'de `yetenekler`, gövdelerin v3
    /// alanları); o sürümde olmayan çerçeve (v2'de `ek_*`) yine yazılır ama o sürümün şemasından geçmez.
    pub fn json_surum(&self, s: Surum) -> Value {
        let y = Yazici::yeni().alan("v", s.no()).alan("type", self.tur());
        match self {
            AjandaYukari::PairRequest { kod, public_key, etiket } => y
                .alan("kod", kod.as_str())
                .alan("public_key", public_key.as_str())
                .alan("platform", "android")
                .varsa("etiket", etiket.clone()),
            AjandaYukari::Hello { device_id, son_rev, depo_id, son_rev_izi, client_nonce } => {
                hello_yaz(y, device_id, *son_rev, depo_id, son_rev_izi, client_nonce)
            }
            AjandaYukari::HelloYetenekli { device_id, son_rev, depo_id, son_rev_izi, client_nonce, yetenekler } => {
                hello_yaz(y, device_id, *son_rev, depo_id, son_rev_izi, client_nonce)
                    .varsa("yetenekler", s.v3_mu().then(|| yetenekler_yaz(yetenekler)))
            }
            AjandaYukari::AuthResponse { signature } => y.alan("signature", signature.as_str()),
            AjandaYukari::Islem { islem_id, islem } => y.alan("islem_id", islem_id.as_str()).alan("islem", islem.json_surum(s)),
            AjandaYukari::GecmisIste { istek_id, kayit_id, once_rev } => y
                .alan("istek_id", istek_id.as_str())
                .alan("kayit_id", kayit_id.as_str())
                .varsa("once_rev", *once_rev),
            AjandaYukari::EkYukle { istek_id, kayit_id, ek_id, ozet, bayt } => y
                .alan("istek_id", istek_id.as_str())
                .alan("kayit_id", kayit_id.as_str())
                .alan("ek_id", ek_id.as_str())
                .alan("ozet", ozet.as_str())
                .alan("bayt", *bayt),
            AjandaYukari::EkParca { ek_id, ofset, veri } => {
                y.alan("ek_id", ek_id.as_str()).alan("ofset", *ofset).alan("veri", veri.as_str())
            }
            AjandaYukari::EkIste { istek_id, ek_id, ozet, ofset } => y
                .alan("istek_id", istek_id.as_str())
                .alan("ek_id", ek_id.as_str())
                .alan("ozet", ozet.as_str())
                .alan("ofset", *ofset),
        }
        .bitir()
    }

    /// Kablo metni, bugünkü kanalın sürümüyle. Uygulamanın yolladığı her çerçeve bundan geçer.
    pub fn kodla(&self) -> String {
        self.json().to_string()
    }

    pub fn kodla_surum(&self, s: Surum) -> String {
        self.json_surum(s).to_string()
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
            AjandaAsagi::EkDurum { .. } => "ek_durum",
            AjandaAsagi::EkParca { .. } => "ek_parca",
            AjandaAsagi::EkRet { .. } => "ek_ret",
        }
    }

    /// Yalnız v3'ten itibaren var olan çerçeve mi (ek yedeği).
    pub fn yalniz_v3_mu(&self) -> bool {
        matches!(self, AjandaAsagi::EkDurum { .. } | AjandaAsagi::EkParca { .. } | AjandaAsagi::EkRet { .. })
    }

    /// Sürümün şemasıyla (`AJANDA_CERCEVE_SEMALARI[s].Asagi`).
    pub fn oku(v: &Value, s: Surum) -> Sonuc<Self> {
        let mut n = Nesne::ac(v, "")?;
        let tur = zarf(&mut n, s)?;
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
                yetenekler: if s.v3_mu() { Some(n.zorunlu("yetenekler", yetenekler_oku)?) } else { None },
            },
            "kayit" => AjandaAsagi::Kayit { kayit: n.zorunlu("kayit", |v, y| AjandaKaydi::oku_surum(v, y, s))? },
            "esitlendi" => AjandaAsagi::Esitlendi { rev: n.zorunlu("rev", son_revizyon_oku)? },
            "islem_sonucu" => {
                let islem_id = n.zorunlu("islem_id", opak_id_oku)?;
                let ok = n.zorunlu("ok", mantik)?;
                let kayit_id = n.istege_bagli("kayit_id", opak_id_oku)?;
                let rev = n.istege_bagli("rev", revizyon_oku)?;
                let korunan_alanlar = n.istege_bagli("korunan_alanlar", |v, y| alan_listesi_oku_surum(v, y, s))?;
                let code = n.istege_bagli("code", AjandaRetNedeni::oku)?;
                n.bitir()?;
                let tutarli = if ok { code.is_none() } else { code.is_some() && rev.is_none() };
                if !tutarli {
                    return hata("", "ok, rev ve code tutarsız");
                }
                return Ok(AjandaAsagi::IslemSonucu { islem_id, ok, kayit_id, rev, korunan_alanlar, code });
            }
            "gecmis" => {
                let istek_id = n.zorunlu("istek_id", opak_id_oku)?;
                let kayit_id = n.zorunlu("kayit_id", opak_id_oku)?;
                let girdiler = n.zorunlu("girdiler", |v, y| {
                    let l = dizi_oku(v, y, GECMIS_SAYFA, |v, y| AjandaGecmisGirdisi::oku_surum(v, y, s))?;
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
            "ek_durum" => {
                v3_turu(s)?;
                let ek_id = n.zorunlu("ek_id", opak_id_oku)?;
                let alinan = n.istege_bagli("alinan", ek_ofseti_oku)?;
                let gonderilen = n.istege_bagli("gonderilen", ek_ofseti_oku)?;
                let tamam = n.zorunlu("tamam", mantik)?;
                n.bitir()?;
                if alinan.is_some() == gonderilen.is_some() {
                    return hata("", "alinan ya da gonderilen: tam biri");
                }
                return Ok(AjandaAsagi::EkDurum { ek_id, alinan, gonderilen, tamam });
            }
            "ek_parca" => {
                v3_turu(s)?;
                let (ek_id, ofset, veri) = ek_parca_oku(&mut n)?;
                n.bitir()?;
                ek_parca_kurali(ofset, &veri)?;
                return Ok(AjandaAsagi::EkParca { ek_id, ofset, veri });
            }
            "ek_ret" => {
                v3_turu(s)?;
                AjandaAsagi::EkRet { ek_id: n.zorunlu("ek_id", opak_id_oku)?, code: n.zorunlu("code", AjandaEkRetKodu::oku)? }
            }
            _ => return hata("type", "bilinmeyen tür"),
        };
        n.bitir()?;
        Ok(m)
    }

    /// Bugünkü kanalın sürümüyle (`KANAL_SURUMU`).
    pub fn json(&self) -> Value {
        self.json_surum(KANAL_SURUMU)
    }

    /// Sürümün biçimi (`v` dahil): o sürümün bilmediği alanlar yazılmaz, alan listeleri o sürümün
    /// kümesine süzülür. Bu, servisin aşağı uyarlamasının (`v3tenV2ye`) yazma yarısıdır; şema denetimi
    /// ve karşılığı olmayan çerçeve `ajanda_asagi_surume`'dedir.
    pub fn json_surum(&self, s: Surum) -> Value {
        let y = Yazici::yeni().alan("v", s.no()).alan("type", self.tur());
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
            AjandaAsagi::Welcome { depo_id, bas_rev, tam, server_time_ms, yetenekler } => y
                .alan("depo_id", depo_id.as_str())
                .alan("bas_rev", *bas_rev)
                .alan("tam", *tam)
                .alan("server_time_ms", *server_time_ms)
                .varsa("yetenekler", yetenekler.as_deref().filter(|_| s.v3_mu()).map(yetenekler_yaz)),
            AjandaAsagi::Kayit { kayit } => y.alan("kayit", kayit.json_surum(s)),
            AjandaAsagi::Esitlendi { rev } => y.alan("rev", *rev),
            AjandaAsagi::IslemSonucu { islem_id, ok, kayit_id, rev, korunan_alanlar, code } => y
                .alan("islem_id", islem_id.as_str())
                .alan("ok", *ok)
                .varsa("kayit_id", kayit_id.clone())
                .varsa("rev", *rev)
                .varsa("korunan_alanlar", korunan_alanlar.as_deref().map(|l| alan_listesi_yaz_surum(l, s)))
                .varsa("code", code.map(AjandaRetNedeni::json)),
            AjandaAsagi::Gecmis { istek_id, kayit_id, girdiler, devami, code } => y
                .alan("istek_id", istek_id.as_str())
                .alan("kayit_id", kayit_id.as_str())
                .alan("girdiler", Value::Array(girdiler.iter().map(|g| g.json_surum(s)).collect()))
                .alan("devami", *devami)
                .varsa("code", code.map(AjandaRetNedeni::json)),
            AjandaAsagi::Error { code, detail } => y.alan("code", code.json()).varsa("detail", detail.clone()),
            AjandaAsagi::EkDurum { ek_id, alinan, gonderilen, tamam } => y
                .alan("ek_id", ek_id.as_str())
                .varsa("alinan", *alinan)
                .varsa("gonderilen", *gonderilen)
                .alan("tamam", *tamam),
            AjandaAsagi::EkParca { ek_id, ofset, veri } => {
                y.alan("ek_id", ek_id.as_str()).alan("ofset", *ofset).alan("veri", veri.as_str())
            }
            AjandaAsagi::EkRet { ek_id, code } => y.alan("ek_id", ek_id.as_str()).alan("code", code.json()),
        }
        .bitir()
    }

    /// Kablo metni, bugünkü kanalın sürümüyle.
    pub fn kodla(&self) -> String {
        self.json().to_string()
    }

    pub fn kodla_surum(&self, s: Surum) -> String {
        self.json_surum(s).to_string()
    }
}

/// `ajandaAsagiCoz(ham, baglanti)`: `baglanti` bağlantının sabitlenmiş sürümü; verilirse yalnız o sürüm
/// kabul edilir (başka sayı `v` `protokol_uyumsuz`), verilmezse kümedeki her sürüm. Döner: çerçevenin
/// sürümü ve çerçeve.
pub fn ajanda_asagi_coz_surum(ham: &str, baglanti: Option<Surum>) -> Result<(Surum, AjandaAsagi), CozumHatasi> {
    cozumle(ham, &kabul_kumesi(baglanti), AjandaAsagi::oku).0
}

/// `ajandaYukariCoz(ham, baglanti)`. `gecersiz_mesaj`'da zarf (`v` kümede, `type:"islem"`, geçerli
/// `islem_id`, başka alan yok; `islem` herhangi bir değer ya da yok) geçerliyse `islem_id` de döner.
pub fn ajanda_yukari_coz_surum(ham: &str, baglanti: Option<Surum>) -> Result<(Surum, AjandaYukari), CozumHatasi> {
    let (sonuc, deger) = cozumle(ham, &kabul_kumesi(baglanti), AjandaYukari::oku);
    match (sonuc, deger) {
        (Err(mut h), Some(deger)) if h.kod == CozumKodu::GecersizMesaj => {
            h.islem_id = islem_zarfi(&deger);
            Err(h)
        }
        (sonuc, _) => sonuc,
    }
}

/// Bugünkü kanal (v2 bağlantı): `ajanda_asagi_coz_surum(ham, Some(KANAL_SURUMU))`. Uygulamanın gelen
/// her çerçevesi buradan geçer.
pub fn ajanda_asagi_coz(ham: &str) -> Result<AjandaAsagi, CozumHatasi> {
    ajanda_asagi_coz_surum(ham, Some(KANAL_SURUMU)).map(|(_, m)| m)
}

/// Bugünkü kanal (v2 bağlantı): `ajanda_yukari_coz_surum(ham, Some(KANAL_SURUMU))`.
pub fn ajanda_yukari_coz(ham: &str) -> Result<AjandaYukari, CozumHatasi> {
    ajanda_yukari_coz_surum(ham, Some(KANAL_SURUMU)).map(|(_, m)| m)
}

/// `AjandaIslemZarfi`: `{v, type:"islem", islem_id, islem?: unknown}`, katı; `v` çerçevenin kendi
/// (desteklenen) sürümü, değilse en yeni sürümün zarfı (ve `v` tutmaz).
fn islem_zarfi(deger: &Value) -> Option<String> {
    let mut n = Nesne::ac(deger, "").ok()?;
    let s = match deger.get("v") {
        Some(Value::Number(v)) => Surum::sayidan(v).unwrap_or(Surum::EN_YENI),
        _ => Surum::EN_YENI,
    };
    n.zorunlu("v", |v, y| sayi_sabiti(v, y, s.no())).ok()?;
    n.zorunlu("type", |v, y| metin_sabiti(v, y, "islem")).ok()?;
    let islem_id = n.zorunlu("islem_id", opak_id_oku).ok()?;
    let _ = n.ham("islem");
    n.bitir().ok()?;
    Some(islem_id)
}

/// `ajandaAsagiSurume(m, v)`: servisin yollayacağı (en yeni modeldeki) çerçeveyi bağlantı sürümüne uyarlar
/// ve o sürümün şemasıyla denetler. O sürümün bilmediği alanlar çıkar, alan listeleri süzülür (`json_surum`).
/// O sürümde karşılığı olmayan çerçeve (v2'de `ek_*`) `protokol_uyumsuz` + `["type"]`; şemadan geçmeyen
/// sonuç `gecersiz_mesaj` (servisin hatasıdır, yollanmaz). Başarıda uyarlanan JSON. En yeni sürümde
/// kimliktir. Uygulamada yalnız vektör eşliği için (servis kuralı).
pub fn ajanda_asagi_surume(m: &AjandaAsagi, v: Surum) -> Result<Value, CozumHatasi> {
    if m.yalniz_v3_mu() && !v.v3_mu() {
        return Err(protokol_uyumsuz("type"));
    }
    let aday = m.json_surum(v);
    AjandaAsagi::oku(&aday, v).map_err(sema_hatasi)?;
    Ok(aday)
}

#[cfg(test)]
mod testler {
    use super::*;

    const HELLO_V2: &str = r#"{"v":2,"type":"hello","device_id":"d1","son_rev":0,"client_nonce":"QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNA=="}"#;

    #[test]
    fn sarmalayicilar_bugunku_kanal_surumunde() {
        // Sürümsüz çözücü v2 bağlantıdır: v3 çerçeve `protokol_uyumsuz`, v2 çerçeve geçer.
        assert!(matches!(ajanda_yukari_coz(HELLO_V2), Ok(AjandaYukari::Hello { .. })));
        let v3 = HELLO_V2.replace("\"v\":2", "\"v\":3");
        assert_eq!(ajanda_yukari_coz(&v3).unwrap_err().kod, CozumKodu::ProtokolUyumsuz);
        assert_eq!(ajanda_asagi_coz(r#"{"v":3,"type":"esitlendi","rev":1}"#).unwrap_err().kod, CozumKodu::ProtokolUyumsuz);
        // Sürümsüz yazıcı v2 yazar.
        let m = AjandaAsagi::Esitlendi { rev: 1 };
        assert_eq!(m.kodla(), r#"{"rev":1,"type":"esitlendi","v":2}"#);
        assert_eq!(m.kodla_surum(Surum::V3), r#"{"rev":1,"type":"esitlendi","v":3}"#);
    }

    #[test]
    fn sabitlenmemis_baglanti_surumu_cercevenin_v_si() {
        let (s, _) = ajanda_yukari_coz_surum(HELLO_V2, None).unwrap();
        assert_eq!(s, Surum::V2);
        let v3 = HELLO_V2.replace("\"v\":2", "\"v\":3.0");
        let (s, m) = ajanda_yukari_coz_surum(&v3, None).unwrap();
        assert_eq!(s, Surum::V3);
        assert!(matches!(m, AjandaYukari::Hello { .. }), "yeteneksiz v3 hello");
        // Metin `v`: en büyük sürümün şemasında `gecersiz_mesaj`.
        let metin_v = HELLO_V2.replace("\"v\":2", "\"v\":\"2\"");
        assert_eq!(ajanda_yukari_coz_surum(&metin_v, None).unwrap_err().kod, CozumKodu::GecersizMesaj);
    }

    #[test]
    fn hello_yetenekli_v2ye_yeteneksiz_yazilir() {
        let m = AjandaYukari::HelloYetenekli {
            device_id: "d1".into(),
            son_rev: 0,
            depo_id: None,
            son_rev_izi: None,
            client_nonce: "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNA==".into(),
            yetenekler: vec!["ek_yedegi".into()],
        };
        let v2 = m.json_surum(Surum::V2);
        assert!(v2.get("yetenekler").is_none());
        assert!(matches!(AjandaYukari::oku(&v2, Surum::V2), Ok(AjandaYukari::Hello { .. })));
        assert_eq!(AjandaYukari::oku(&m.json_surum(Surum::V3), Surum::V3).unwrap(), m);
    }

    #[test]
    fn uyarlama_ek_cercevesi_ve_yeteneksiz_welcome() {
        let ek = AjandaAsagi::EkRet { ek_id: "e1".into(), code: AjandaEkRetKodu::EkYok };
        assert_eq!(ajanda_asagi_surume(&ek, Surum::V2).unwrap_err(), protokol_uyumsuz("type"));
        assert!(ajanda_asagi_surume(&ek, Surum::V3).is_ok());
        // v3'e yeteneksiz welcome servisin hatasıdır: şemadan geçmez.
        let w = AjandaAsagi::Welcome { depo_id: "d".into(), bas_rev: 0, tam: false, server_time_ms: 1, yetenekler: None };
        assert_eq!(ajanda_asagi_surume(&w, Surum::V3).unwrap_err().kod, CozumKodu::GecersizMesaj);
        assert!(ajanda_asagi_surume(&w, Surum::V2).is_ok());
    }

    #[test]
    fn v2de_ek_turu_bilinmeyen_tur() {
        let ham = r#"{"v":2,"type":"ek_ret","ek_id":"e1","code":"ek_yok"}"#;
        let h = ajanda_asagi_coz_surum(ham, Some(Surum::V2)).unwrap_err();
        assert_eq!((h.kod, h.yollar), (CozumKodu::GecersizMesaj, vec!["type".to_string()]));
    }

    #[test]
    fn islem_zarfi_surumun_kendisiyle() {
        // v3 bağlantıda gövdesi geçersiz islem: zarfın `v`'si 3 olduğu için `islem_id` döner.
        let ham = r#"{"v":3,"type":"islem","islem_id":"i1","islem":{"islem":"sil"}}"#;
        assert_eq!(ajanda_yukari_coz_surum(ham, Some(Surum::V3)).unwrap_err().islem_id.as_deref(), Some("i1"));
        assert_eq!(ajanda_yukari_coz_surum(ham, None).unwrap_err().islem_id.as_deref(), Some("i1"));
        // v2 bağlantıda v3 zarfı `protokol_uyumsuz`: `islem_id` yok.
        assert_eq!(ajanda_yukari_coz_surum(ham, Some(Surum::V2)).unwrap_err().islem_id, None);
    }
}
