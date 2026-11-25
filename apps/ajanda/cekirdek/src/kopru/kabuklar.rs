//! Rust'ın Kotlin'i geri çağırdığı arayüzler (Kotlin uygular). Her biri tek bir Kotlin sahibine aittir
//! (`MIMARI.md`). Kurallar:
//! - Hiçbir geri çağrı Cekirdek'e eşzamanlı yeniden girmez (aynı iş parçacığında `cekirdek.x()`
//!   çağırmaz): `KimlikKabugu` ve `ZamanKabugu` motor kilidi altında çağrılır, ötekiler etki kilidi altında.
//!   Yeniden girmek gerekiyorsa işi başka iş parçacığına at.
//! - `Result` döndürenler hata için `KabukHatasi.Basarisiz` fırlatır; öteki istisnalar da taşınır.

use crate::hata::KabukHatasi;
use crate::kural::{AnCevirici, ZamanHatasi};
use crate::model::YerelAn;

use super::tipler::{Degisim, KacirilanBildirimi, KurulacakAlarm};

/// K1 (kimlik): Android Keystore'daki P-256 cihaz anahtarı ve güvenli rastgele.
#[uniffi::export(with_foreign)]
pub trait KimlikKabugu: Send + Sync {
    /// Cihaz anahtarının açık yarısı, SPKI DER (yoksa üretir). `pair_request.public_key` bunun base64'ü.
    fn acik_anahtar(&self) -> Result<Vec<u8>, KabukHatasi>;
    /// ECDSA P-256 + SHA-256, DER. Girdi `ajandaKimlikImzaMetni`'nin UTF-8 baytlarıdır.
    fn imzala(&self, veri: Vec<u8>) -> Result<Vec<u8>, KabukHatasi>;
    /// PC imzasını doğrular. `acik_anahtar`: SPKI DER (QR'daki `server_public_key`).
    fn dogrula(&self, acik_anahtar: Vec<u8>, veri: Vec<u8>, imza: Vec<u8>) -> Result<bool, KabukHatasi>;
    /// Güvenli rastgele bayt (nonce, kayıt ve işlem kimlikleri).
    fn rastgele(&self, uzunluk: u32) -> Result<Vec<u8>, KabukHatasi>;
    /// Cihaz anahtarını siler (eşleşme kaldırılınca; sonraki eşleştirme yeni anahtarla).
    fn anahtari_sil(&self) -> Result<(), KabukHatasi>;
}

/// Saat ve dilim: java.time (başvuru kuralı). Saf olmalı, kilitlenmemeli.
#[uniffi::export(with_foreign)]
pub trait ZamanKabugu: Send + Sync {
    fn simdi_ms(&self) -> i64;
    /// Cihazın şimdiki IANA dilimi (`ZoneId.systemDefault().id`): elle eklemenin varsayılan dilimi.
    fn cihaz_dilimi(&self) -> String;
    /// `ZonedDateTime.of(LocalDate, LocalTime, ZoneId).toInstant().toEpochMilli()`. Bilinmeyen dilim hata.
    fn yerelden_ana(&self, tarih: String, saat: String, saat_dilimi: String) -> Result<i64, KabukHatasi>;
    /// `Instant.ofEpochMilli(an).atZone(ZoneId.of(dilim))`, saat `HH:MM`.
    fn andan_yerele(&self, an_ms: i64, saat_dilimi: String) -> Result<YerelAn, KabukHatasi>;
}

/// K2 (ağ): açık WebSocket bağlantısının yazma ucu. `baglanti_acildi` ile verilir.
#[uniffi::export(with_foreign)]
pub trait Tasima: Send + Sync {
    /// Metin çerçevesini sıraya koyar; `false`: bağlantı kapanıyor, gitmeyecek. Atmamalı.
    fn gonder(&self, metin: String) -> bool;
    /// Bağlantıyı kapatır (protokol hatası, kimlik reddi). Kotlin sonra `baglanti_kapandi`'yı çağırır.
    fn kapat(&self, neden: String);
}

/// K3 (alarm): alarm kurma stratejisinin tek yeri (setAlarmClock / setExactAndAllowWhileIdle / ...).
#[uniffi::export(with_foreign)]
pub trait AlarmKabugu: Send + Sync {
    /// `alarm.tetik_ms`'te `alarm_no` istek kodlu alarmı kurar (aynı numara varsa değiştirir).
    fn kur(&self, alarm: KurulacakAlarm) -> Result<(), KabukHatasi>;
    fn iptal(&self, alarm_no: i64) -> Result<(), KabukHatasi>;
    /// Yeniden kurulumda kaçırılanlar: birden çoksa tek özet bildirim.
    fn kacirilanlari_goster(&self, bildirim: KacirilanBildirimi) -> Result<(), KabukHatasi>;
}

/// K4 (ekranlar): veri değişince haber. Arayüz iş parçacığına kendisi geçer, sorguyu yeniden yapar.
#[uniffi::export(with_foreign)]
pub trait Gozlemci: Send + Sync {
    fn degisti(&self, degisim: Degisim);
}

/// `ZamanKabugu`'nu kuralların `AnCevirici`'sine bağlar.
pub struct KabukCevirici<'a>(pub &'a dyn ZamanKabugu);

impl AnCevirici for KabukCevirici<'_> {
    fn ana_cevir(&self, tarih: &str, saat: &str, saat_dilimi: &str) -> Result<i64, ZamanHatasi> {
        self.0
            .yerelden_ana(tarih.to_string(), saat.to_string(), saat_dilimi.to_string())
            .map_err(|e| ZamanHatasi { mesaj: e.to_string() })
    }

    fn yerele_cevir(&self, an_ms: i64, saat_dilimi: &str) -> Result<YerelAn, ZamanHatasi> {
        self.0.andan_yerele(an_ms, saat_dilimi.to_string()).map_err(|e| ZamanHatasi { mesaj: e.to_string() })
    }
}
