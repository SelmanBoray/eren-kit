//! SAHİBİ: R3. Kurulu alarmlar (`kurulu_alarmlar`): Android'e kurdurulan her tetik, teslim edilene
//! dek kalıcı (`kacirilanHatirlatmalar`'ın `kurulanlar`'ı buradan). `alarm_no` PendingIntent istek
//! kodudur (Kotlin `toInt()`).

use super::Depo;
use crate::hata::CekirdekHatasi;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KuruluAlarm {
    pub alarm_no: i64,
    pub kayit_id: String,
    pub tetik_ms: i64,
    pub ornek_tarihi: Option<String>,
    /// Teslim edildiyse (çaldı ya da kaçırılan olarak gösterildi) zamanı.
    pub teslim_ms: Option<i64>,
}

impl Depo {
    /// Kaydın teslim edilmemiş kurulu alarmları.
    pub fn kurulu_alarmlar(&self, kayit_id: &str) -> Result<Vec<KuruluAlarm>, CekirdekHatasi> {
        let _ = (kayit_id, &self.baglanti);
        Err(CekirdekHatasi::yazilmadi("depo::alarmlar::kurulu_alarmlar (R3)"))
    }

    /// Bütün teslim edilmemiş kurulu alarmlar (yeniden kurulum).
    pub fn tum_kurulu_alarmlar(&self) -> Result<Vec<KuruluAlarm>, CekirdekHatasi> {
        Err(CekirdekHatasi::yazilmadi("depo::alarmlar::tum_kurulu_alarmlar (R3)"))
    }

    /// `(kayit_id, tetik_ms)` için alarm satırı açar ya da var olanı döner.
    pub fn alarm_kaydet(&self, kayit_id: &str, tetik_ms: i64, ornek_tarihi: Option<&str>) -> Result<KuruluAlarm, CekirdekHatasi> {
        let _ = (kayit_id, tetik_ms, ornek_tarihi);
        Err(CekirdekHatasi::yazilmadi("depo::alarmlar::alarm_kaydet (R3)"))
    }

    pub fn alarm_no_ile(&self, alarm_no: i64) -> Result<Option<KuruluAlarm>, CekirdekHatasi> {
        let _ = alarm_no;
        Err(CekirdekHatasi::yazilmadi("depo::alarmlar::alarm_no_ile (R3)"))
    }

    pub fn alarm_teslim_edildi(&self, alarm_no: i64, ts_ms: i64) -> Result<(), CekirdekHatasi> {
        let _ = (alarm_no, ts_ms);
        Err(CekirdekHatasi::yazilmadi("depo::alarmlar::alarm_teslim_edildi (R3)"))
    }

    pub fn alarm_sil(&self, alarm_no: i64) -> Result<(), CekirdekHatasi> {
        let _ = alarm_no;
        Err(CekirdekHatasi::yazilmadi("depo::alarmlar::alarm_sil (R3)"))
    }
}
