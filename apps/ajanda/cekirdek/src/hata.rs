//! Köprüden geçen hata türleri. Kotlin'de `CekirdekHatasi` / `KabukHatasi` mühürlü
//! istisna sınıfları olur; her değişken bir alt sınıftır (`CekirdekHatasi.Yazilmadi` gibi).
//! Değişken eklemek köprü yüzeyini değiştirir: ikinci dalgada yalnız şef sırasıyla (MIMARI.md).

/// Çekirdeğin Kotlin'e fırlattığı hata. Alanlar adlandırılmıştır (Kotlin'de özellik).
#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum CekirdekHatasi {
    #[error("depo hatası: {mesaj}")]
    Depo { mesaj: String },
    #[error("kabuk çağrısı başarısız: {mesaj}")]
    KabukCagrisi { mesaj: String },
    /// Bu parça henüz yazılmadı (ikinci dalga doldurur). `parca`: modül ve sahibi.
    #[error("yazılmadı: {parca}")]
    Yazilmadi { parca: String },
    /// Formdan gelen alan kabul edilmedi (`alan`: `baslik`, `zaman.ifade` gibi yol).
    #[error("geçersiz girdi: {alan}: {neden}")]
    GecersizGirdi { alan: String, neden: String },
    #[error("kayıt yok: {kayit_id}")]
    KayitYok { kayit_id: String },
    /// Eşleşme yok ya da eşleştirme bilgisi geçersiz.
    #[error("eşleşme yok: {mesaj}")]
    Eslesme { mesaj: String },
    /// Çağrı bu durumda yapılamaz (bağlantı yok, işlem silinmiş kayda vb.).
    #[error("geçersiz durum: {mesaj}")]
    GecersizDurum { mesaj: String },
}

impl CekirdekHatasi {
    pub fn yazilmadi(parca: &str) -> Self {
        CekirdekHatasi::Yazilmadi { parca: parca.to_string() }
    }
}

impl From<rusqlite::Error> for CekirdekHatasi {
    fn from(e: rusqlite::Error) -> Self {
        CekirdekHatasi::Depo { mesaj: e.to_string() }
    }
}

impl From<KabukHatasi> for CekirdekHatasi {
    fn from(e: KabukHatasi) -> Self {
        CekirdekHatasi::KabukCagrisi { mesaj: e.to_string() }
    }
}

impl From<crate::kural::metin::GirdiSorunu> for CekirdekHatasi {
    fn from(s: crate::kural::metin::GirdiSorunu) -> Self {
        CekirdekHatasi::GecersizGirdi { alan: s.alan, neden: s.neden }
    }
}

/// Kotlin kabuğunun (geri çağrılarda) fırlatabileceği hata.
/// Kotlin `KabukHatasi.Basarisiz(...)` fırlatırsa Rust'a bu değer olarak döner;
/// başka bir istisna fırlatırsa `Beklenmeyen` olarak gelir.
#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum KabukHatasi {
    #[error("{mesaj}")]
    Basarisiz { mesaj: String },
    #[error("beklenmeyen kabuk hatası: {mesaj}")]
    Beklenmeyen { mesaj: String },
}

impl From<uniffi::UnexpectedUniFFICallbackError> for KabukHatasi {
    fn from(e: uniffi::UnexpectedUniFFICallbackError) -> Self {
        KabukHatasi::Beklenmeyen { mesaj: e.reason }
    }
}
