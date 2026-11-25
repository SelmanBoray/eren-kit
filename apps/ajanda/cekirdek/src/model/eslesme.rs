//! Eşleştirme ve kimlik (`ajanda.ts` "Kapsam", `AjandaEslestirmeQr`, `ajandaKimlikImzaMetni`).
//! İmzalama ve doğrulama Rust'ta yapılmaz: `KimlikKabugu` (Android Keystore, java.security).

use super::cerceve::{acik_anahtar_oku, eslestirme_kodu_oku};
use super::json::{Nesne, Sonuc, Yazici, hata, metin, metin_sabiti, sayi_sabiti, tam_sayi};
use super::sinirlar::AJANDA_SURUMU;
use serde_json::Value;

/// `/sohbet` QR'ının (`EslestirmeQr`) sürümü: v1; ajanda QR'ı `v` olarak `AJANDA_SURUMU` taşır.
/// İkisi de 1 olduğu için tek denetim yeter.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct AjandaEslestirmeQr {
    pub host: String,
    pub port: i32,
    pub kod: String,
    pub server_public_key: String,
}

/// `tailscaleAdresiMi`: `100.64.0.0/10` (`^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$`, ikinci sekizli 64-127).
pub fn tailscale_adresi_mi(adres: &str) -> bool {
    let Some(kalan) = adres.strip_prefix("100.") else { return false };
    let parcalar: Vec<&str> = kalan.split('.').collect();
    if parcalar.len() != 3 || !parcalar.iter().all(|p| (1..=3).contains(&p.len()) && p.bytes().all(|c| c.is_ascii_digit())) {
        return false;
    }
    let sayi = |p: &str| p.parse::<u32>().unwrap_or(u32::MAX);
    (64..=127).contains(&sayi(parcalar[0])) && sayi(parcalar[1]) <= 255 && sayi(parcalar[2]) <= 255
}

impl AjandaEslestirmeQr {
    pub fn oku(v: &Value, yol: &str) -> Sonuc<Self> {
        let mut n = Nesne::ac(v, yol)?;
        n.zorunlu("v", |v, y| sayi_sabiti(v, y, AJANDA_SURUMU))?;
        n.zorunlu("kanal", |v, y| metin_sabiti(v, y, "ajanda"))?;
        let host = n.zorunlu("host", |v, y| {
            let s = metin(v, y)?;
            if s.chars().count() <= 15 && tailscale_adresi_mi(s) { Ok(s.to_string()) } else { hata(y, "Tailscale adresi değil") }
        })?;
        let qr = AjandaEslestirmeQr {
            host,
            port: n.zorunlu("port", |v, y| tam_sayi(v, y, 1, 65_535))? as i32,
            kod: n.zorunlu("kod", eslestirme_kodu_oku)?,
            server_public_key: n.zorunlu("server_public_key", acik_anahtar_oku)?,
        };
        n.bitir()?;
        Ok(qr)
    }

    /// QR'dan okunan metni (JSON) çözer. Hata yalnız alan yolunu taşır.
    pub fn coz(metin: &str) -> Sonuc<Self> {
        let v: Value = serde_json::from_str(metin).map_err(|_| super::json::SemaHatasi { yol: String::new(), neden: "JSON değil" })?;
        AjandaEslestirmeQr::oku(&v, "")
    }

    pub fn json(&self) -> Value {
        Yazici::yeni()
            .alan("v", AJANDA_SURUMU)
            .alan("kanal", "ajanda")
            .alan("host", self.host.as_str())
            .alan("port", self.port)
            .alan("kod", self.kod.as_str())
            .alan("server_public_key", self.server_public_key.as_str())
            .bitir()
    }

    /// Telefonun açacağı adres: yalnız Tailscale üstünden `ws://`.
    pub fn adres(&self) -> String {
        format!("ws://{}:{}/ajanda", self.host, self.port)
    }
}

/// İmza metninin rolü (`ImzaRolu`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImzaRolu {
    Pc,
    Telefon,
}

impl ImzaRolu {
    pub fn ad(self) -> &'static str {
        match self {
            ImzaRolu::Pc => "pc",
            ImzaRolu::Telefon => "telefon",
        }
    }
}

/// `AJANDA_IMZA_ONEKI`.
pub const AJANDA_IMZA_ONEKI: &str = "eren-ajanda-auth-v1";

/// `ajandaKimlikImzaMetni`: imzalanan baytlar bu metnin UTF-8 halidir (ECDSA P-256 + SHA-256, DER).
pub fn ajanda_kimlik_imza_metni(rol: ImzaRolu, device_id: &str, client_nonce: &str, server_nonce: &str) -> String {
    [AJANDA_IMZA_ONEKI, rol.ad(), "kanal:ajanda", "kapsam:ajanda", device_id, client_nonce, server_nonce].join("\n")
}

/// `kanalKapsamdaMi` (`KAPSAM_KANALLARI`): kapsamlar kesişmez.
pub fn kanal_kapsamda_mi(kapsam: &str, kanal: &str) -> bool {
    match kapsam {
        "sohbet" => matches!(kanal, "sohbet" | "cihaz"),
        "ajanda" => kanal == "ajanda",
        _ => false,
    }
}
