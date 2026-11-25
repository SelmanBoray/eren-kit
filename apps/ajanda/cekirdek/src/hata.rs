//! Köprüden geçen hata türleri. Kotlin'de `CekirdekHatasi` / `KabukHatasi` mühürlü
//! istisna sınıfları olur; her değişken bir alt sınıftır (`CekirdekHatasi.Depo` gibi).

/// Çekirdeğin Kotlin'e fırlattığı hata. Yeni durum gerekiyorsa değişken ekle;
/// alanlar adlandırılmış olmalı (Kotlin tarafında özellik olarak görünür).
#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum CekirdekHatasi {
    #[error("depo hatası: {mesaj}")]
    Depo { mesaj: String },
    #[error("kabuk çağrısı başarısız: {mesaj}")]
    KabukCagrisi { mesaj: String },
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
