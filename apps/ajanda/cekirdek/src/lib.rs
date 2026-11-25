//! Ajanda çekirdeği. Kotlin kabuğu yalnız bu dosyada `#[uniffi::export]` ile
//! işaretlenen yüzeyi görür; iş mantığı alt modüllerde, köprüden habersiz yaşar.
//!
//! Köprü kalıbı:
//! - Kotlin -> Rust: `Cekirdek` nesnesinin yöntemleri ve serbest işlevler (eşzamanlı;
//!   Kotlin bunları ana iş parçacığı dışında çağırır).
//! - Rust -> Kotlin: `Kabuk` arayüzü (kabuk.rs), açılışta Kotlin'den alınır.
//! - Hatalar: `Result<_, CekirdekHatasi>` -> Kotlin'de `CekirdekHatasi` istisnası.

uniffi::setup_scaffolding!();

mod depo;
mod hata;
mod kabuk;

use std::sync::{Arc, Mutex};

pub use hata::{CekirdekHatasi, KabukHatasi};
pub use kabuk::Kabuk;

/// Köprüden geçen kayıt (Kotlin'de `data class Kayit`).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Kayit {
    pub kimlik: i64,
    pub metin: String,
    pub imza: Option<Vec<u8>>,
}

impl From<depo::DepoKaydi> for Kayit {
    fn from(k: depo::DepoKaydi) -> Self {
        Kayit { kimlik: k.kimlik, metin: k.metin, imza: k.imza }
    }
}

/// Çekirdek sürümü (köprünün yüklendiğini görmenin en kısa yolu).
#[uniffi::export]
pub fn cekirdek_surumu() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Gömülü SQLite sürümü (cihazınkinden bağımsız olduğunu göstermek için).
#[uniffi::export]
pub fn sqlite_surumu() -> String {
    rusqlite::version().to_string()
}

/// Süreç başına bir tane açılır (Kotlin'de `CekirdekErisimi`). İş parçacığı güvenlidir.
#[derive(uniffi::Object)]
pub struct Cekirdek {
    depo: Mutex<depo::Depo>,
    kabuk: Arc<dyn Kabuk>,
}

impl Cekirdek {
    fn depo(&self) -> std::sync::MutexGuard<'_, depo::Depo> {
        // Zehirlenmiş kilit: önceki çağrı panikledi; bağlantı yine de kullanılabilir.
        self.depo.lock().unwrap_or_else(|z| z.into_inner())
    }
}

#[uniffi::export]
impl Cekirdek {
    /// Veritabanını açar (yoksa oluşturur, göçleri uygular).
    #[uniffi::constructor]
    pub fn ac(veritabani_yolu: String, kabuk: Arc<dyn Kabuk>) -> Result<Arc<Self>, CekirdekHatasi> {
        let depo = depo::Depo::ac(&veritabani_yolu)?;
        Ok(Arc::new(Cekirdek { depo: Mutex::new(depo), kabuk }))
    }

    pub fn sema_surumu(&self) -> Result<i64, CekirdekHatasi> {
        Ok(self.depo().sema_surumu()?)
    }

    /// Metni Kotlin kabuğuna imzalatır (Rust -> Kotlin), imzayla birlikte SQLite'a yazar.
    pub fn imzala_ve_yaz(&self, metin: String) -> Result<Kayit, CekirdekHatasi> {
        // Kabuk çağrısı kilit dışında: Kotlin geri çağrısı çekirdeğe yeniden girebilir.
        let imza = self.kabuk.imzala(metin.clone().into_bytes())?;
        let kimlik = self.depo().yaz(&metin, Some(&imza))?;
        Ok(Kayit { kimlik, metin, imza: Some(imza) })
    }

    pub fn oku(&self, kimlik: i64) -> Result<Option<Kayit>, CekirdekHatasi> {
        Ok(self.depo().oku(kimlik)?.map(Kayit::from))
    }
}

#[cfg(test)]
mod testler {
    use super::*;

    struct TersCeviren;
    impl Kabuk for TersCeviren {
        fn imzala(&self, mut veri: Vec<u8>) -> Result<Vec<u8>, KabukHatasi> {
            veri.reverse();
            Ok(veri)
        }
    }

    struct Reddeden;
    impl Kabuk for Reddeden {
        fn imzala(&self, _: Vec<u8>) -> Result<Vec<u8>, KabukHatasi> {
            Err(KabukHatasi::Basarisiz { mesaj: "anahtar yok".into() })
        }
    }

    #[test]
    fn imzala_yaz_oku() {
        let c = Cekirdek::ac(":memory:".into(), Arc::new(TersCeviren)).unwrap();
        let k = c.imzala_ve_yaz("abc".into()).unwrap();
        assert_eq!(k.imza.as_deref(), Some(&b"cba"[..]));
        assert_eq!(c.oku(k.kimlik).unwrap(), Some(k));
    }

    #[test]
    fn kabuk_hatasi_tasinir_ve_yazilmaz() {
        let c = Cekirdek::ac(":memory:".into(), Arc::new(Reddeden)).unwrap();
        match c.imzala_ve_yaz("x".into()) {
            Err(CekirdekHatasi::KabukCagrisi { mesaj }) => assert!(mesaj.contains("anahtar yok")),
            diger => panic!("beklenmeyen: {diger:?}"),
        }
        assert_eq!(c.oku(1).unwrap(), None);
    }

    #[test]
    fn surumler_dolu() {
        assert!(!cekirdek_surumu().is_empty());
        assert!(sqlite_surumu().starts_with('3'));
    }
}
