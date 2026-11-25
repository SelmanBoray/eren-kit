//! SAHİBİ: R4. Eşleşme bilgisinin saklanması (`meta`): bitmiş eşleşme (`device_id`, adres, sunucu açık
//! anahtarı), okunmuş ve sonucu bekleyen QR, son ret. QR'ın doğrulanması modeldedir (`AjandaEslestirmeQr`);
//! imza ve anahtar `KimlikKabugu`'ndadır.
//!
//! Güven çapası QR'daki `server_public_key`'dir (kullanıcı fiziksel olarak okuttu): `pair_result`'ın
//! taşıdığı anahtar saklanmaz, PC imzası hep QR'ınkiyle doğrulanır.
//!
//! Durum önceliği: bekleyen QR (`Bekliyor`) > son ret (`Reddedildi`) > eşleşme (`Eslesti`) > `Yok`.
//! Ret, yeni QR okutulunca ya da eşleşme kaldırılınca silinir; eski eşleşme varsa bağlantı onunla sürer
//! (`baglanti_adresi`), arayüz yine de reddi gösterir (kullanıcı yeni QR'ın neden tutmadığını görsün).

use super::{Asama, Etkiler, Motor, Ortam};
use crate::depo::anahtar;
use crate::hata::CekirdekHatasi;
use crate::kopru::tipler::EslesmeDurumu;
use crate::model::{AjandaEslestirmeQr, AjandaKanalHatasi};
use serde_json::{Value, json};

/// Bitmiş eşleşme.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Eslesme {
    pub device_id: String,
    pub host: String,
    pub port: i32,
    /// QR'daki PC açık anahtarı (SPKI DER, base64).
    pub server_public_key: String,
}

impl Eslesme {
    fn json(&self) -> Value {
        json!({"device_id": self.device_id, "host": self.host, "port": self.port, "server_public_key": self.server_public_key})
    }

    fn coz(metin: &str) -> Option<Eslesme> {
        let v: Value = serde_json::from_str(metin).ok()?;
        Some(Eslesme {
            device_id: v.get("device_id")?.as_str()?.to_string(),
            host: v.get("host")?.as_str()?.to_string(),
            port: i32::try_from(v.get("port")?.as_i64()?).ok()?,
            server_public_key: v.get("server_public_key")?.as_str()?.to_string(),
        })
    }

    pub fn adres(&self) -> String {
        format!("ws://{}:{}/ajanda", self.host, self.port)
    }
}

impl Motor {
    pub(crate) fn eslesme_oku(&self) -> Result<Option<Eslesme>, CekirdekHatasi> {
        Ok(self.depo.meta_oku(anahtar::ESLESME)?.as_deref().and_then(Eslesme::coz))
    }

    pub(crate) fn bekleyen_qr(&self) -> Result<Option<AjandaEslestirmeQr>, CekirdekHatasi> {
        Ok(self.depo.meta_oku(anahtar::ESLESTIRME_QR)?.as_deref().and_then(|m| AjandaEslestirmeQr::coz(m).ok()))
    }

    /// `pair_result{ok}`: QR'ın yerine eşleşme yazılır (eski eşleşmenin yerine geçer), ret silinir.
    pub(crate) fn eslesme_kaydet(&mut self, qr: &AjandaEslestirmeQr, device_id: &str) -> Result<Eslesme, CekirdekHatasi> {
        let eslesme = Eslesme {
            device_id: device_id.to_string(),
            host: qr.host.clone(),
            port: qr.port,
            server_public_key: qr.server_public_key.clone(),
        };
        self.depo.yazma(|d| {
            d.meta_yaz(anahtar::ESLESME, Some(&eslesme.json().to_string()))?;
            d.meta_yaz(anahtar::ESLESTIRME_QR, None)?;
            d.meta_yaz(anahtar::ESLESME_REDDI, None)?;
            Ok(())
        })?;
        Ok(eslesme)
    }

    /// `pair_result{ok:false}`: QR atılır, ret saklanır; var olan eşleşme değişmez.
    pub(crate) fn eslesme_reddedildi(&mut self, kod: AjandaKanalHatasi) -> Result<(), CekirdekHatasi> {
        self.depo.yazma(|d| {
            d.meta_yaz(anahtar::ESLESTIRME_QR, None)?;
            d.meta_yaz(anahtar::ESLESME_REDDI, Some(kod.ad()))?;
            Ok(())
        })
    }

    /// QR okundu: eşleştirme bekler (sonraki `baglanti_acildi` `pair_request` yollar). Var olan eşleşme
    /// ve sunucu kopyası değişmez; eşleştirme başarıyla bitince eski eşleşmenin yerine geçer. Açık bir
    /// bağlantı varsa kapatılır: Kotlin yeniden bağlanınca eşleştirme hemen başlar.
    pub(crate) fn eslestirme_baslat(&mut self, o: &Ortam, e: &mut Etkiler, qr: AjandaEslestirmeQr) -> Result<(), CekirdekHatasi> {
        let _ = o;
        self.depo.yazma(|d| {
            d.meta_yaz(anahtar::ESLESTIRME_QR, Some(&qr.json().to_string()))?;
            d.meta_yaz(anahtar::ESLESME_REDDI, None)?;
            Ok(())
        })?;
        e.degisim.eslesme = true;
        if !matches!(self.asama, Asama::Kopuk | Asama::Kapaniyor) {
            self.kapat(e, "eşleştirme başlıyor");
        }
        Ok(())
    }

    pub(crate) fn eslesme_durumu(&self) -> Result<EslesmeDurumu, CekirdekHatasi> {
        if let Some(qr) = self.bekleyen_qr()? {
            return Ok(EslesmeDurumu::Bekliyor { host: qr.host, port: qr.port });
        }
        if let Some(kod) = self.depo.meta_oku(anahtar::ESLESME_REDDI)?.as_deref().and_then(AjandaKanalHatasi::coz) {
            return Ok(EslesmeDurumu::Reddedildi { kod });
        }
        Ok(match self.eslesme_oku()? {
            Some(e) => EslesmeDurumu::Eslesti { device_id: e.device_id, host: e.host, port: e.port },
            None => EslesmeDurumu::Yok,
        })
    }

    /// Eşleşmeyi, sunucu kopyasını, kuyruğu, ret listesini, görünen kopyayı ve alarmları siler; cihaz
    /// anahtarını `anahtari_sil` ile siler. Açık bağlantı kapatılır. Anahtar silinemezse hata döner ama
    /// yerel veriler silinmiş, etkiler uygulanmıştır (sonraki eşleştirme yine `acik_anahtar` ister).
    pub(crate) fn eslesmeyi_kaldir(&mut self, o: &Ortam, e: &mut Etkiler) -> Result<(), CekirdekHatasi> {
        self.depo.yazma(|d| d.eslesmeye_bagli_her_seyi_sil())?;
        self.gecmis.clear();
        self.gecmis_istekleri.clear();
        self.son_hata = None;
        if !matches!(self.asama, Asama::Kopuk | Asama::Kapaniyor) {
            self.kapat(e, "eşleşme kaldırıldı");
        }
        e.degisim.tumu = true;
        e.degisim.eslesme = true;
        e.degisim.ret_listesi = true;
        e.degisim.baglanti = true;
        // Alarm satırları kendi savepoint'inde, yukarıdaki işlem kalıcı olduktan sonra (R3).
        self.tum_alarmlari_kaldir(e)?;
        o.kimlik.anahtari_sil()?;
        Ok(())
    }

    /// Açılacak adres (`ws://<tailscale>:<port>/ajanda`); eşleşme ve bekleyen eşleştirme yoksa `None`.
    pub(crate) fn baglanti_adresi(&self) -> Result<Option<String>, CekirdekHatasi> {
        if let Some(qr) = self.bekleyen_qr()? {
            return Ok(Some(qr.adres()));
        }
        Ok(self.eslesme_oku()?.map(|e| e.adres()))
    }
}
