//! Ajanda çekirdeği (Rust). Mimari: `apps/ajanda/MIMARI.md`.
//!
//! - `model/`  veri modeli: kayıt, işlem, `/ajanda` çerçeveleri, JSON ve şema doğrulaması.
//! - `kural/`  servisle aynı sonucu vermesi gereken saf kurallar.
//! - `depo/`   SQLite (gömülü): sunucu kopyası, görünen kopya, kuyruk, ret listesi, kurulu alarmlar.
//! - `motor/`  kanal durum makinesi (sans-IO), iyimser işlem ve kuyruk, sorgular, alarm planı.
//! - `kopru/`  Kotlin'in gördüğü tek yüzey (`#[uniffi::export]` yalnız burada) ve geri çağrılar.

uniffi::setup_scaffolding!();

pub mod depo;
pub mod hata;
pub mod kopru;
pub mod kural;
pub mod model;
mod motor;

pub use hata::{CekirdekHatasi, KabukHatasi};
pub use kopru::Cekirdek;
pub use motor::ALARM_BUTCESI;
