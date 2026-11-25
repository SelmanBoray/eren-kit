//! SAHİBİ: R4 (yerel depo ve eşitleme motoru); `alarm.rs` R3'ündür.
//!
//! Motor, köprünün (`kopru`) çağırdığı iş mantığıdır: kanal durum makinesi (sans-IO: çerçeve girer,
//! `Etkiler.gonderilecek` çıkar; soket Kotlin'dedir), iyimser işlem ve kuyruk, görünen kopya, sorgular,
//! alarm planının uygulanması. Tek `Mutex<Motor>` altında, eşzamanlı çalışır.
//!
//! Etki kuralı: motor yan etkiyi (çerçeve yollama, alarm kurma, gözlemci) kendisi yapmaz; `Etkiler`'e
//! yazar. Köprü kilit bırakıldıktan sonra sırasıyla uygular (bkz. `kopru::Cekirdek::calistir`). Motor
//! yalnız kalıcı hale (SQLite işlemi tamamlanmış) karşılık gelen etkiyi yazar; `Err` dönen çağrının
//! etkileri yine uygulanır, o yüzden hatadan önce yazılmış etki gerçek olmalıdır.

// İkinci dalga doldurana dek iskelet alanları ve yardımcıları kullanılmıyor; R4 işi bitince kaldırır.
#![allow(dead_code)]

mod alarm;
mod eslesme;
mod islem;
mod kanal;
mod sorgu;

use crate::depo::Depo;
use crate::hata::CekirdekHatasi;
use crate::kopru::kabuklar::{KabukCevirici, KimlikKabugu, ZamanKabugu};
use crate::kopru::tipler::{Degisim, KacirilanBildirimi, KurulacakAlarm};

/// Kotlin'in eşzamanlı sağladığı platform hizmetleri (motor kilidi altında çağrılabilir).
pub(crate) struct Ortam<'a> {
    pub kimlik: &'a dyn KimlikKabugu,
    pub zaman: &'a dyn ZamanKabugu,
}

impl<'a> Ortam<'a> {
    pub fn simdi_ms(&self) -> i64 {
        self.zaman.simdi_ms()
    }

    /// Kuralların `AnCevirici`'si (java.time).
    pub fn cevirici(&self) -> KabukCevirici<'a> {
        KabukCevirici(self.zaman)
    }
}

/// Bir çağrının dış dünyaya etkileri; köprü kilit dışında, bu sırayla uygular:
/// `gonderilecek` (açık taşımaya, aynı bağlantı neslindeyse), `kapat`, `alarm_iptal`, `alarm_kur`,
/// `kacirilan`, `degisim` (gözlemcilere, boş değilse).
#[derive(Debug, Default)]
pub(crate) struct Etkiler {
    pub gonderilecek: Vec<String>,
    pub kapat: Option<String>,
    pub alarm_iptal: Vec<i64>,
    pub alarm_kur: Vec<KurulacakAlarm>,
    pub kacirilan: Option<KacirilanBildirimi>,
    pub degisim: Degisim,
}

pub(crate) struct Motor {
    pub(crate) depo: Depo,
    // R4: bağlantı aşaması, nonce'lar, telafi durumu, geçmiş önbelleği gibi bellek içi hal buraya.
}

impl Motor {
    pub(crate) fn ac(veritabani_yolu: &str) -> Result<Motor, CekirdekHatasi> {
        Ok(Motor { depo: Depo::ac(veritabani_yolu)? })
    }

    pub(crate) fn sema_surumu(&self) -> Result<i64, CekirdekHatasi> {
        Ok(self.depo.sema_surumu()?)
    }
}
