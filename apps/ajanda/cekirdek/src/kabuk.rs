//! Rust'ın Kotlin'i geri çağırdığı arayüz. Kotlin bu arayüzü uygular ve
//! `Cekirdek.ac(...)`'a verir; çekirdek platforma ait işi (Android Keystore imzası,
//! ileride saat/saat dilimi vb.) buradan ister.

use crate::hata::KabukHatasi;

#[uniffi::export(with_foreign)]
pub trait Kabuk: Send + Sync {
    /// Veriyi cihazdaki anahtarla imzalar (Android'de Keystore).
    fn imzala(&self, veri: Vec<u8>) -> Result<Vec<u8>, KabukHatasi>;
}
